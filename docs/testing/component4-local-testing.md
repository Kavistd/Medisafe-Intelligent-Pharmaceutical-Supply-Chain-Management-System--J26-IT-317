# Component 4 local testing guide

This guide describes implemented Component 4 behavior and the remaining privacy limits. It does not start Hardhat, deploy contracts, or change roles.

## Current setup

- Expected local RPC: `http://127.0.0.1:8545`, chain ID `31337`.
- Registry address comes from `shared/blockchain/contract-addresses.json`; do not treat the configured address as proof that a deployment is currently available.
- Backend API: port `5004`; health route `GET /health`.
- Frontend: Vite port `5173`; `/api` is proxied to `http://localhost:5004`.
- Doctor issue/revoke and pharmacy dispense transactions are submitted by the connected MetaMask wallet. Patient verification is read-only and requires a wallet-signed, single-prescription-scoped session.
- Do not attempt wallet workflows until the existing RPC is independently confirmed available. The latest known diagnosis found no process listening on port `8545`.

## Implemented patient credential and pharmacy handoff

1. **Prepare before issuance:** the patient chooses “Prepare a patient credential,” enters national ID, full name, and date of birth, and chooses a passphrase. The browser canonicalizes the three fields using the existing sorted `key:value|...` format (trimmed/lowercase values), rejects the reserved `|` separator inside values, generates a fresh random 32-byte salt, and calculates `keccak256(abi.encodePacked(canonicalIdentity, salt))`, matching `src/utils/privacy.js` for accepted values. It downloads an AES-GCM encrypted preparation file using a PBKDF2-SHA256 derived key. The plaintext fields, salt, and passphrase are not sent to the API or placed in browser storage. The patient shares the displayed hash with the doctor so the doctor can issue the prescription. The hash itself is linkable/public once used on this registry.
2. **Patient verification:** after issuance, the patient signs in with the prescription ID to obtain a scoped session and selects the encrypted preparation file. The browser decrypts it locally, recomputes the hash, and sends `{ prescriptionId, patientHash }` in the body to `POST /api/v1/prescriptions/verify`. Neither value is placed in the URL. The API checks that the prescription is active and unexpired, and asks the registry to compare the hash. Its success response contains prescription ID, status, and expiry, but not the hash. The patient challenge is single-use; patient verification itself is a read-only operation and can be repeated until the token expires.
3. **Pharmacy presentation:** on successful patient verification, the patient supplies the intended pharmacy's public wallet address and chooses a new passphrase distinct from the private preparation passphrase. The browser downloads a separate encrypted presentation file containing only the hash and its prescription ID, expiry, chain ID, registry address, and intended pharmacy address. The patient keeps the preparation file for their own records and can share the presentation file and its passphrase with that pharmacy over separately authenticated channels. The pharmacy UI decrypts it locally, checks the embedded prescription/network/registry/pharmacy scope and expiry, verifies the on-chain record and role, then asks MetaMask to submit `verifyAndDispenseWithPatientHash`. The presentation file is not uploaded to the API or saved in browser storage. The contract enforces one successful dispense per prescription; later submissions fail because the record is no longer active.

The backend does not log request bodies, and the verification response does not echo the hash. Application code does not put identity, salt, or credential contents in URLs or browser storage. These protections do not prevent browser extensions, malware, screenshots, or operating-system backups from accessing data; use a trusted device, keep the passphrase separate from the encrypted files, and remove temporary plaintext if the browser or operating system creates any.

Doctor lookup also uses `POST /api/v1/prescriptions/lookup` with the ID in the JSON body and permits only the wallet recorded as issuer. The former ID-in-path lookup and patient-verification routes are not used by this frontend. Browser password managers may ignore `autocomplete="off"`; patients should decline any offer to save these passphrases.

## Existing contract privacy limit (not fixed by the frontend)

