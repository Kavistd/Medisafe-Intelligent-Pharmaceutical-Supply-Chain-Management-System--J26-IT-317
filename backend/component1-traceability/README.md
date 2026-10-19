# Component 1 — Phase 3 backend

Node.js/Express API using ethers v6 and the existing shared MedicineTraceability ABI, with Phase 4 public-document IPFS integration. No private wallet keys, signers, broadcasting, deployment or frontend are provided. Use Node 22 LTS or newer.

See [Phase 4 document integration](ipfs/README.md) for upload authorization, mandatory public-content approval, provider configuration, retrieval and CID registration.

## Run

From this directory:

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env with an existing deployed contract address and RPC.
npm start
npm test
```

The default bind address is `127.0.0.1`, port `5001`. `npm start` loads `.env` using Node's built-in environment loader. No shared configuration is written. `TRACEABILITY_NETWORK` supports localhost/hardhat (31337) and sepolia (11155111). `MEDICINE_TRACEABILITY_ADDRESS` overrides the selected network's existing shared address. `WEB3_RPC_URL` is required. RPC requests time out after 10 seconds.

## Endpoints

Base: `/api/v1/traceability/batches`. URL-encode batch IDs; they are exact, case-sensitive strings and are never trimmed.

| Method | Path relative to base | Request / result |
| --- | --- | --- |
| GET | `/:batchId` | `getBatch`: registration data, manufacturer, owner, numeric stage, recalled |
| GET | `/:batchId/pending-transfer` | `getPendingTransfer`; id `"0"` means no pending transfer |
| GET | `/:batchId/history` | `getTransferHistory`: completed transfers only, maximum two |
| GET | `/:batchId/status` | `{batchId, recalled, expired}` using contract reads |
| POST | `/transactions/register` | `{sender, batch}` → `registerBatch(batch)` |
| POST | `/:batchId/transactions/initiate-transfer` | `{sender, recipient}` → `initiateTransfer(batchId, recipient)` |
| POST | `/:batchId/transactions/confirm-transfer` | `{sender, transferId}` → `confirmTransfer(batchId, transferId)` |
| POST | `/:batchId/transactions/cancel-transfer` | `{sender, transferId}` → `cancelTransfer(batchId, transferId)` |
| POST | `/:batchId/transactions/reject-transfer` | Same fields; requires pending recipient and prepares `cancelTransfer` |
| POST | `/:batchId/transactions/recall` | `{sender, reason}` → `recallBatch(batchId, reason)` |

`GET /health` is process liveness. `GET /health/blockchain` checks RPC chain ID and deployed bytecode. Bytecode presence does not certify contract identity; configure a verified deployment.

Success: `{success:true,data:...}`. Contract reads preserve output positions as keys: batch/pending/history/expiry are under `data["0"]`. Tuple fields are named; arrays remain arrays. All Solidity integers in read results are decimal strings to prevent precision loss. Stages are `"0"` manufacturer, `"1"` distributor, `"2"` pharmacy. Status combines two reads, so it is not an atomic snapshot during concurrent chain changes.

### Registration body

```json
{
  "sender": "0x1111111111111111111111111111111111111111",
  "batch": {
    "batchId": "BATCH-001",
    "medicineId": "MED-001",
    "name": "Amoxicillin",
    "category": "Antibiotic",
    "dosageForm": "Capsule",
    "strength": "500 mg",
    "manufacturerName": "Example Manufacturer",
    "indication": "Infection",
    "classification": "Prescription",
    "quantity": 100,
    "manufacturedAt": 1790000000,
    "expiresAt": 1900000000,
    "documentReference": "ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "certificateReference": "ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

Choose timestamps valid at submission. Registration uses the existing shared draft-07 schema, rejects unknown properties and unsafe/coerced numbers, and checks expiry after manufacture. Simulation enforces manufacture <= chain time < expiry. Phase 4 validates both references as CIDs and canonicalizes them to CIDv1 `ipfs://` references. The example uses a synthetic CID, not a retrievable document. No custody/owner fields can be supplied during registration.

Transfer IDs must be positive decimal **strings** within uint256, e.g. `{"sender":"0x2222222222222222222222222222222222222222","transferId":"1"}`. Review the pending transfer and retain its ID; a stale ID is rejected. Sender cancellation and recipient rejection remain possible after expiry/recall as allowed by the contract.

### Wallet signing boundary

Preparation returns `{from,to,data,value:"0x0",chainId,gasLimit}` after `eth_call` simulation and gas estimation as the supplied sender. Registration requires MANUFACTURER_ROLE; recalls require RECALL_ROLE. Transfers obey contract ownership, stage, participant roles, pending IDs and safety rules. No generic contract-method or arbitrary transaction endpoint exists.

The supplied sender is **not authenticated** by preparation: anyone can request public calldata, but only that wallet's signature can authorize execution. The wallet must independently verify account, chain, destination, decoded intent and fees, then sign/broadcast. For an EIP-1193 wallet, use `gas` (hex quantity) converted from `gasLimit`, and verify/switch network using `chainId`; do not pass this response verbatim as RPC transaction fields. Nonce and fees are left to the wallet. Re-estimate if needed. Simulation is a point-in-time check; expiry, roles or custody can change before mining. There is no successful-execution claim or transaction-confirmation endpoint.

The API binds locally and has no CORS middleware or identity/session system. Public reads and unsigned preparation need no wallet credentials. If exposing it beyond a trusted development environment, place it behind the deployment's access/rate controls. Do not configure a private key for this service.

### Errors and tests

Errors: `{success:false,error:"CODE",message:"safe message"}`. Validation/malformed input: 400; role/participant rejection: 403; missing batch/route: 404; contract state conflicts (including stale IDs, recall, expiry): 409; oversized JSON (>32 KB): 413; missing/invalid configuration, wrong chain, absent bytecode or RPC failure: 503. Known ABI custom errors retain their names. Provider messages, URLs, stack traces and request bodies are not logged or returned.

`npm test` uses Node's test runner and a mocked read-only RPC provider with actual shared ABI encoding/decoding. It checks every supported write, reads, schema validation, rejection semantics, revert mapping, chain/code checks, error redaction and HTTP input boundaries. Tests do not start a blockchain or establish deployment readiness. Existing contract tests separately cover the Solidity state machine.
