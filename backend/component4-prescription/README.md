# Component 4 — Privacy-Preserving Blockchain Prescription Management API

**Author:** R.A.M.A. Ranasinghe (IT23142978) — Component 4  
**Project:** MediSafe Chain: Intelligent Pharmaceutical Supply Chain Management System  

---

## 1. Overview & Research Scope

Component 4 is a **privacy-preserving, decentralized prescription management framework** built on Ethereum EVM and Node.js/Express. It eliminates prescription forgery, unauthorized reuse ("double-dispensing"), and unauthorized access to sensitive patient clinical information.

### Core Architectural Guarantees
1. **Client-Side Cryptographic Privacy**: Patient Identifiable Information (PII), clinical diagnosis, and dosage instructions are **never stored in plaintext on the blockchain or backend server**. Prescriptions are encrypted client-side using **AES-256-GCM** with keys derived via **PBKDF2-SHA256** (100,000 iterations).
2. **On-Chain Pseudonymous Registry**: Only cryptographic commitments (`prescriptionHash`, `patientHash`, expiry timestamp, issuance status, and dispensing pharmacy) are stored on the `PrescriptionRegistry` smart contract.
3. **Multi-Component Safety Interlocks**:
   - **Component 2 (AI Risk Gate)**: The smart contract queries `MedicineTraceability` and fails closed if the medicine batch has an AI risk score > 50.
   - **Component 3 (Pharmacy Trust Gate)**: The smart contract queries `PharmacyTrust` and requires pharmacies to maintain a trusted rating (Score ≥ 60) to dispense.
4. **Non-Custodial Direct Wallet Execution**: Doctors and Pharmacies sign on-chain state changes (`issuePrescription`, `verifyAndDispenseWithPatientHash`, `revokePrescription`) directly through their Web3 wallets (MetaMask). The backend API performs off-chain cryptographic challenge validation, role authorization, and contract query services.

---

## 2. API Endpoints

The API binds to `127.0.0.1:5004` by default. Base path: `/api/v1/prescriptions`.

### Health & Diagnostics
| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/health` | Process liveness, component metadata, and author details | Public |
| `GET` | `/health/blockchain` | EVM RPC connectivity, network ID, and contract deployment check | Public |

### Cryptographic Web3 Authentication
| Method | Path | Description | Request Body |
|---|---|---|---|
| `POST` | `/auth/challenge` | Issues a cryptographic nonce for wallet sign-in | `{ "address": "0x..." }` |
| `POST` | `/auth/token` | Exchanges an EIP-191 personal signature for an authenticated JWT | `{ "address": "0x...", "signature": "0x..." }` |

### Prescription Operations
| Method | Path | Description | Required Role |
|---|---|---|---|
| `POST` | `/issue` | Validate prescription parameters and prepare issuance verification | `doctor` |
| `POST` | `/dispense` | Validate dispensing parameters and batch allocation | `pharmacy` |
| `POST` | `/verify` | Patient zero-knowledge credential verification | `patient` |
| `GET` | `/mine` | Retrieves all prescriptions issued by the authenticated doctor | `doctor` |
| `POST` | `/lookup` | Query state commitment and status for a prescription ID | `doctor` |
| `POST` | `/revoke` | Validates revocation eligibility before doctor wallet broadcast | `doctor` |

---

## 3. Quick Start & Setup

### Prerequisites
- Node.js 18 LTS or newer
- Hardhat EVM Node running on `http://127.0.0.1:8545`

### Installation
From this directory:
```bash
# Install dependencies
npm install

# Copy example environment configuration
copy .env.example .env
```

### Environment Variables (`.env`)
```env
PORT=5004
RPC_URL=http://127.0.0.1:8545
NETWORK=localhost
AUTH_TOKEN_SECRET=your-secure-random-secret-at-least-32-chars
CORS_ORIGIN=http://localhost:5173
```

### Running the API
```bash
# Start the Express server
npm start

# Run unit and integration test suite
npm test
```

---

## 4. Directory Structure

```
backend/component4-prescription/
├── blockchain/         # Hardhat contract connection & ethers v6 provider
├── controllers/        # Request handling and business logic
├── middleware/         # EIP-191 JWT auth & role-based access control
├── privacy/            # Keccak-256 patient hashing & crypto utilities
├── routes/             # Express API routing definition
├── services/           # Blockchain query and contract interaction services
├── tests/              # Automated unit tests for API and services
├── validators/         # Joi schema validators for payloads
├── server.js           # Server bootstrap and middleware configuration
├── package.json        # Dependencies and scripts
└── README.md           # This documentation
```

---

## 5. Related Component 4 Modules

- **Frontend Client**: `frontend/src/component4/`
- **Smart Contracts**: `blockchain/contracts/component4/` (`PrescriptionRegistry.sol`)
- **Evaluation Framework**: `integration/component4-evaluation/`
- **1-Click Standalone Launcher**: `start_component4.bat`
- **Standalone Setup Guide**: `docs/RUN_COMPONENT_4_ONLY.md`
