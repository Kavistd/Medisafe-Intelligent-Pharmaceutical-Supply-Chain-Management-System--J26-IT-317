# Component 4 Research Evaluation & Benchmark Report
**Student:** R.A.M.A. Ranasinghe (IT23142978)  
**Project:** MediSafe Chain — Privacy-Preserving Blockchain Prescription Management (Component 4)  
**Evaluation Date:** 2026-10-20T10:56:11.826Z  
**Samples:** 10 replicas (40 confirmed transactions, 170 rule conformance checks)  

---

## 1. Smart Contract Performance & Gas Consumption

| Operation | Samples (n) | Min Gas | Median Gas | Max Gas | Mean Gas | Std Dev |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `issuePrescription` | 10 | 244033 | 244045 | 278245 | 247461 | 10816 |
| `verifyAndDispenseWithPatientHash` | 10 | 93801 | 93813 | 93813 | 93809 | 6 |
| `revokePrescription` | 10 | 53952 | 53952 | 53952 | 53952 | 0 |
| `verifyAndDispense` | 10 | 93058 | 93082 | 93082 | 93080 | 8 |

---

## 2. Execution Latency (Milliseconds)

| Operation | Preparation (ms) | Broadcast $\rightarrow$ Receipt (ms) | End-to-End (ms) |
| :--- | :---: | :---: | :---: |
| `issuePrescription` | 0.50 | 2.15 | 2.65 |
| `verifyAndDispenseWithPatientHash` | 0.50 | 1.53 | 2.03 |
| `revokePrescription` | 0.50 | 1.86 | 2.36 |
| `verifyAndDispense` | 0.50 | 1.79 | 2.29 |

---

## 3. Centralized Baseline vs. Blockchain Comparison (Proposal Section 3.3)

| Dimension | Centralized Database Prototype | Blockchain (Component 4) |
| :--- | :--- | :--- |
| **Mean Issue Latency** | 0.026 ms | 2.982 ms |
| **Mean Dispense Latency** | 0.018 ms | 2.843 ms |
| **Double-Dispense Prevention** | Vulnerable to race conditions without distributed serializable locks | **Strict atomic single-use state machine** (`ACTIVE` $\rightarrow$ `USED`) |
| **Tamper Resistance** | Vulnerable to DBA / server compromise | **Cryptographically immutable ledger** |
| **Patient Privacy** | Centralized plaintext identity risk | **Client-side `keccak256` + AES-GCM; no on-chain PII** |
| **Audit Completeness** | Ephemeral application logs | **Transparent, append-only Ethereum event logs** |

---

## 4. Client-Side Cryptographic Overhead

| Cryptographic Operation | Mean (ms) | Median (ms) | p95 (ms) |
| :--- | :---: | :---: | :---: |
| Canonicalization & Keccak-256 Hashing | 0.135 | 0.111 | 0.288 |
| PBKDF2-SHA256 (310,000 iter) + AES-GCM Encrypt | 191.565 | 189.332 | 302.226 |
| PBKDF2-SHA256 + AES-GCM Decrypt | 196.540 | 182.907 | 264.992 |

---

## 5. Business Rule Conformance Accuracy

* **Total Rule Checks:** 170
* **Passed Checks:** 170
* **Conformance Accuracy:** 100.00%
  * **Allowed Actions:** 40/40 (100.00%)
  * **Denied / Security Invariants:** 130/130 (100.00%)
