# Component 1 Sepolia deployment, roles and application setup

Hardhat remains the default chain (31337). Sepolia (11155111) is opt-in. Contracts, local deployment addresses, local profiles and mock-IPFS launchers are unchanged. Real IPFS upload/retrieval testing is postponed.

## Completed Sepolia deployment and role grants

The following operations were separately approved and completed. They are public Sepolia records, distinct from the archived local Phase 6 measurements. This documentation update sends no transactions. Any additional deployment or role grant requires new explicit approval; deployment permission remains disabled afterward.

| Deployment item | Confirmed value |
| --- | --- |
| Chain ID | `11155111` |
| Contract | `0xe3095b57F50421452f5795A39888258E9Fce764e` |
| Deployment transaction | `0x76d9c3bdf56ebd4cf40bf6b2b5dc0902f82981fc0e49826e023cfddbd48e39b5` |
| Deployment block / receipt status | `11956334` / `1` |
| Deployer and administrator | `0x60139DD535F2A86897fcc6E72062C38681954fDb` |
| Actual deployment gas used | `19383985` |
| Actual deployment cost | `0.00001938429514376 SepoliaETH` |

Runtime bytecode matched the compiled artifact and the administrator's `DEFAULT_ADMIN_ROLE` was verified after confirmation. The intended `sepolia.MedicineTraceability` registry entry was updated; ABI content and all local/other-component address entries were preserved. [Deployment transaction](https://sepolia.etherscan.io/tx/0x76d9c3bdf56ebd4cf40bf6b2b5dc0902f82981fc0e49826e023cfddbd48e39b5).

| Granted role | Participant | Transaction | Block |
| --- | --- | --- | --- |
| `MANUFACTURER_ROLE` | `0xdcB391382C947edf3a6EEF6C9C13A5C88fa3a1C9` | `0x175883335ce493b1e94b5fccef1f2627202df8bf06125cb812e65de208c25544` | `11956535` |
| `DISTRIBUTOR_ROLE` | `0xa141a0E3e415A3Ad07c43d24048C01B522a59aDe` | `0x6ea33f820399a3924411e7c5bea1b85293888b90808edc4c616ba857a2d7ac84` | `11956536` |
| `PHARMACY_ROLE` | `0x4C3F7B414691692686d3ebf9F14AB6e79fCFa2ca` | `0xe76e83da2f19c81e3dd35e8e47397fe71dcc591c82653d9b68e213d40ad2fddd` | `11956538` |

Each receipt had status `1`, used `133579` gas and cost `0.000000133581270843 SepoliaETH`. Total actual grant cost was `0.000000400743812529 SepoliaETH`, below the approved maximum `0.000000484909486362 SepoliaETH`. Each intended role was verified with `hasRole`; none of these participants received `DEFAULT_ADMIN_ROLE` or `RECALL_ROLE`. These are the recorded post-transaction checks, not a claim that roles cannot change later.

The previously missing signing-key `0x` prefix was corrected locally. The installed Hardhat configuration subsequently accepted the format and the complete preflight passed before deployment. No signing material belongs in this document. The separate Sepolia application profiles have been populated and activated; runtime service availability depends on the user's running terminals. MetaMask/browser interaction must be verified separately. Real Pinata upload and retrieval testing remains postponed.

## Separate ignored profiles

- `integration/component1-sepolia/.env`: deployment-only RPC/signing configuration. It starts with empty `RPC_URL`, `PRIVATE_KEY`, `TRACEABILITY_ADMIN`, role-file path and contract address; `TRACEABILITY_ALLOW_SEPOLIA=false`. Never give this file to Vite or the API. The existing Hardhat script supports a locally configured signer; never share its private key or recovery phrase. Never use public Hardhat account keys on Sepolia.
- `backend/component1-traceability/.env.sepolia.local`: read-only Sepolia RPC/preparation API. No signing keys or provider credentials. Document operator token and publication allowlist stay empty, so document API is disabled.
- `frontend/.env.sepolia.local`: public chain/address/block and server-only gateway RPC. Document operator token stays empty. No provider JWT or signing key belongs here.

