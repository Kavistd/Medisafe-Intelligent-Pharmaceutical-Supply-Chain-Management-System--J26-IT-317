# Component 1 — Phase 6 local demonstration and evaluation

This automated demonstration uses the existing MedicineTraceability contract and shared ABI, the real Component 1 Express API over loopback HTTP, the frontend `api`, `connectWallet`, `sendPrepared`, `loadBatch`, `discover` and `documentRequest` helpers, and the actual signed-document gateway. It deploys only disposable **in-process Hardhat contracts** using unlocked synthetic development accounts. It never reads application `.env` files, signing keys, provider tokens, or shared deployment addresses. It never connects to a public blockchain or IPFS service.

## Exact setup and commands

Use Node **22 LTS** with native `File`/`FormData` and JSON import attributes (Node 22.12+ recommended). Node 23 runs on the recorded workstation but Hardhat does not support that version. Use the repository's three existing lockfiles; no new dependencies are introduced.

From the repository root in PowerShell:

```powershell
npm ci --prefix blockchain --no-audit --no-fund
npm ci --prefix backend/component1-traceability --no-audit --no-fund
npm ci --prefix frontend --no-audit --no-fund
Set-Location blockchain
npm run compile
node ../integration/component1-evaluation/run.js --samples 10 --out results/latest
```

The runner requires the `hardhat` in-process network and chain ID 31337. It rejects a selected external network. Do not start `hardhat node` or run deployment scripts: the runner creates its own fresh chain, grants the fixture roles, binds temporary HTTP servers on random loopback ports and closes them afterward. It does not write shared addresses or start persistent services. Output is restricted to a child directory of this evaluation folder. Successful completion prints `330/330 checks passed` with the default ten replicas. A failed assertion or setup error exits nonzero; it does not publish a new result set. Check the exit code before using previous output files.

Each replica creates fresh `FLOW-xxx`, `RECL-xxx` and `EXPR-xxx` batches with the same metadata shape. There are **16 confirmed transactions and 33 business-rule checks per replica**: 16 allowed transitions with postconditions, and 17 rejected requests checked against both API errors and direct EVM simulation. Default totals: **30 batches, 160 measured confirmed transactions, 330 rule checks**. Deployment, role grants, mocked document setup and cross-component characterization transactions are excluded from performance samples. There is no warm-up exclusion; first-replica effects remain in the distributions.

## Scenarios and independent oracles

- Registration by manufacturer; unauthorized and duplicate registration rejection.
- Manufacturer → distributor → pharmacy, with each ownership change requiring recipient confirmation.
- Recipient rejection and sender cancellation; cancelled requests never enter completed history.
- Wrong owner, stage skipping, self-transfer, wrong recipient, stale transfer ID, third-party cancellation, confirmation of a rejected request, duplicate confirmation, reverse transfer and terminal pharmacy rejection.
- Authorized recall while a transfer is pending; unauthorized recall and later custody initiation/confirmation rejection. Cancellation remains available after recall.
- EVM clock advanced to **exactly** the batch expiry; status reports expired, initiation/confirmation fail, and cancellation remains available.

For allowed requests, the frontend verifies the prepared transaction's destination, chain, sender, zero value and full ABI calldata, then the synthetic wallet adapter submits it to Hardhat. Assertions check owner, pending transfer, stage, recalled flag and completed history as appropriate. Tracking reads and pharmacy event discovery are exercised. For denied requests, the runner checks the exact HTTP status/custom error, repeats the same action using the contract's `staticCall`, and compares complete batch/pending/history snapshots before and after. Rejected calls are **simulations, not mined failed transactions**; no rejected-transaction gas is reported.

## What is real, simulated and mocked

| Layer | Evaluation behavior |
| --- | --- |
| EVM/contracts | Real Solidity bytecode, local Hardhat execution and receipts, instant automining |
| Backend | Existing Express routes, schema/CID validation, role/state simulation and unsigned preparation; real loopback HTTP |
| Frontend | Existing transaction, tracking, event and document helpers executed in Node; synthetic EIP-1193 adapter forwards to Hardhat |
| Wallet | Unlocked Hardhat test accounts; no private keys handled; no browser extension or human signing delay |
| Document gateway | Existing signature verification, nonce/freshness handling and real role queries through a local JSON-RPC bridge |
| Documents | Two public synthetic byte fixtures, real SHA-256 allowlisting and raw CIDv1 generation; references reused across batches |
| IPFS | Pin-file and retrieval responses mocked in memory; **no actual upload, distributed storage, pin availability or network measurement** |
| Component 2/3 | Real local risk/trust registries, manually seeded scores; no AI inference, live Python adapter or AHP pipeline |
| Component 4 | Real local legacy prescription contract; synthetic non-patient hash; gap characterization only |
| Browser | Not exercised; the run is service/helper end-to-end, not browser end-to-end |

