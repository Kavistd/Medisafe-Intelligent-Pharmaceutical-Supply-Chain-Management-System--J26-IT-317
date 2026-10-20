# Component 4 Research Evaluation & Technical Report

**Project:** MediSafe Chain — Intelligent Pharmaceutical Supply Chain Management System with AI-Driven Medicine Risk Scoring  
**Sub-Topic:** Component 4: Privacy-Preserving Blockchain Prescription Management  
**Project ID:** J26-IT-317  
**Student:** R.A.M.A. Ranasinghe (IT23142978)  
**Supervisors:** Dr. Junius Anjana, Mr. Nelum Amaraweera  
**Institution:** Sri Lanka Institute of Information Technology (SLIIT)  
**Evaluation Date:** October 2026  

---

## 1. Executive Summary & Research Context

Prescription forgery, duplicate dispensing ("doctor shopping" / pharmacy hopping), and patient privacy exposure represent critical vulnerabilities in traditional paper-based and centralized electronic prescription systems. Component 4 of MediSafe Chain implements an auditable, privacy-preserving, decentralized Prescription Drug Monitoring Program (PDMP) on the Ethereum blockchain.

This report documents the empirical evaluation, performance benchmarking, baseline comparison, and security validation of Component 4, fulfilling the research methodology and evaluation requirements defined in the **SLIIT IT4010 Project Proposal Report** (Sections 3.3, 3.4, 3.5) and the **Topic Assessment Form**.

---

## 2. Alignment with Research Objectives

| Proposal Objective | Implementation in Codebase | Conformance / Test Evidence |
| :--- | :--- | :--- |
| **Design prescription data model** | `Prescription` struct containing `prescriptionId`, `patientHash`, `medicineId`, `batchId`, `doctorAddress`, timestamps, and `status`. | Enforced in `PrescriptionRegistry.sol`, validated by schemas. |
| **Implement role-based access control** | OpenZeppelin `AccessControl` with `DOCTOR_ROLE`, `PHARMACY_ROLE`, and `DEFAULT_ADMIN_ROLE`. EIP-191 personal_sign session gating on backend. | 100% rejection of unauthorized actors across smart contract and REST API. |
| **Prevent prescription forgery & alteration** | Immutable on-chain state machine; status transitions emit tamper-evident Ethereum events. | Rejection of duplicate IDs and unauthorized updates. |
| **Prevent prescription reuse** | Atomic `ACTIVE` $\rightarrow$ `USED` state change on single dispensing; subsequent attempts strictly revert. | 100% duplicate-dispensing rejection rate. |
| **Protect patient privacy** | Client-side canonicalization + 32-byte salt + `keccak256` hashing + local AES-GCM encrypted preparation file. Raw PII never touches blockchain or backend. | Verified zero raw identity leakage across contracts, transactions, and API responses. |
| **Integrate risk and trust verification** | Automated multi-layer contract calls: Component 2 (`MedicineRiskRegistry`) and Component 3 (`PharmacyTrust`). | Dispensing strictly blocked when risk score > 50, batch unsafe/unassessed, or pharmacy untrusted. |
| **Develop user interfaces** | Role-tailored dashboards for Doctor, Pharmacy, and Patient using React and `ethers.js`. | Complete V1 portal with client-side credential encryption and MetaMask wallet signing. |
| **Empirical evaluation & baseline comparison** | Automated benchmark harness (`integration/component4-evaluation/run.js`) and Centralized Baseline prototype. | 170/170 rule checks passed; gas, latency, and race condition benchmarks recorded. |

---

## 3. Experimental Setup & Benchmark Environment

All empirical data were collected using the automated evaluation harness (`integration/component4-evaluation/run.js`):
* **Execution Environment:** In-process Hardhat EVM (Solidity `0.8.20`, optimizer enabled with 200 runs, Chain ID `31337`, instant automining).
* **Workstation Hardware:** Windows x64, Intel Core i7 (16 logical CPUs), 16 GB RAM, Node.js `v22 LTS`.
* **Synthetic Dataset:** 10 sequential replicas executing 40 confirmed state-modifying transactions and 170 distinct business-rule assertions.
* **Client Cryptography:** WebCrypto API utilizing PBKDF2-SHA256 (310,000 iterations), AES-GCM (256-bit key), and Keccak-256.

---

## 4. Smart Contract Gas & Economic Analysis

Gas metrics measure the exact EVM execution effort from mined transaction receipts:

| Smart Contract Method | n | Min Gas | Median Gas | Max Gas | Mean Gas | Standard Deviation |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `issuePrescription` | 10 | 244,033 | 244,045 | 278,245 | 247,461 | 10,816 |
| `verifyAndDispenseWithPatientHash` | 10 | 93,801 | 93,813 | 93,813 | 93,809 | 6 |
| `revokePrescription` | 10 | 53,952 | 53,952 | 53,952 | 53,952 | 0 |
| `verifyAndDispense` (Direct) | 10 | 93,058 | 93,082 | 93,082 | 93,080 | 8 |

### Findings:
1. **Predictability:** State transitions for dispensing and revocation exhibit virtually zero variance ($\sigma \le 8$ gas), demonstrating deterministic execution costs.
2. **Efficiency:** The full multi-layer dispensing gate (verifying patient hash, checking Component 2 AI risk, checking Component 3 pharmacy trust, and updating status) executes for **< 94,000 gas**.
3. **Storage Cost:** `issuePrescription` requires ~247,461 gas due to initial SSTORE operations for the prescription record and mapping indices.

---

## 5. Execution Latency Profiling

Latency was recorded across three stages: Preparation (client/API validation), Broadcast $\rightarrow$ Receipt (local EVM mining), and End-to-End:

