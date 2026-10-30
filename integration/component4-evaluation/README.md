# Component 4 — Empirical Evaluation and Research Benchmarking

**Author:** R.A.M.A. Ranasinghe (IT23142978) — Component 4  
**Project:** MediSafe Chain: Privacy-Preserving Blockchain Prescription Management  

---

## 1. Overview

This directory provides the automated empirical evaluation framework for **Component 4 (Privacy-Preserving Blockchain Prescription Management)**, fulfilling the research methodology, performance evaluation, baseline comparison, and security testing requirements specified in the **SLIIT IT4010 Project Proposal Report** (Sections 3.3, 3.4, 3.5) and **Topic Assessment Form**.

The evaluation runner executes:
1. **Smart Contract Gas Benchmarks**: Measures on-chain execution cost across all state-modifying functions (`issuePrescription`, `verifyAndDispenseWithPatientHash`, `revokePrescription`, `verifyAndDispense`).
2. **Execution Latency Profiling**: Measures preparation, broadcast-to-receipt, and end-to-end latency for blockchain operations on Hardhat EVM.
3. **Centralized Baseline Comparison**: Benchmarks against a traditional centralized relational/in-memory electronic prescription prototype, analyzing latency tradeoffs, tamper risks, and race condition double-dispense vulnerabilities.
4. **Client-Side Cryptographic Profiling**: Measures WebCrypto PBKDF2-SHA256 key derivation, AES-GCM encryption/decryption, and Keccak-256 patient hashing overhead.
5. **Multi-Layer Business Rule Conformance**: Verifies 100% enforcement across 17 distinct scenarios (including unauthorized access, double dispensing, revoked/expired states, patient hash mismatches, Component 2 AI risk score limits, and Component 3 pharmacy trust limits).

---

## 2. Quick Start & Execution

From the workspace root, run the evaluation suite:

```bash
# Run 10 evaluation replicas
node integration/component4-evaluation/run.js --samples 10

# Verify generated results and consistency
node integration/component4-evaluation/verify-results.js

# Run automated evaluation unit tests
node --test integration/component4-evaluation/evaluation.test.js
```

---

## 3. Deliverables and Artifacts

Output files are stored in `integration/component4-evaluation/results/latest/`:
* `results.json`: Complete raw metrics, environmental provenance, gas distributions, and scenario assertion records.
* `transactions.csv`: Tabular export of all confirmed transaction hashes and gas metrics for external spreadsheet/statistical analysis.
* `baseline_comparison.csv`: Direct comparative latency and gas metrics between the Centralized Baseline and Blockchain.
* `report.md`: Markdown summary report with KaTeX tables ready for incorporation into the final thesis report.