The current `PrescriptionRegistry` stores `patientHash` in a publicly readable `Prescription` struct returned by `getPrescription`, emits it in `PrescriptionIssued`, emits it again in `PrescriptionDispensed`, and accepts it as public transaction calldata to issue and dispense functions. A pharmacy with the role, a chain observer, or any caller using the contract directly can read or copy it. The new encrypted handoff protects the patient's identity fields and salt and provides a patient-controlled application flow; it cannot make the on-chain hash confidential or force a pharmacy to wait for the patient's file. The current contract also cannot distinguish a hash obtained from the patient file from one copied from chain data. The on-chain single-use status limits successful dispensing replay after the first dispense, but it does not conceal the hash or prove the patient personally authorized a given dispense.

### Hash risk assessment

The hash is Keccak-256 over a deterministic canonical identity string and a 32-byte salt. A strong random salt kept private makes offline guessing of a low-entropy identity much harder. If the salt is omitted, predictable, reused, or disclosed, the low-entropy national-ID/name/date-of-birth space can be searched against the public hash. Reusing the same salt and identity creates the same hash and directly links prescriptions; the UI now generates a fresh random salt for each preparation. Even with a strong salt, the public hash is directly linkable to its prescription ID and the issue/dispense events. Do not call the hash anonymous or secret.

### Proposed contract-level alternatives (not implemented)

- **Privacy-preserving proof:** replace the raw hash with a prescription-scoped commitment and require a zero-knowledge proof that the patient knows a valid credential for that commitment. Remove the hash from public storage, transaction arguments, and events. This needs a new, audited contract/proof system and migration; existing records cannot be made private retroactively.
- **Patient-authorized signature:** require the patient to sign a short-lived, prescription- and pharmacy-scoped dispense authorization and verify it in the contract. This avoids exposing the identity hash, but exposes a patient wallet address and creates wallet-to-prescription linkability; it is not anonymous and requires an incompatible contract change.
- **Private execution environment:** keep verification and sensitive values inside a system that does not publish transaction inputs/state publicly. This requires different infrastructure and trust assumptions.

Choose and review a contract design before changing or redeploying anything. Existing deployment state and Component 2/3 links would need explicit migration/reconfiguration planning. No contract change is made by this guide.

## Manual verification steps

These require an already-running node, MetaMask, roles, and an existing registry. No node is started by these steps.

1. Confirm the configured RPC responds with chain ID `31337`, and read-only calls return non-empty bytecode at the configured registry address.
2. In the frontend, prepare a patient credential with a strong passphrase. Confirm the downloaded preparation file is ciphertext and the hash can be shared with the doctor. The hash is public when issued.
3. With a doctor-role wallet, issue using that hash. Confirm MetaMask shows the connected doctor as the issuer and wait for transaction confirmation.
4. Patient signs a challenge scoped to that prescription, unlocks the preparation file, and verifies. Try a changed hash, wrong passphrase, another prescription ID, and an expired prescription. The API should reject these safely; only the hash is sent in the patient verification body.
5. Confirm successful patient verification downloads an encrypted hash-only presentation. With a pharmacy-role wallet, open that file and confirm a changed prescription scope, registry, chain, or expiry is refused before MetaMask opens. For a valid active record, submit and wait for confirmation. Retry after success; the contract should reject the already-used prescription.
6. Confirm API/backend/browser storage and request URLs contain no raw identity data, salt, or credential file contents. Remember that the hash is intentionally visible in this deployed contract's public record, transaction calldata, and events.

No live blockchain test is claimed here. The last known RPC check was refused; automated tests are offline/mocked and do not establish that a deployment or roles are available.

## Component 2 and Component 3 links

The registry has optional `riskRegistry` and `pharmacyTrustRegistry` links that are consulted during dispensing when nonzero. Address placeholders in shared configuration do not prove live integration. Verify deployed getter values read-only before claiming those integrations work. No changes to Components 1, 2, or 3 are part of this work.

## Test commands

From the repository root, run `npm test` in `backend/component4-prescription`, then `npm test` and `npm run build` in `frontend`, followed by `git diff --check`. These commands do not start or modify blockchain state.
