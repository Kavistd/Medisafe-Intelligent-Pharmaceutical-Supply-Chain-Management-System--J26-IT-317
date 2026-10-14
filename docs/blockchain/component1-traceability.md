# Component 1: Blockchain medicine traceability

## Phase 1 scope

`blockchain/contracts/MedicineTraceability.sol` implements whole-batch registration,
ordered custody, recipient confirmation, recall, expiry checks and completed
transfer history. It uses the existing Solidity 0.8.20 / Hardhat configuration and
OpenZeppelin `AccessControl`. Components 2, 3 and 4 are unchanged. Deployment,
shared ABI export, backend, IPFS uploads, frontend and cross-component adapters
are outside this phase.

## Permissions

The constructor takes a nonzero administrator address. Only
`DEFAULT_ADMIN_ROLE` is granted during deployment. The administrator grants or
revokes `MANUFACTURER_ROLE`, `DISTRIBUTOR_ROLE`, `PHARMACY_ROLE` and `RECALL_ROLE`
through inherited OpenZeppelin methods. Admin privileges do not implicitly
permit registration, transfer, confirmation or recall. These permissions are
local to this contract; roles in other component contracts do not carry over.

Only manufacturers register batches. Only the owner with the role matching the
current custody stage initiates a transfer. Only the nominated recipient with
the next-stage role confirms it. Both parties' stage roles are rechecked at
confirmation. Only a `RECALL_ROLE` holder recalls batches. The original
manufacturer address remains recorded throughout custody changes.

## Registration and validation

`registerBatch(BatchData data)` accepts this tuple:

| Field | Requirement |
| --- | --- |
| `batchId` | Unique nonblank string identifier |
| `medicineId` | Nonblank medicine identifier |
| `name`, `category`, `dosageForm`, `strength` | Nonblank medicine metadata |
| `manufacturerName`, `indication`, `classification` | Nonblank metadata for later risk API mapping |
| `quantity` | Positive integer, representing the whole batch |
| `manufacturedAt` | Nonzero Unix seconds, at or before the transaction's block timestamp |
| `expiresAt` | Unix seconds strictly after manufacture and the registration block timestamp |
| `documentReference`, `certificateReference` | Nonblank IPFS references supplied by the registrant |

Text validation rejects empty strings and strings containing only ASCII spaces
or control bytes (bytes <= 32). It is not Unicode normalization or semantic
medicine validation. IDs are case-sensitive exact strings: the contract does
not trim or transform them. Clients should apply a consistent identifier policy.
Metadata and references cannot be edited after registration in this version.

Both document references are mandatory. Raw CIDs or `ipfs://` references can be
stored; the contract does not parse CID syntax, fetch files, verify certificates,
or guarantee IPFS availability. Clients must validate and pin actual IPFS
documents before submitting registration. Test reference strings are opaque
fixtures, not claims of retrievable documents. File contents stay off-chain;
all recorded metadata and references are public.

Batch IDs remain strings for the existing project interfaces. Later integration
can map `batchId` to Component 2's `batch_id`, and the metadata fields to `Name`,
`Category`, `Dosage Form`, `Strength`, `Manufacturer`, `Indication` and
`Classification`. Phase 1 does not invoke or alter that API.

## Custody state machine

Stages are `Manufacturer = 0`, `Distributor = 1`, `Pharmacy = 2`.

1. Registration makes the caller owner at the manufacturer stage.
2. `initiateTransfer(batchId, recipient)` records one pending request. The
   recipient must be nonzero, distinct from the owner, and hold the next-stage
   role. Ownership and custody stage do not change yet.
3. `confirmTransfer(batchId, transferId)` can be submitted only by that
   recipient. It validates the pending request ID, current ownership, both
   stage roles and current batch safety. It then changes owner/stage, appends
   exactly one completed history record and clears the pending request atomically.
4. Repeat for Distributor -> Pharmacy. Pharmacy is terminal.

The explicit stage, rather than the collection of roles an address holds,
determines the next permitted transition. There is no stage skipping, reverse
transfer, same-stage forwarding, self-transfer, splitting or partial quantity
transfer. The administrator cannot override custody.