## Measurement definitions

Each `gasUsed` comes from the confirmed transaction receipt, not an estimate. The contract uses the existing optimizer/configuration recorded in `results.json`. Monetary gas cost is not inferred. Operation groups include different custody stages and cancellation contexts; inspect each scenario row before comparing groups.

`performance.now()` measures milliseconds on one host:

- `prepareMs`: HTTP request through the backend and receipt of its parsed unsigned-transaction response, including preflight simulation and gas estimation.
- `walletPipelineMs`: frontend `sendPrepared` entry through receipt return, including intent/account/network verification, signer resolution, estimation and wallet RPC calls.
- `broadcastToReceiptMs`: immediately before the synthetic EIP-1193 `eth_sendTransaction` call through receipt return. This is **local automined submission latency**, not public-chain inclusion/finality or MetaMask signing latency.
- `endToEndMs`: start of backend preparation through receipt return. Evaluation-only pre/post-state snapshots, document upload, deployment, account setup and UI rendering are excluded.

Summary statistics include count, minimum, maximum, arithmetic mean, median, nearest-rank p95 (`ceil(0.95*n)`), and sample standard deviation (`n-1`; null for a single observation). Gas is stored as a decimal string in raw transaction rows. All successful samples are retained. Different host load, operating systems, Node versions, input lengths, bytecode or VM settings can change results; wall-clock latency is not deterministic.

Business-rule enforcement accuracy is `checks matching expected status/error/state outcome / checks attempted`. Allowed and denied categories are reported separately. It is finite-fixture conformance, **not** model accuracy, real counterfeit detection, a security proof or a production reliability estimate. Cross-component gap observations are excluded from this score so a missing safety integration cannot be hidden by a nominal 100% Component 1 result.

## Artifacts and provenance

`results/latest/results.json` contains raw transactions, scenario outcomes, integration observations, timestamps, Git base commit, source SHA-256 fingerprints, runtime/OS/CPU/memory, Solidity build version/settings, chain ID and sample counts. `transactions.csv` supports independent tabular analysis. `report.md` is generated directly from those rows. Source fingerprints include uncommitted implementation files; the base commit alone is not the identity of the evaluated checkout. Preserve the result directory with the source revision used for a report. From the repository root, run `node integration/component1-evaluation/verify-results.js` to recompute distributions, check CSV consistency and verify current source fingerprints. This verifies artifact consistency, not public-chain authenticity.

## Automated checks

From `blockchain/`:

```powershell
node --test --experimental-test-isolation=none ../integration/component1-evaluation/statistics.test.js ../integration/component1-evaluation/evaluation.test.js
npx hardhat test test/component1/MedicineTraceability.test.js test/component1/MedicineBatchSchema.test.js test/component1/TraceabilityDeployment.test.js
npm test
```

From `frontend/`: `npm run test:serial` and `npm run build`. From `backend/component1-traceability/`: `npm test`. Use `node --test --experimental-test-isolation=none --test-concurrency=1 tests/*.test.js` if the local sandbox blocks test subprocess creation. Do not change package files to work around a sandbox. Read the Phase 6 verification record in `docs/testing/component1-phase6-evaluation.md` for actual outcomes and unrelated failures.

## Permanent negative business-rule regression tests

The existing cases in `blockchain/test/component1/MedicineTraceability.test.js` are strengthened rather than duplicated. They reuse `loadFixture` and the existing registration/pending/distributor fixtures. The suite refuses any network other than the in-process `hardhat` network; it does not contact or reset the running application node. Only unlocked disposable accounts and synthetic batch metadata are used. Fixture document strings are contract-level placeholders, not IPFS uploads or a document-provider integration test.

| Invalid operation | Expected custom error |
| --- | --- |
| Registration without manufacturer role | `AccessControlUnauthorizedAccount(account, MANUFACTURER_ROLE)` |
| Manufacturer skips distributor and targets a pharmacy | `InvalidParticipantRole` |
| Distributor initiates without custody | `NotCurrentOwner` |
| Confirmation by someone other than the pending recipient | `NotRecipient` |
| Initiation after authorized recall | `BatchRecalled` |
| Initiation at/after expiry | `BatchExpired` |
| Registration of an existing batch ID | `BatchAlreadyExists(batchId)` |

