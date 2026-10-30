# Component 4 Credential Status Backend Readiness

**Assessment date:** 2026-10-17
**Decision:** Do not expose a credential issuance or revocation API yet.

## Current backend findings

- `backend/component4-prescription/services/credentialStatusState.js` is a pure transition helper. It creates `{ status: ACTIVE, version: 1 }`, revokes that in-memory value by advancing the version, and rejects revoking a non-active state. It has no persistence, lookup key, caller authorization, API integration, or authoritative status source.
- `backend/component4-prescription/middleware/auth.js` verifies a wallet signature over a short-lived challenge and issues an HMAC-protected bearer token. The challenge store is an in-process `Map`; tokens last five minutes. The signature establishes control of an Ethereum address, not a real-world patient identity or possession of a doctor-issued patient authorization credential.
- A caller can request a `patient` challenge by supplying `patient: true` and a prescription ID. The token is scoped to that supplied ID, but the patient branch does not check an on-chain patient-to-prescription binding or another established patient identity source. Current `authorize("patient")` checks only that the token has that role and that the request repeats the same ID.
- The prescription router has role-gated V1-oriented issue, dispense, verify, lookup, and revoke routes. There is no credential status route.
- The Component 4 backend package declares ethers, Express, and Joi. No database, ORM, cache, or durable status store is configured or declared in this component. The environment example has RPC, network, token secret, CORS, and port settings, but no persistence configuration.
- Existing backend tests use Node's built-in test runner. Existing lifecycle tests only cover pure state transitions, not authenticated APIs or storage.
- The credential lifecycle design note says the helper is non-persistent and not integrated. The proof feasibility decision is NO-GO; dispensing must continue to fail with `PatientAuthorizationUnavailable`.

## Why an API is unsafe to add now

An API backed by a process-local map would lose revocation state on restart and diverge across multiple server instances. Returning its state as if it were authoritative would create a false revocation guarantee. Adding a database without an approved identity/linkage and authorization model would still leave the service unable to decide which credential belongs to which subject or who may revoke it.

The existing bearer token is an access-control mechanism for this API; it is not a ZK proof, credential proof, patient identity proof, or authoritative credential-status witness. Do not expose or accept a patient hash, credential identifier, revocation handle, or other stable patient-derived lookup value as a workaround.

## Decisions required before implementation

1. **Credential issuer and lifecycle authority:** Which on-chain/organizational role may issue and reissue patient credentials? Which actor may independently revoke them (issuer, patient, administrator, or a defined combination)? How are issuer keys rotated and compromised issuers disabled?
2. **Authentication and subject binding:** Define the subject that authenticates to status operations and how that subject is reliably bound to an issued credential. Wallet control alone and a caller-supplied prescription ID do not establish patient identity. Decide how patient authorization is verified without promoting the current V1 patient-hash workflow as private.
3. **Private server-side linkage:** Specify the minimum internal linkage needed to locate a status record, its cryptographic protection, key ownership/rotation, access policy, audit requirements, breach handling, and retention/deletion. The linkage must never appear in API responses, logs, analytics, blockchain inputs, or events. No identifier or linkage scheme is selected here.
4. **Durable storage and operations:** Select a supported durable store and define atomic version transitions, uniqueness/concurrency behavior, backups, restore testing, multi-instance consistency, availability, access controls, encryption, migration, and retention. Revocation must remain effective after restart, failover, and recovery.
5. **Status authority and freshness:** Define which service is authoritative, how consumers learn the current version/status, what freshness guarantees apply, and how to fail closed during store/API outages. For the eventual ZK design, define how an authoritative current root/version is published and checked on-chain; the backend helper is not that mechanism.
6. **API and abuse policy:** Define endpoints, allowed roles, rate limits, idempotency, request validation, audit events, error disclosure, and how operations are independently authorized. Tests must prove unauthorized parties cannot enumerate, issue, inspect, or revoke another subject's status.

## Safe next step

Agree on the six decisions above and select an approved durable storage service before adding routes or persistence code. Then implement the repository/service boundary and access-control tests against that selected store. Keep the existing pure helper as a transition utility only. Keep V2 dispensing blocked until the separate NO-GO proof-system blockers are resolved, even if an operational backend status store is later built.

No backend source, route, test, dependency, or configuration was changed as part of this readiness assessment.