All three are Git-ignored. The checked-in README contains no credentials. Obtain a Sepolia HTTPS RPC endpoint and test ETH for fresh disposable participant accounts. Pinata credentials are not involved. Recommended runtime: Node 22 LTS (the workstation's Node 23 is unsupported by Hardhat).

## Procedure for any future separately approved deployment

1. Configure the deployment RPC and administrator locally without printing secrets or typing keys in terminal history. Do not enable `TRACEABILITY_ALLOW_SEPOLIA` until deployment approval.
2. Run Component 1 contract tests on `--network hardhat`, not `localhost` or Sepolia. Confirm compiled/shared ABI equality, bytecode, test balance, RPC chain ID, administrator and intended role accounts. The read-only preflight command below contacts Sepolia but does not broadcast.
3. Review the four role arrays in `blockchain/config/traceability-roles.example.json`; create a separate reviewed public-address assignment file and set its absolute path in `TRACEABILITY_ROLES_FILE`. An empty array is allowed, but all four keys are required. Use distinct manufacturer/distributor/pharmacy accounts. Role setup must be signed by the configured administrator, which can differ from deployer.
4. Approve deployment separately, including the script's shared ABI/address writes. Do not run local setup or change local address settings to switch networks.

Commands below run from `blockchain/`. Deployment and role-grant commands spend test ETH. The completed operations above do not authorize rerunning them; any new transaction requires separate approval:

```powershell
# Offline verification, safe now
npx hardhat test --no-compile --network hardhat test/component1/MedicineTraceability.test.js test/component1/MedicineBatchSchema.test.js test/component1/TraceabilityDeployment.test.js test/component1/TraceabilityPreflight.test.js

# Read-only Sepolia preflight, allowed while TRACEABILITY_ALLOW_SEPOLIA=false
node --env-file=../integration/component1-sepolia/.env node_modules/hardhat/internal/cli/cli.js run scripts/interactions/preflight_traceability.js --no-compile --config hardhat.traceability.config.js --network sepolia

# ONLY after separate deployment approval and local opt-in
node --env-file=../integration/component1-sepolia/.env node_modules/hardhat/internal/cli/cli.js run scripts/deploy/deploy_traceability.js --config hardhat.traceability.config.js --network sepolia

# ONLY after separate role-grant approval
node --env-file=../integration/component1-sepolia/.env node_modules/hardhat/internal/cli/cli.js run scripts/interactions/setup_traceability_roles.js --config hardhat.traceability.config.js --network sepolia
```

The Hardhat config reads environment variables, not dotenv files automatically. Node's explicit env-file option above loads only the isolated deployment profile. Use a fresh terminal without conflicting inherited environment variables. Script errors redact RPC/provider details, but unexpected toolchain errors may not; never share raw credential-bearing output.

The deployment script records the confirmed address in only `sepolia.MedicineTraceability` in `shared/blockchain/contract-addresses.json` and exports `shared/abis/MedicineTraceability.json`. Local and other-component address entries are preserved. Record the deployment transaction hash/block/admin; do not blindly redeploy after a file-write failure. No automatic explorer source verification is configured.

## Gas preflight and Glamsterdam compatibility

Sepolia activated Glamsterdam on 6 October 2026. [EIP-8037](https://eips.ethereum.org/EIPS/eip-8037) reprices new state and separates state gas from execution gas; the EIP-7825 16,777,216 limit applies to execution gas, not the combined estimate. A combined estimate above that value is not automatically invalid. See the [Ethereum Foundation announcement](https://blog.ethereum.org/en/2026/09/17/glamsterdam-testnet-announcement). The standard RPC estimate does not provide an execution/state breakdown; the preflight reports this limitation explicitly rather than inventing one. It conservatively checks its padded total against both the current block gas limit and the EIP-8037 total ceiling of 2^32-1.

The reusable `blockchain/scripts/lib/traceability-preflight.js` constructs precisely the compiled creation bytecode plus the administrator argument, rejects unexpected linked libraries, checks live chain ID 11155111 before and after simulation, obtains fresh gas/EIP-1559 fees and balance, and uses a rounded-up 20% gas margin. It requires enough balance for `gasLimit * maxFeePerGas`. The creation `eth_call` must return exactly the compiled runtime bytecode. It neither deploys nor changes state, and works with deployment disabled. Expected fee errors, insufficient balance, wrong network, oversized gas budgets or failed simulation block the deployment path.

The actual Sepolia deployment script independently retains the existing explicit approval gate, invokes the same preflight, and forwards explicit `gasLimit`, chain ID, EIP-1559 fees and zero value to the contract factory. Local deployment behavior is unchanged. Do not use `gasMultiplier` to add the margin: installed Hardhat multiplier code contains legacy total-gas clamps. The explicit gas override avoids re-estimation/clamping in the installed signer path. Automated tests intercept both the factory and the installed Hardhat signer's RPC submission boundary to check the exact fields without sending any transaction or accessing real signing keys. This proves local transaction construction, not mempool acceptance, inclusion or finality on Sepolia.

Read-only refresh at Sepolia block 11,956,268: estimate **19,538,993**, proposed gas limit **23,446,792**, maximum fee **0.001000032 Gwei**, priority fee **0.001 Gwei**. Expected cost at the observed base fee plus tip: **0.000019539305623888 SepoliaETH**. Maximum padded budget: **0.000023447542297344 SepoliaETH**, against **0.05 SepoliaETH**, leaving **0.049976552457702656 SepoliaETH** after reserving the budget. The creation simulation matched the 12,325-byte runtime. These are dated estimates, not a deployment receipt or a permanent fee quote. A future approved deployment refreshes all figures; pending transactions, changing balance/fees, provider limits and client fork compatibility remain risks. No source/compiler/ABI changes are needed for this gas difference.

Regression verification for the preflight update: **109 passing, 0 failing** (the existing 98 Component 1 tests plus 11 preflight/tooling tests). Syntax and whitespace checks passed. Direct read-only provider preflight and creation simulation succeeded. The initial key-prefix format issue was subsequently resolved and Hardhat preflight passed; it is no longer a deployment blocker. Tooling-boundary tests use synthetic addresses and intercepted submission; the separate public transaction evidence is recorded above.

## Separate application profiles and service startup

The approved application switch populated the confirmed address above in both profiles, block `11956334` in the frontend discovery configuration and backend provenance setting, and the same trusted Sepolia RPC in backend `WEB3_RPC_URL` and frontend server-only `TRACEABILITY_RPC_URL`. The backend block setting is informational; its routes do not use it. The public chain setting is `VITE_TRACEABILITY_CHAIN_ID=11155111`. Never put RPC credentials in a `VITE_` variable. No API signing key is needed. On a new machine, populate the ignored profiles locally using these public values and your own server-side RPC settings.

The frontend validates wallet chain, sender, destination, zero value and complete expected calldata. Document signature domains bind to the configured chain, and gateway role authorization queries `eth_chainId` before every role check rather than trusting a cached network. Unsupported network IDs fail closed. Backend configuration independently enforces the selected RPC chain. Match all profiles; changing frontend settings alone cannot switch the backend.

Both APIs use port 5001; run only one Component 1 backend at a time. After approval, stop only the local Component 1 API/frontend terminals (never Hardhat), then:

```powershell
# Terminal A, from backend/component1-traceability/
node --env-file=.env.sepolia.local server.js
# Terminal B, from frontend/: mode-specific profile overrides local settings
node node_modules/vite/bin/vite.js --mode sepolia --host 127.0.0.1 --port 5173 --strictPort
```

Open `/traceability.html`; enable MetaMask test networks and choose Ethereum Sepolia (11155111). The header reflects the configured network. Reconnect the wallet after switching networks. This is Component 1 configuration only; it does not deploy or certify Components 2–4 on Sepolia. Build with `node node_modules/vite/bin/vite.js build --mode sepolia` and preview with `node node_modules/vite/bin/vite.js preview --mode sepolia`. Direct CLI commands avoid PowerShell/npm argument-forwarding differences. Static-only hosting does not provide the document gateway. Builds share `frontend/dist`; build the intended mode again before serving those artifacts.

Verify each participant's `hasRole`, fund test accounts, register a new synthetic batch and complete manufacturer → distributor → pharmacy with recipient confirmations and recorded receipts/history. Existing mock document CIDs may be used as placeholders only: do not claim public pinning or download availability. The API validates CID syntax, not authenticity or retrieval. Keep all IPFS approval allowlists empty. Use isolated tests for recall/expiry time travel and negative cases; Sepolia cannot use Hardhat clock/reset methods.

To restore the unchanged local application, stop only the Sepolia API/frontend and run the existing `integration/component1-local/start-backend.js` and `start-frontend.js` launchers from the repository root. Their managed profiles and local chain stay intact.

## Automated verification (distinct from public transactions)

The latest pre-push automated checks passed: 60 frontend tests (including existing Component 4 tests), 18 backend tests, 109 isolated Component 1 contract/schema/deployment/preflight tests, and 4 local mock-launcher tests. Both default and Sepolia production builds passed. Sepolia role/RPC automated tests use injected mock providers and synthetic wallet signatures. Tests exercise matching/mismatched chains, unsupported IDs, prepared-transaction intent, cross-chain document signature rejection and existing nonce/freshness protections. These automated checks send no public transactions or IPFS uploads; the separately approved completed public transactions are listed above. The historical Phase 6 archive has its own [provenance and audit](../component1-evaluation/PROVENANCE.md).

From `frontend/`: `npm run test:serial`, `npm run build`, and `node node_modules/vite/bin/vite.js build --mode sepolia`. From `backend/component1-traceability/`: `node --test --experimental-test-isolation=none --test-concurrency=1 tests/documents.test.js tests/traceability.test.js`. From the repository root: `node --test --experimental-test-isolation=none integration/component1-local/local.test.js`. The contract command is above. An initial sandbox build failed with `spawn EPERM`; approved execution succeeded. Initial npm forwarding of `--mode sepolia` failed on this PowerShell setup; the direct CLI command succeeded. Neither is a Solidity or application test failure.
