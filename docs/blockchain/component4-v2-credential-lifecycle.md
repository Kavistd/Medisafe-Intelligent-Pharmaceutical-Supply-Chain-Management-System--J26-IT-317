# Component 4 V2 Patient Credential Lifecycle — Architecture Draft

## Current implementation boundary

V2 does not issue or store patient credentials, credential status, revocation references, or patient-derived values. Dispensing remains blocked by `PatientAuthorizationUnavailable`. The V1 browser flow creates encrypted patient files that contain a patient hash; the V1 registry and its public ABI expose that hash. Encryption of a local file does not make V1 on-chain data private.

The backend's current patient-hash check reads the V1 registry. Backend writes are rejected in favor of wallet submission. There is no authoritative credential-status store or independent credential-revocation service in the current V2 flow.

## Architecture-neutral lifecycle model

The backend `credentialStatusState` module is a pure reference state transition helper. A newly issued status begins as `{ status: ACTIVE, version: 1 }`. Independent revocation advances it to `{ status: REVOKED, version: 2 }`; revoked status is terminal. A version is current only when it exactly matches an active status. The helper stores no credential identifier, patient identity, patient hash, revocation handle, or proof material. It has no persistence and is not connected to issuance, APIs, or dispensing, so it is not an operational revocation system.

## Requirements before a real credential lifecycle can be integrated

The selected proof and status architecture must define:

- Credential issuer authority and issuance/reissuance policy.
- Credential attributes and prescription scope proven to the verifier without revealing patient identity.
- Independent revocation and freshness/status-version updates.
- A proof that a credential is current and non-revoked without revealing a stable credential index or handle.
- Unlinkability across a patient's separate prescriptions.
- Public inputs, chain compatibility, cryptographic assumptions, and any setup requirements.
- How on-chain verification obtains an authoritative current status root/version and fails closed if it is stale or unavailable.

No stable public credential handle, ordinary hash, or ordinary signature is an acceptable substitute for the required zero-knowledge proof. Until a compatible proof verifier and status mechanism are selected, reviewed, and tested, V2 must keep dispensing blocked. These lifecycle rules do not claim that a credential has been issued or revoked on-chain.
