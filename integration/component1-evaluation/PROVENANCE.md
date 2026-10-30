# Historical Phase 6 evaluation provenance

The files in `results/latest/` are an archived local evaluation, despite the directory name `latest`. They are not measurements of the current Sepolia deployment or the subsequently updated frontend.

## What can be established

- Recorded collection time: `2026-10-19T09:44:08.530Z`.
- Recorded base commit: `ca74730595d1821ce4f72cf88933f79caeacb95c`.
- The evaluator was uncommitted at collection. Three fingerprinted evaluator source files are absent from that base commit. Therefore the base commit alone is not the evaluated source tree.
- Commit `483709f1dd29f68e2d0750ec6c6be9a0feba456a` introduced the saved result files. All **16 recorded source fingerprints** can be reproduced from that commit: ten match Git blob bytes directly and six match after reconstructing Windows CRLF checkout line endings (the four contract sources, blockchain lockfile and frontend lockfile).
- This establishes a matching committed snapshot for the captured sources. It does **not** uniquely establish the execution-time revision or the state of files that were not fingerprinted. The exact full execution-time source revision remains **unverified**; it must not be relabeled as commit `483709f...` in the original dataset.

The historical run predates the current changes to `frontend/src/component1/client.js` and `frontend/component1-document-gateway.js`, including dual-network configuration, chain-bound document messages, live gateway chain checks and later wallet-provider selection. It does not evaluate those changes. A future evaluation of the current implementation must use a separately named output directory and retain its own provenance.

## Preserved artifacts

The original JSON, CSV and generated report are unchanged. Their SHA-256 values at this review are:

| File under `results/latest/` | SHA-256 |
| --- | --- |
| `results.json` | `d9a8cdd007007ce40a0ea232309ed1ec45cfd27c9682131d152413d5ae583233` |
| `transactions.csv` | `58c37b5cc9e98c5ea955f74575bd32e9bedffc24321885c7492c258e6a5480f8` |
| `report.md` | `96720f983ffb1f547e240dfee976ed8863172bbc4e40ff3242bb4b0efc67fab4` |

The archive contains **10 replicas, 30 synthetic batches, 160 confirmed measured transactions and 330 rule checks**. Its stored gas, latency, summaries and transaction rows have not been regenerated, edited or replaced. These remain local automined measurements with mocked IPFS and helper-level integration, not Sepolia or browser performance measurements. Rule-check conformance is not real-world counterfeit-detection accuracy.

## Reproduce the audit without checkout or result regeneration

From the repository root:

```powershell
node integration/component1-evaluation/verify-results.js --source-revision 483709f1dd29f68e2d0750ec6c6be9a0feba456a
node --test --experimental-test-isolation=none integration/component1-evaluation/provenance.test.js
```

This explicit historical mode reads Git objects without modifying refs, the index or the working tree. It verifies raw counts, outcomes, summary distributions, CSV rows and all recorded source hashes. Only Git-LF to Windows-CRLF reconstruction is permitted as an alternative byte representation; substantive code changes still fail. A full history containing the commit is required. In a sandbox that blocks Git subprocesses, request execution permission rather than changing audit expectations.

`node integration/component1-evaluation/verify-results.js` remains a strict current-working-tree audit. It currently fails because the two frontend sources have changed. That failure is expected and remains visible: historical-mode success must not be presented as current-source validation. No fingerprint is rewritten and no source mismatch is silently skipped.