For each strengthened rejection, a shared assertion checks the exact error using `staticCall`, then submits with an explicit gas limit to bypass estimation. Hardhat's submission-time revert includes the transaction hash; the test requires its mined receipt to have status `0` and no logs. Complete batch data (including owner, stage and recall flag), pending transfer and completed history must equal their pre-operation snapshots after both attempts. Unauthorized first registration must leave the batch absent from all three getters. Sender nonces, gas balances, block numbers and clock advancement are intentionally excluded from contract-state equality: mined reverts still consume gas/nonces. Expiry uses the isolated fixture clock, with simulation performed exactly at expiry and the failed submitted transaction mined afterward. Recall/expiry initiation is covered at both manufacturer and distributor stages.

From the repository root, using installed dependencies and current compiled artifacts:

```powershell
Set-Location blockchain
npx hardhat test --no-compile --network hardhat test/component1/MedicineTraceability.test.js test/component1/MedicineBatchSchema.test.js test/component1/TraceabilityDeployment.test.js
```

If artifacts are absent or source has changed, first run `npm run compile` from `blockchain/`. Do not substitute `--network localhost`. No application services, public RPC, wallet keys or IPFS credentials are needed. These regression checks are separate from the saved Phase 6 performance dataset: they do not regenerate it, add rejected operations to its successful transaction count, or change its reported gas/latency samples. Passing demonstrates finite-fixture business-rule conformance, not counterfeit detection accuracy or a security proof.

Verification on 20 October 2026: **98 passing, 0 failing** (62 medicine-traceability tests, 20 shared-schema tests and 16 deployment/configuration tests). Existing test cases were extended, so the test count did not increase. All seven negative categories passed the simulation/error, mined-failure receipt and state-preservation assertions. JavaScript syntax and Git whitespace checks passed. The workstation uses Node 23.10.0; Hardhat reports that runtime as unsupported despite the passing result. Use the supported Node 22 LTS setup above for subsequent reproducible runs. These are local EVM regression results, not additional browser/MetaMask verification or public-chain performance measurements.

## Integration limitations and observed safety gap

Component 1 recall/expiry checks protect custody actions. Component 4's legacy contract has no traceability link and does not automatically invalidate a prescription or risk record when a batch is recalled or expires. The runner demonstrates both gaps using safe recorded risk, trusted pharmacy, an otherwise-valid prescription and an invalid Component 1 batch. Dispensing currently succeeds; this is recorded as a **gap**, not safe end-to-end behavior. Control checks confirm unsafe/missing risk and low pharmacy trust still block dispensing. No other component is changed to fix this issue in Phase 6.

Production remediation needs an agreed cross-component policy and separately reviewed contract/backend changes (e.g. authoritative traceability checks at dispense time, time/recall-aware risk freshness and failure behavior). Merely updating the UI or caching a prior safe score cannot guarantee enforcement. Component 3's basic registry and unregistered-pharmacy defaults, legacy patient-hash privacy, V2 patient-authorization blockers, static-only hosting limitations, in-memory nonce state and external IPFS trust remain outside this evaluation's guarantees.

## Troubleshooting

- Missing module: install all three existing lockfiles from the commands above. A global `hardhat`/`ethers` is not used.
- Missing/stale artifact or ABI mismatch: compile from `blockchain/`; the runner requires exact shared/compiled ABI equality and does not silently export another ABI.
- `EPERM`/`HH505`: retry the command with the environment's explicit execution approval; do not clean global caches or rewrite toolchain configuration as an automatic workaround.
- JSON import/File errors: use a supported modern Node runtime. The recorded Node 23 environment is not a claim of Hardhat-supported compatibility.
- Unexpected expiry during a run: clock advancement is deliberate. Use the fixture names to distinguish the flow, recall and expiry batches; do not connect this runner to an existing node.
- Hanging external service: this harness uses only in-memory IPFS mocks and ephemeral loopback servers. RPC/provider timeouts remain configured; inspect the failing assertion rather than substituting production credentials.
- Existing Component 4 suite failures: report them separately; do not edit another component or interpret a passing Component 1 subset as a fully passing repository.
