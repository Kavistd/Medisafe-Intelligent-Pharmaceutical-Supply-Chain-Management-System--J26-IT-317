# Component 4 — Frontend Client & Cryptographic Wallet Interface

**Author:** R.A.M.A. Ranasinghe (IT23142978) — Component 4  
**Project:** MediSafe Chain: Intelligent Pharmaceutical Supply Chain Management System  

---

## 1. Overview

This directory contains the client-side cryptographic and Web3 interaction modules for **Component 4 (Privacy-Preserving Prescription Management)**. 

The frontend integrates directly with MetaMask (EIP-1193) and the Hardhat EVM network to enable doctors, patients, and pharmacies to interact with the `PrescriptionRegistry` smart contract without exposing sensitive health data to intermediaries.

---

## 2. Key Modules & Cryptographic Implementation

| Module | Description |
|---|---|
| `patientCredential.js` | Generates self-contained, client-side encrypted JSON credentials using **AES-256-GCM** with PBKDF2-SHA256 key derivation. Calculates Keccak-256 patient verification hashes. |
| `walletProvider.js` | Manages MetaMask provider connection, network chain ID validation (Localhost 31337 / Sepolia), account changes, and wallet state. |
| `walletTransactions.js` | Direct non-custodial transaction broadcasting to `PrescriptionRegistry` (`issuePrescription`, `verifyAndDispenseWithPatientHash`, `revokePrescription`) with pre-flight checks and gas estimation. |
| `authFlow.js` | Coordinates challenge-response authentication with the Component 4 backend using wallet signatures (EIP-191). |
| `doctorPrescriptions.js` | Fetches, caches, and filters prescriptions issued by the currently connected doctor address. |
| `registryClient.js` | Read-only contract interface helper for prescription state verification. |
| `component4.css` | Specialized responsive UI styling for Component 4 tabs (Doctor Issuance, Patient Portal, Pharmacy Dispense). |

---

## 3. Client-Side Cryptographic Data Flow

1. **Doctor Prescribes**:
   - The doctor inputs clinical dosage and patient details in the React UI.
   - A random salt and passkey are used to derive an AES-256-GCM encryption key via PBKDF2.
   - The prescription payload is encrypted client-side.
   - A cryptographic hash (`prescriptionHash`) and pseudonymous identifier (`patientHash`) are computed.
   - The doctor's MetaMask wallet signs and submits `issuePrescription(...)` directly to the blockchain.
   - An encrypted patient credential file (`.json`) is downloaded directly by the doctor to hand off to the patient.

2. **Patient Presents Credential**:
   - The patient opens the MediSafe Chain portal and loads their credential file or QR code.
   - The client decrypts the details locally in browser memory without sending medical data to any server.

3. **Pharmacy Dispenses**:
   - The pharmacy enters the patient's authorization code.
   - The pharmacy's wallet invokes `verifyAndDispenseWithPatientHash(...)`.
   - The smart contract verifies doctor authorization, patient hash match, single-use status, Component 2 AI risk score, and Component 3 pharmacy trust rating before marking the prescription as `DISPENSED`.

---

## 4. Testing

To run the Component 4 frontend unit tests:
```bash
npm test -- src/component4
```