Per-batch transfer IDs increase on every initiation, including requests later
cancelled. The recipient must supply the ID they reviewed, so an old signed
confirmation cannot accept a newer replacement request. Initiation alone and
failed transactions never append completed custody records.

`cancelTransfer(batchId, transferId)` lets the sender cancel or the recipient
reject. This remains available after role revocation, expiry or recall and
does not change owner, stage or completed history. Third parties, including
the administrator, cannot cancel. A cancelled request cannot be confirmed.

## Recall and expiry

`recallBatch(batchId, reason)` requires recall permission and a nonblank reason.
Recall is permanent, is allowed even after expiry, and cannot be repeated.
Recall does not transfer ownership or erase history. A pending request remains
visible for audit and cancellation but can no longer be confirmed.

Expiry is computed from chain time: `block.timestamp >= expiresAt` means
expired. No scheduled transaction is needed. Both initiation and confirmation
reject recalled or expired batches, including batches that became invalid after
initiation. Reads and cancellation remain available. `isBatchExpired` reports
expiry independently of recall.

These checks govern this contract's custody actions. They do not automatically
block prescription dispensing in Component 4 or update Component 2 risk records.

## Events and queries

Events:

- `BatchRegistered`: readable batch ID and manufacturer.
- `TransferInitiated`: request ID, sender, recipient and proposed stage.
- `TransferConfirmed`: completed request ID, sender, recipient and new stage.
- `TransferCancelled`: cancelled request ID and actor (sender or recipient).
- `BatchRecallRecorded`: recalling actor and reason.

Every event includes an indexed `batchKey = keccak256(bytes(batchId))` and an
unindexed readable string ID. The EVM transaction receipt and block provide
transaction identity and event time. OpenZeppelin also emits its role events.
Recall reasons are in event logs, while current recalled status is in storage.

Queries:

- `getBatch(batchId)`: immutable registration data, manufacturer, current owner,
  stage and recalled flag.
- `getPendingTransfer(batchId)`: ID, sender, recipient, next stage and initiation
  timestamp. ID zero indicates no pending request for an existing batch.
- `isBatchExpired(batchId)`: current chain-time expiry status.
- `getTransferHistoryCount(batchId)`: completed transfer count.
- `getTransferHistory(batchId)`: completed records in chronological order.
- `getTransferHistoryEntry(batchId, index)`: zero-based completed record.

Each completed record contains request ID, sender, recipient, destination stage,
initiation time and confirmation time. History is bounded to two records per
batch by the state machine, so returning the full array is bounded. Registration,
cancellation and recall events remain separate from completed transfer history.
Unknown batch IDs revert rather than returning fabricated default records.

## Verification

Run from `blockchain/` using the existing lockfile:

```sh
npm ci --no-audit --no-fund
npm run compile
npx hardhat test test/component1/MedicineTraceability.test.js
npm test
```

The Component 1 suite uses isolated Hardhat fixtures and controlled chain time.
It covers registration metadata and mandatory validation, role management,
both successful custody transitions, role combinations and revocation, invalid
owners/recipients/stages, pending confirmation, cancellation, stale IDs, recall,
expiry boundaries, invalidation while pending, events, history and missing IDs.
The full suite also runs the repository's existing component tests unchanged.

### Phase 1 verification results (2026-10-14)

- Lockfile installation: `npm ci --no-audit --no-fund` succeeded, adding 641
  packages without changing the manifest or lockfile.
- Compile: 9 Solidity files compiled successfully, EVM target Paris.
- Targeted Component 1 suite: 62 passing, zero failing.
- Full blockchain suite: 114 passing, zero failing. This includes the 62 new
  tests and 52 executions from the two existing copies of the 26-test
  prescription suite; these are not 52 distinct existing test cases.
- JavaScript syntax check and `git diff --check`: passed.

Environment notes: Node.js v23.10.0 produced Hardhat's unsupported-version
warning. The first sandboxed dependency installation failed with `ENOTCACHED`
and cleanup permission warnings; the approved network-enabled retry succeeded.
The first sandboxed compile failed with `EPERM` creating Hardhat's user-level
configuration directory; the approved retry downloaded Solidity 0.8.20 and
compiled successfully. npm also reported deprecations in existing locked
dependencies. No dependency versions or Hardhat settings were changed.
