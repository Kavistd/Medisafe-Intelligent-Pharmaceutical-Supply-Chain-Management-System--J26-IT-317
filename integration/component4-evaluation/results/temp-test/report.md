# Component 4 Research Evaluation & Benchmark Report
**Student:** R.A.M.A. Ranasinghe (IT23142978)  
**Project:** MediSafe Chain — Privacy-Preserving Blockchain Prescription Management (Component 4)  
**Evaluation Date:** 2026-10-22T03:53:36.415Z  
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
| `issuePrescription` | 0.50 | 1.82 | 2.32 |
| `verifyAndDispenseWithPatientHash` | 0.50 | 2.17 | 2.67 |
| `revokePrescription` | 0.50 | 1.38 | 1.88 |
| `verifyAndDispense` | 0.50 | 1.56 | 2.06 |

---

## 3. Centralized Baseline vs. Blockchain Comparison (Proposal Section 3.3)

| Dimension | Centralized Database Prototype | Blockchain (Component 4) |
| :--- | :--- | :--- |
| **Mean Issue Latency** | 0.027 ms | 2.321 ms |
| **Mean Dispense Latency** | 0.014 ms | 2.675 ms |
| **Double-Dispense Prevention** | Vulnerable to race conditions without distributed serializable locks | **Strict atomic single-use state machine** (`ACTIVE` $\rightarrow$ `USED`) |
| **Tamper Resistance** | Vulnerable to DBA / server compromise | **Cryptographically immutable ledger** |
| **Patient Privacy** | Centralized plaintext identity risk | **Client-side `keccak256` + AES-GCM; no on-chain PII** |
| **Audit Completeness** | Ephemeral application logs | **Transparent, append-only Ethereum event logs** |

---

## 4. Client-Side Cryptographic Overhead

| Cryptographic Operation | Mean (ms) | Median (ms) | p95 (ms) |
| :--- | :---: | :---: | :---: |
| Canonicalization & Keccak-256 Hashing | 0.125 | 0.125 | 0.190 |
| PBKDF2-SHA256 (310,000 iter) + AES-GCM Encrypt | 126.199 | 126.199 | 128.654 |
| PBKDF2-SHA256 + AES-GCM Decrypt | 119.750 | 119.750 | 120.528 |

---

## 5. Business Rule Conformance Accuracy

* **Total Rule Checks:** 34
* **Passed Checks:** 34
* **Conformance Accuracy:** 100.00%
  * **Allowed Actions:** 8/8 (100.00%)
  * **Denied / Security Invariants:** 26/26 (100.00%)
