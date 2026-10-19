# Component 1 Phase 6 verification and research evaluation

Recorded on **19 October 2026**. No other component's implementation or shared configuration was changed. All blockchain deployments were disposable in-process Hardhat fixtures; no public network or real document service was used.

## Reproduce

See [local setup, commands, methodology and troubleshooting](../../integration/component1-evaluation/README.md). From `blockchain/`, after installing the three existing lockfiles and compiling:

```powershell
node ../integration/component1-evaluation/run.js --samples 10 --out results/latest
node --test --experimental-test-isolation=none ../integration/component1-evaluation/statistics.test.js ../integration/component1-evaluation/evaluation.test.js
```

From the repository root, audit the output with:

```powershell
node integration/component1-evaluation/verify-results.js
```

## Recorded sample and environment

- Ten sequential replicas, thirty synthetic batches, **160 confirmed measured transactions**.
- **330 rule-conformance checks:** 160 allowed transitions and 170 rejected requests. Each denied request is checked through both API preparation and EVM static simulation, with unchanged batch/pending/history state. These paired layer checks count as one scenario, not two observations.
- Two approved synthetic documents uploaded and one retrieved through the real frontend helper, signed gateway, on-chain roles and backend. Pinning/content delivery were mocked. No IPFS performance metric was collected.
- Windows x64, OS release 10.0.26200, Intel Core i7-13620H, 16 logical CPUs, approximately 16.87 GB physical memory.
- Node v23.10.0; Hardhat 2.29.1; Solidity 0.8.20+commit.a1b79de6; optimizer enabled, 200 runs; EVM target Paris; chain ID 31337; instant automining. Node 23 is unsupported by Hardhat; reproduce on Node 22 LTS before treating timing as portable.
- Raw collection timestamp: `2026-10-19T09:44:08.530Z`; base commit: `ca74730595d1821ce4f72cf88933f79caeacb95c`. The new evaluator was uncommitted; its source SHA-256 fingerprints, dependency lockfile fingerprints and runtime details are recorded alongside raw outcomes. Compiled build inputs were also checked against all four current contract sources.

## Measured results

| Operation | n | Median receipt gas | Median local broadcast→receipt ms | Median preparation→receipt ms |
| --- | ---: | ---: | ---: | ---: |
| registerBatch | 30 | 535,623 | 21.423 | 110.969 |
| initiateTransfer | 60 | 140,034 | 21.327 | 102.555 |
| cancelTransfer (sender and recipient) | 40 | 39,523 | 16.376 | 110.013 |
| confirmTransfer | 20 | 166,692 | 17.543 | 111.863 |
| recallBatch | 10 | 35,097 | 18.005 | 86.563 |

Values above are copied from the generated report for the recorded run. Rerunning intentionally replaces `results/latest` and will change timing values; update this dated narrative or preserve a separately named result directory when collecting another report dataset. No samples were discarded. Gas groups include multiple custody/cancellation contexts, explaining their ranges. Deployment, role grants, rejected simulations, document setup and cross-component fixture transactions are excluded from gas/latency summaries. These numbers measure a single-host local automined system, not public-chain mining/finality, throughput or human wallet response time.

**Business-rule enforcement: 330/330 matched expected outcomes (100% on this finite synthetic scenario set).** Allowed checks: 160/160; denied checks: 170/170. This is not counterfeit-detection accuracy, real-world reliability, or proof of complete security. Recall/expiry propagation failures below are deliberately outside this Component 1 score.

Full distributions (including min/max, mean, nearest-rank p95 and sample standard deviation), transaction hashes, per-scenario outcomes and source identity are in [results.json](../../integration/component1-evaluation/results/latest/results.json). See [transactions.csv](../../integration/component1-evaluation/results/latest/transactions.csv) and the [generated report](../../integration/component1-evaluation/results/latest/report.md).

## Functional outcomes and cross-component gaps

The demonstration passed manufacturer registration; event discovery; manufacturer → distributor → pharmacy custody; recipient confirmation/rejection; sender cancellation; direct tracking/history; role and sequence rejection; stale/duplicate confirmation rejection; recall invalidation of pending confirmation; exact-boundary expiry rejection; and cancellation after invalidation. On-chain gas came from actual successful transaction receipts.

Real local Component 2/3/4 contract fixtures characterize the existing links without modifying them. Manually recorded unsafe/missing risk results and low pharmacy trust correctly block legacy dispensing. The risk values are seeded fixtures, not model predictions; no Component 2 Python service, training artifact or AHP trust computation was exercised by this harness.

**A safety integration gap was reproduced:** the legacy prescription contract successfully dispensed one recalled batch and one expired batch when their recorded risk was safe, the pharmacy was trusted, and the prescription itself was active/unexpired. Component 4 currently has no authoritative Component 1 recall/expiry link. A positive Component 1 conformance score must not be described as safe manufacturer-to-patient integration. Remediation needs separately approved cross-component policy/contract changes. Static UI warnings or previously published risk scores cannot alone enforce current batch validity.

## Verification results and outstanding failures

| Check | Actual result |
| --- | --- |
| Phase 6 statistics, CLI and one-replica integration tests | 5 passed |
| Ten-replica evaluation | 330/330 rule checks, 160 confirmed measured transactions |
| Saved-result audit | Raw rows, summary, CSV and source fingerprints match |
| Component 1 backend (`node --test --experimental-test-isolation=none --test-concurrency=1 tests/*.test.js`) | 18 passed |
| All frontend tests (`npm run test:serial`) | 46 passed, including Component 4 |
| Frontend production build | Passed for both `/` and `/traceability.html` |
| Component 1 contract/schema/deployment subset | 98 passed |
| Full blockchain suite (`hardhat test --no-compile`) | **202 passed, 6 failed** |
| Component 2 Python suite (`python -m pytest backend/component2-risk-scoring/tests -q -p no:cacheprovider`) | **Could not start: selected Python 3.13 lacks pytest** |

The six blockchain failures are the existing Component 4 failures previously identified before Phase 6:

1. Five V2 tests expect `PatientAuthorizationUnavailable`, `PharmacyNotRegistered`, `PharmacyNotTrusted`, or `LowPharmacyTrust`, but get an unreasoned revert because the actual PharmacyTrust fixture lacks V2's required `isPharmacyRegistered` function. This includes two expectations for `PatientAuthorizationUnavailable`.
2. The legacy duplicated prescription test expects `MedicineRiskNotAssessed`, but the current contract exposes `RiskRecordNotFound`.

Neither failing suite nor another component was edited to hide these failures. The working tree contains only new Phase 6 integration/evaluation artifacts and this document. Python dependencies were not installed or changed as a side effect; rerun the existing Python suite in an appropriately provisioned Component 2 environment before claiming full regression coverage.

## Remaining limits

No browser rendering/MetaMask automation, public-chain deployment, real IPFS publication, distributed pin durability, concurrent-load benchmark, service-restart recovery, proof of document issuer authenticity, patient privacy evaluation or real AI inference is claimed. The synthetic PDF byte fixtures have supported signatures, not production certification. Document references are reused and do not establish binding between a laboratory report and a real batch. The frontend's per-process nonce cache and local Vite document adapter remain development infrastructure. Component 3's basic registry is exercised at contract level only. All real-world deployments still need roles, consistent addresses, operational IPFS service, supported runtime and cross-component safety enforcement.