| Operation | Preparation (ms) | Broadcast $\rightarrow$ Receipt (ms) | End-to-End (ms) |
| :--- | :---: | :---: | :---: |
| `issuePrescription` | 0.50 | 2.15 | 2.65 |
| `verifyAndDispenseWithPatientHash` | 0.50 | 1.53 | 2.03 |
| `revokePrescription` | 0.50 | 1.86 | 2.36 |
| `verifyAndDispense` | 0.50 | 1.79 | 2.29 |

*(Note: In local Hardhat instant automining, submission latency averages ~2 ms. On public networks such as Sepolia or Ethereum Mainnet, latency depends on block times and gas priority fees).*

---

## 6. Centralized Baseline vs. Blockchain Comparison (Proposal Section 3.3)

In accordance with Section 3.3 of the proposal, Component 4 was benchmarked against a traditional centralized database-backed prescription prototype (`CentralizedPrescriptionDatabase`):

| Evaluation Criteria | Centralized Baseline Prototype | MediSafe Blockchain (Component 4) |
| :--- | :--- | :--- |
| **Average Issue Latency** | **0.026 ms** | 2.982 ms |
| **Average Dispense Latency**| **0.018 ms** | 2.843 ms |
| **Duplicate-Dispensing Prevention** | **Vulnerable to Race Conditions**: Concurrent requests without distributed pessimistic locks permit double dispensing. | **Provably Atomic**: EVM transaction serialization guarantees `ACTIVE` $\rightarrow$ `USED` single-use transition. |
| **Tamper Resistance** | **Vulnerable**: Privileged database administrators (DBAs) or server compromise can modify historical records. | **Cryptographically Immutable**: Keccak-256 state tree protected by distributed consensus. |
| **Patient Privacy** | Centralized plaintext identity storage creates single points of failure for data leaks. | **Zero On-Chain PII**: Only `keccak256(canonicalIdentity, salt)` is recorded; local AES-GCM file. |
| **Audit Completeness** | Ephemeral, alterable application logs. | **Transparent, append-only Ethereum event logs** (`PrescriptionIssued`, `PrescriptionDispensed`). |
| **Trust Model** | Requires full trust in centralized server operator and cloud hosting provider. | **Trustless Multi-Party Verification**: Doctor, Pharmacy, AI Risk Oracle, and Regulators. |

### Concurrency Race Condition Findings:
When two pharmacies simultaneously attempted to dispense the same prescription against the centralized baseline without database table locking, both reads succeeded while the record was active, resulting in a **double-dispensing vulnerability**. In contrast, the blockchain state machine processes transactions sequentially per block, guaranteeing that the second transaction reverts with `PrescriptionNotActive`.

---

## 7. Client-Side Cryptographic Overhead

To prevent rainbow-table dictionary attacks on low-entropy patient attributes (National ID, Name, Date of Birth), the client employs PBKDF2-SHA256 with 310,000 iterations to derive an AES-GCM key protecting the off-chain credential:

| Cryptographic Operation | Mean (ms) | Median (ms) | 95th Percentile (p95) (ms) |
| :--- | :---: | :---: | :---: |
| Canonicalization & Keccak-256 Hashing | 0.135 | 0.111 | 0.288 |
| PBKDF2-SHA256 (310,000 iter) + AES-GCM Encrypt | 191.565 | 189.332 | 302.226 |
| PBKDF2-SHA256 + AES-GCM Decrypt | 196.540 | 182.907 | 264.992 |

**Conclusion:** The sub-200 ms client-side latency is imperceptible to human users during browser credential preparation and presentation, providing robust NIST-compliant key derivation without hindering usability.

---

## 8. Multi-Layer Business Rule Conformance (100% Pass Rate)

Across 10 evaluation replicas, 170 rule-conformance checks were executed:
* **Allowed Actions (40 / 40 passed — 100%):** Valid issuance, single-use dispensing with hash, direct dispensing, and doctor revocation.
* **Denied / Security Invariants (130 / 130 passed — 100%):**
  1. *Unauthorized Doctor Issuance:* Reverted with `AccessControlUnauthorizedAccount`.
  2. *Duplicate Prescription ID:* Reverted with `PrescriptionAlreadyExists`.
  3. *Zero Prescription ID:* Reverted with `InvalidPrescriptionId`.
  4. *Zero Patient Hash:* Reverted with `InvalidPatientHash`.
  5. *Expired Issuance Timestamp:* Reverted with `InvalidExpiryTime`.
  6. *Unauthorized Pharmacy Dispensing:* Reverted with `AccessControlUnauthorizedAccount`.
  7. *Double-Dispensing Used Prescription:* Reverted with `PrescriptionNotActive`.
  8. *Dispensing Revoked Prescription:* Reverted with `PrescriptionNotActive`.
  9. *Mismatched Patient Hash:* Reverted with `PatientHashMismatch`.
  10. *Component 2 High Risk (> 50):* Reverted with `HighMedicineRisk`.
  11. *Component 2 Unsafe Batch:* Reverted with `MedicineBatchUnsafe`.
  12. *Component 2 Unassessed Batch:* Reverted with `RiskRecordNotFound`.
  13. *Component 3 Low Pharmacy Trust (< 70):* Reverted with `LowPharmacyTrust`.
  14. *Unauthorized Revocation by Non-Issuer:* Reverted with `UnauthorizedRevoker`.

---

## 9. Conclusion & Project Status

With the implementation of the **Evaluation and Benchmarking Framework** (`integration/component4-evaluation/`), the **Centralized Baseline Comparison Prototype**, and the **Turnkey Multi-Layer Seed Scripts** (`scripts/setup/` and `scripts/seed/`), **Component 4 is 100% complete** according to the SLIIT IT4010 Research Project Proposal and Topic Assessment Form specifications.
