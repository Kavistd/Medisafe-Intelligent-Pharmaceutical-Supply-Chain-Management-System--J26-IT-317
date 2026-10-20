# Component 4 Research Evaluation & Benchmark Report
**Student:** R.A.M.A. Ranasinghe (IT23142978)  
**Project:** MediSafe Chain — Privacy-Preserving Blockchain Prescription Management (Component 4)  
**Evaluation Date:** 2026-10-20T11:03:54.259Z  
**Samples:** 2 replicas (8 confirmed transactions, 34 rule conformance checks)  

---

## 1. Smart Contract Performance & Gas Consumption

| Operation | Samples (n) | Min Gas | Median Gas | Max Gas | Mean Gas | Std Dev |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `issuePrescription` | 2 | 244045 | 261145 | 278245 | 261145 | 24183 |
| `verifyAndDispenseWithPatientHash` | 2 | 93813 | 93813 | 93813 | 93813 | 0 |
| `revokePrescription` | 2 | 53952 | 53952 | 53952 | 53952 | 0 |
| `verifyAndDispense` | 2 | 93082 | 93082 | 93082 | 93082 | 0 |

---

## 2. Execution Latency (Milliseconds)

| Operation | Preparation (ms) | Broadcast $\rightarrow$ Receipt (ms) | End-to-End (ms) |
| :--- | :---: | :---: | :---: |
| `issuePrescription` | 0.50 | 5.50 | 6.00 |
| `verifyAndDispenseWithPatientHash` | 0.50 | 6.46 | 6.96 |
| `revokePrescription` | 0.50 | 3.93 | 4.43 |
| `verifyAndDispense` | 0.50 | 5.24 | 5.74 |

---

## 3. Centralized Baseline vs. Blockchain Comparison (Proposal Section 3.3)

| Dimension | Centralized Database Prototype | Blockchain (Component 4) |
| :--- | :--- | :--- |
| **Mean Issue Latency** | 0.049 ms | 6.000 ms |
| **Mean Dispense Latency** | 0.037 ms | 6.956 ms |
| **Double-Dispense Prevention** | Vulnerable to race conditions without distributed serializable locks | **Strict atomic single-use state machine** (`ACTIVE` $\rightarrow$ `USED`) |
| **Tamper Resistance** | Vulnerable to DBA / server compromise | **Cryptographically immutable ledger** |
| **Patient Privacy** | Centralized plaintext identity risk | **Client-side `keccak256` + AES-GCM; no on-chain PII** |
| **Audit Completeness** | Ephemeral application logs | **Transparent, append-only Ethereum event logs** |

---

## 4. Client-Side Cryptographic Overhead

| Cryptographic Operation | Mean (ms) | Median (ms) | p95 (ms) |
| :--- | :---: | :---: | :---: |
| Canonicalization & Keccak-256 Hashing | 0.324 | 0.324 | 0.466 |
| PBKDF2-SHA256 (310,000 iter) + AES-GCM Encrypt | 339.119 | 339.119 | 361.350 |
| PBKDF2-SHA256 + AES-GCM Decrypt | 268.067 | 268.067 | 308.732 |

---

## 5. Business Rule Conformance Accuracy

* **Total Rule Checks:** 34
* **Passed Checks:** 34
* **Conformance Accuracy:** 100.00%
  * **Allowed Actions:** 8/8 (100.00%)
  * **Denied / Security Invariants:** 26/26 (100.00%)
