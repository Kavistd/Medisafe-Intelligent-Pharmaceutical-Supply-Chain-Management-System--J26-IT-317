# Running ONLY Component 4 (Standalone Guide)
**Component:** Component 4 (Privacy-Preserving Blockchain Prescription Management)  
**Student:** R.A.M.A. Ranasinghe (IT23142978)  
**Project ID:** J26-IT-317  

---

## 💡 Why Component 4 Runs 100% Standalone

In MediSafe Chain, Component 4 does **NOT** require the other three backends to run:
* ❌ **Component 1 Backend (Port 5001 - Traceability):** NOT needed.
* ❌ **Component 2 Backend (Port 5002 - AI Python Microservice):** NOT needed. The smart contract validates medicine risk directly via on-chain contract records, which are pre-seeded on Hardhat.
* ❌ **Component 3 Backend (Port 5003 - Pharmacy Trust):** NOT needed. The smart contract validates trust directly via on-chain contract records, which are pre-seeded on Hardhat.

You only need:
1. **The Blockchain Node** (Hardhat local EVM on port 8545).
2. **Component 4 Backend** (Express API on port 5004).
3. **Frontend Client** (Vite on port 5173).

---

## ⚡ Option A: 1-Click Startup (Windows)

Simply double-click the launcher in the root directory:
```
start_component4.bat
```
This automatically:
1. Starts the local blockchain node in a separate window.
2. Deploys Component 4 contracts, funds your 4 MetaMask accounts with 50 ETH each, and assigns Doctor/Pharmacy/Admin roles.
3. Seeds safe and high-risk medicine batches and trust scores.
4. Starts the Component 4 Express API (Port 5004).
5. Starts the React Frontend (Port 5173) and opens your browser.

---

## 🛠️ Option B: Manual Terminal Startup (3 Terminals)

If you prefer manual control, open 3 terminals at the root of the project:

### Terminal 1: Blockchain & Seeding
```powershell
cd blockchain
npx hardhat node
```
*Leave Terminal 1 running.*

Now, in a temporary window (or separate tab), deploy the contracts and seed demo accounts:
```powershell
cd blockchain
npx hardhat run ../scripts/setup/setup_component4_demo.js --network localhost
npx hardhat run ../scripts/seed/seed_component4.js --network localhost
```

---

### Terminal 2: Component 4 Backend API ONLY
```powershell
cd backend\component4-prescription
node server.js
```
*Runs on port 5004. You can confirm health at `http://localhost:5004/health`.*

---

### Terminal 3: Frontend Client ONLY
```powershell
cd frontend
npm run dev
```
*Opens the web client on `http://localhost:5173`.*

---

## 🦊 MetaMask Accounts Setup

Connect MetaMask to **Hardhat Localhost**:
* **RPC URL:** `http://127.0.0.1:8545`
* **Chain ID:** `31337`
* **Currency:** `ETH`

Import the pre-configured accounts:
* **Doctor (Account 1):** `0x2a13ee1f4C69386864A271Bceb401fcd3d91c942`
* **Patient (Account 2):** `0x2376C6970c55AB66c4FFcad53A49fb21f862B613`
* **Pharmacy (Account 3):** `0x7465C8b4C7a9068c440044222539f993bf4537A7`
* **Admin (Account 4):** `0xd2F150C082261e31F7504f129C799218186C4701`

---

## 🎯 4-Step Viva Demonstration Workflow

### Step 1: Patient Prepares Credential (Zero-PII Off-Chain)
1. Navigate to **http://localhost:5173**.
2. Click **"Prepare a patient credential"**.
3. Enter demo data:
   - **National ID / Passport:** `199854120330`
   - **Full Legal Name:** `Kamal Perera`
   - **Date of Birth:** `05/12/1998`
   - **Credential Passphrase:** `VivaDemoPass2026!`
4. Click **"Create & download credential"**.
   - Downloads `medisafe-patient-preparation.json`.
   - **Copy the displayed `Patient Hash`** (`0x...`).

### Step 2: Doctor Issues Prescription on Blockchain
1. In MetaMask, select **Doctor (0x2a13...)**.
2. Sign in as Doctor at **http://localhost:5173**.
3. Under **"Issue a prescription"**, enter:
   - **Patient Privacy Hash:** Paste the `Patient Hash` from Step 1.
   - **Medicine ID:** `MED-AUGMENTIN-625`
   - **Batch ID:** `BATCH-SAFE-001` *(Safe batch: Risk Score 15, isSafe = true)*
   - **Valid For:** `30 days`
4. Click **"Issue prescription"** and confirm in MetaMask.
5. **Copy the returned `Prescription ID`** (`0x...`).

### Step 3: Patient Verifies & Prepares Pharmacy Presentation
1. In MetaMask, switch to **Patient (0x2376...)**.
2. Sign in with the **Prescription ID**.
3. Fill in the verification form:
   - **Encrypted preparation credential:** Upload `medisafe-patient-preparation.json`.
   - **Credential Passphrase:** `VivaDemoPass2026!`
   - **Pharmacy Presentation Passphrase:** `PharmacyPass2026!`
   - **Intended Pharmacy Wallet:** `0x7465C8b4C7a9068c440044222539f993bf4537A7`
4. Click **"Verify and prepare pharmacy handoff"**.
   - Downloads `medisafe-pharmacy-presentation.json`.

### Step 4: Pharmacy Dispenses Medication
1. In MetaMask, switch to **Pharmacy (0x7465...)**.
2. Sign in as Pharmacy at **http://localhost:5173**.
3. On the Pharmacy desk:
   - Upload `medisafe-pharmacy-presentation.json`.
   - Enter Passphrase: `PharmacyPass2026!`.
4. The system validates:
   - Prescription is `ACTIVE`.
   - Component 2 AI Risk score is safe ($\le 69$).
   - Component 3 Pharmacy Trust score is verified ($\ge 70$).
5. Click **"Verify & Dispense"** and confirm in MetaMask.
6. Prescription status updates permanently to **`USED`** on-chain!

---

## 🚫 Testing Negative Scenarios (Examiner Defense)

1. **Double-Dispense Prevention:** Try dispensing the same prescription again. The smart contract immediately reverts with `"Prescription is not active"`.
2. **High-Risk Counterfeit Batch:** Issue a prescription with `BATCH-RISK-002` (Risk score 88, `isSafe = false`). Dispensing will be blocked by the Component 2 on-chain oracle check.
