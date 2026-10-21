# Component 3 Pharmacy Trust Scoring Core

## Purpose and scope

This isolated CommonJS module validates four caller-supplied indicator assessments, calculates a weighted research score only when every indicator is assessable, and preserves critical findings as a separate escalation signal. It is a pure domain module: it reads no pharmacy records or external data sources, makes no API calls, performs no blockchain operations, and does not persist data.

The module does not calculate or verify delivery, recall, complaint, or inspection evidence. Integrations and approved indicator rules are not present here.

## Proposed research weights and formula

These weights are proposed research-design parameters, not official NMRA-prescribed values:

| Indicator key | Meaning | Weight |
|---|---|---:|
| `delivery` | Delivery Reliability | 0.35 |
| `recall` | Recall Response | 0.30 |
| `complaint` | Complaint-Handling Performance | 0.20 |
| `inspection` | Inspection Performance | 0.15 |

For assessable values on a 0 to 100 scale:

`TS = (0.35 * D) + (0.30 * R) + (0.20 * C) + (0.15 * I)`

The implementation does not round the score or weighted contributions. It does not renormalize weights when an indicator is unavailable.

## Exports

The module exports:

- `WEIGHTS`: a frozen object containing the four proposed weights.
- `calculateTrustScore(input)`: validates indicator assessments, produces a breakdown and either a numeric aggregate or a `NOT_ASSESSABLE` result.
- `classifyTier(score)`: classifies a numeric score using the prototype thresholds below; `null` returns `NOT_ASSESSABLE`.

Each required indicator has shape `{ status, value?, evidenceCount, source }`:

- `status` is `ASSESSABLE` or `NOT_ASSESSABLE`.
- An assessable indicator requires a finite numeric `value` from 0 through 100 inclusive.
- A not-assessable indicator must omit `value` entirely.
- `evidenceCount` is a non-negative integer. `source` is `SYNTHETIC` or `REAL`.
- All four indicator objects are required. Invalid values are rejected rather than coerced.

Example input shape (illustrative structure only; not pharmacy data):

```js
{
  delivery: { status: 'ASSESSABLE', value: 80, evidenceCount: 3, source: 'SYNTHETIC' },
  recall: { status: 'NOT_ASSESSABLE', evidenceCount: 0, source: 'SYNTHETIC' },
  complaint: { status: 'ASSESSABLE', value: 75, evidenceCount: 2, source: 'REAL' },
  inspection: { status: 'ASSESSABLE', value: 90, evidenceCount: 1, source: 'REAL' },
  criticalFindings: [],
}
```

`calculateTrustScore` returns `status`, `score`, per-indicator `breakdown`, `missingIndicators`, `criticalEscalation`, and `evidenceSource`. When any indicator is `NOT_ASSESSABLE`, the overall status is `NOT_ASSESSABLE`, score is `null`, and unavailable indicators include a reason. No partial weighted sum is exposed as the final score.

The result shape is:

```ts
{
  status: 'ASSESSABLE' | 'NOT_ASSESSABLE',
  score: number | null, // numeric only when assessable; null otherwise
  breakdown: {
    delivery: { status, value, weight, weightedContribution, evidenceCount, source },
    recall: { status, value, weight, weightedContribution, evidenceCount, source },
    complaint: { status, value, weight, weightedContribution, evidenceCount, source },
    inspection: { status, value, weight, weightedContribution, evidenceCount, source },
  },
  missingIndicators: [{ name, reason }],
  criticalEscalation: { required: false, findings: [] },
  evidenceSource: 'SYNTHETIC' | 'REAL' | 'MIXED',
}
```

The example result values above describe field types and shape, not a specific calculation result.

A legitimate assessable score of `0` remains a numeric value and contributes zero. It is distinct from `NOT_ASSESSABLE`, which has no `value` and contributes no aggregate because the overall score is unavailable.

`evidenceSource` is derived only from the four source labels: all synthetic yields `SYNTHETIC`, all real yields `REAL`, and a combination yields `MIXED`. This label does not verify evidence authenticity.

## Critical findings

`criticalFindings` may be omitted (or set to `undefined`) to represent an empty list. Otherwise it must be an array of plain objects containing non-empty `id` and `description` strings. Additional JSON-compatible finding details are preserved in defensive copies.

Any non-empty findings array sets `criticalEscalation.required` to `true`, whether the score is high, low, or not assessable. Escalation is separate from the aggregate. This module does not define regulatory severity, threshold, or official outcome rules.

## Prototype tier thresholds

`classifyTier` uses the following proposed prototype categories. They are not official NMRA classifications or decisions:

- 80 through 100: `HIGHLY_TRUSTED`
- 60 to less than 80: `TRUSTED`
- 40 to less than 60: `UNDER_REVIEW`
- 0 to less than 40: `ESCALATION_ALERT`
- `null`: `NOT_ASSESSABLE`

## Evidence limitations

No approved expected-delivery deadline source has been confirmed. Component 1 transfer timestamps alone cannot establish whether a delivery was on time. Complaint and inspection source integrations are absent. Recall records do not by themselves establish pharmacy response. Until approved sources and scoring rules are supplied, affected indicators should be represented as `NOT_ASSESSABLE`.

Synthetic fixtures in the unit tests are explicitly labeled as synthetic test fixtures and are not real pharmacy data. The module makes no claim of real-world accuracy. Real-world use requires approved evidence sources, validated scoring rules, and appropriate domain-expert and supervisor review. The score is research decision support and does not replace official regulatory decisions.

## Read-only API prototype

`server.js` exports `createComponent3Server`, a dependency-free Node.js HTTP server factory. `services/assessmentService.js` accepts a trusted server-side `readPharmacyAssessment(pharmacyId)` function, validates its indicator outputs through the existing scoring interfaces, and returns assessment and evidence summaries. The API accepts no assessment, evidence, or policy data from request bodies.

The read routes are:

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/v1/pharmacies/:pharmacyId/trust-assessment` | Status, score or `null`, tier, weighted breakdown, missing indicators, and whether critical escalation is required. |
| GET | `/api/v1/pharmacies/:pharmacyId/trust-assessment/evidence` | Per-indicator evidence status and provenance labels, validation summary, and optional Component 1 adapter facts. |
| GET | `/api/v1/pharmacies/:pharmacyId/trust-assessment/critical-findings` | Critical findings separately from the aggregate score. |

The host must inject both `authenticate(request)` and `authorizePharmacy({ principal, pharmacyId, request })`. The server fails closed when either function or an assessment source is absent. Authorization must bind the authenticated principal to the requested explicit pharmacy ID through an approved identity process. Component 4's wallet role alone is not such a mapping. No public write route exists.

No persistence or production Component 3 assessment provider is included. An unknown pharmacy returns `404`; a known pharmacy whose indicators lack approved policy or sufficient evidence returns `200` with `status: "NOT_ASSESSABLE"` and `score: null`. Test fixtures are synthetic. A `REAL` indicator source remains a declared label, not proof of authenticity. Component 1 facts do not establish delivery deadlines or pharmacy recall responses. The API is off-chain and does not synchronize with Component 4's legacy V1 `getTrustScore(address)` or `isPharmacyTrusted(address)` interface.

The repository has no central backend host. The API prototype uses Node's built-in HTTP module and adds no dependency. Hosting, identity authorization, a trusted assessment provider, and any synchronization policy require separate integration decisions.

## PostgreSQL read-only runtime

`services/postgresAssessmentRepository.js` is a separate database-backed provider. Importing it does not load `pg`, read environment files, or open a connection. Start the separate runtime with `node run-postgres.js`; it loads this folder's `.env` at startup and requires `DATABASE_URL` plus `COMPONENT3_AUTH_MODULE`. The configured trusted server-side module must export `authenticate(request)`, `authorizePharmacy({ principal, pharmacyId, request })`, and `listAuthorizedPharmacies({ principal, request })`. Startup fails before creating the pool or listening if required configuration is missing, the authentication module is invalid, or the port is invalid. The runtime binds to `127.0.0.1:5005` by default so it can run beside Component 4 on port 5004; `COMPONENT3_PORT` may select another validated port. The synthetic `node run-local.js` demo is unchanged.

The repository issues parameterized `SELECT` statements in a repeatable-read, read-only transaction. It ignores persisted overall and indicator scores, tiers, weights, and favorable verification labels. The current schema has no documented approval source or raw transaction-level numerator/denominator inputs, and the sample assessments have no evidence links; therefore the database-backed provider returns `NOT_ASSESSABLE` with `score: null`. It maps linked evidence metadata without reading undocumented payload JSON. Critical escalation is carried from the stored boolean, while findings remain empty because the schema stores no finding details. Configure the database account with read-only privileges as an additional control.

## Local synthetic demonstration

From `backend/component3-pharmacy-trust`, start the loopback-only demo with Node.js:

```powershell
node run-local.js
```

It binds to `127.0.0.1:5003`. To select another local port, set `COMPONENT3_PORT` to a decimal value from 1 through 65535 before starting. The host remains fixed at loopback. The demo uses a fixed bearer token, `component3-local-demo`, solely to exercise the API authentication boundary; it is public demo code and is not production authentication. The demo authorization accepts only IDs in its `C3-DEMO-` namespace, and its provider contains two in-memory synthetic fixtures. Neither the token nor an environment variable can approve real-data assessment.

Use these local requests while the demo is running:

```powershell
curl.exe -H "Authorization: Bearer component3-local-demo" http://127.0.0.1:5003/api/v1/pharmacies/C3-DEMO-PHARMACY-001/trust-assessment
curl.exe -H "Authorization: Bearer component3-local-demo" http://127.0.0.1:5003/api/v1/pharmacies/C3-DEMO-PHARMACY-001/trust-assessment/evidence
curl.exe -H "Authorization: Bearer component3-local-demo" http://127.0.0.1:5003/api/v1/pharmacies/C3-DEMO-PHARMACY-001/trust-assessment/critical-findings
curl.exe -H "Authorization: Bearer component3-local-demo" http://127.0.0.1:5003/api/v1/pharmacies/C3-DEMO-PHARMACY-INSUFFICIENT/trust-assessment
```

Every local demo response includes `demoLabel: "LOCAL_SYNTHETIC_DEMO"` and `blockchainVerification: "NOT_PERFORMED"`. The example score and critical finding are synthetic test data, not pharmacy performance or regulatory findings. The insufficient example returns `NOT_ASSESSABLE` and `score: null`. Do not expose this demo outside the local machine or use its fixed token for a hosted service.

## Component 3 dashboard

The Vite/React page is `frontend/component3.html` and opens at
`http://127.0.0.1:5173/component3.html`. To run the local synthetic demonstration, start
these processes in separate PowerShell terminals from the repository root.

```powershell
Set-Location backend/component3-pharmacy-trust
node run-local.js
```

```powershell
Set-Location frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Choose **Open local synthetic demo** and select
`C3-DEMO-PHARMACY-001` or `C3-DEMO-PHARMACY-INSUFFICIENT`. The page sends the fixed demo
token only in this explicit mode. Vite proxies requests to the loopback-only demo API on
port 5003. All fixture data is labeled synthetic; blockchain verification is
`NOT_PERFORMED`. The insufficient fixture has no numeric score or tier in the dashboard.

For live sign-in, set the public frontend values `VITE_COMPONENT3_SUPABASE_URL` and
`VITE_COMPONENT3_SUPABASE_ANON_KEY` in `frontend/.env.local`. These are the project URL
and public anon key; never use a service-role key. Keep the C3 database and server-side
Supabase configuration in `backend/component3-pharmacy-trust/.env`. Start the separate
read-only Component 3 runtime in another terminal:

```powershell
Set-Location backend/component3-pharmacy-trust
node run-postgres.js
```

The authenticated API binds to `127.0.0.1:5005`; the Vite `/c3-api` proxy removes its path
prefix before forwarding. Pharmacy users also need Component 4 running on port 5004,
MetaMask connected to the configured Component 4 network, and an approved wallet assignment.
Regulatory users need an active, approved exact-pharmacy grant. Supabase authentication
alone grants no Component 3 access. The directory and every API route enforce permissions
on the backend. Sessions stay in browser memory and the page requires sign-in again after
reload. This API exposes no assessment-history route.

For pharmacy wallet verification, start the existing Component 4 API separately if it is
not already running:

```powershell
Set-Location backend/component4-prescription
node server.js
```

It uses port 5004 by default and requires its own existing local configuration and chain
RPC. Component 3 does not change or configure that service.

The authorization migration remains unapplied, so live pharmacy discovery and grants will
fail closed until the migration is reviewed and applied through the approved database
workflow and memberships, wallet assignments, regulatory designations, and grants are
provisioned. As a result, real database records and live sign-in were not verified in this
local implementation pass. Live mode shows service/configuration errors and never falls
back to synthetic records.

## Component 3 authentication and pharmacy authorization

The PostgreSQL runtime can load the Component 3-owned adapter with
COMPONENT3_AUTH_MODULE=./services/component3Auth.js. Required configuration names are
DATABASE_URL, COMPONENT3_AUTH_MODULE, SUPABASE_URL, and SUPABASE_ANON_KEY. SUPABASE_URL
must use HTTPS except for loopback testing. Supabase Auth's server-side /auth/v1/user
endpoint verifies the access token; decoded token claims are not accepted as identity.

The runtime remains bound to 127.0.0.1:5005 by default. Pharmacy users send the Supabase token in
Authorization: Bearer <access-token> and a short-lived Component 4 wallet session in
X-Component4-Wallet-Token. The adapter verifies that session through Component 4's
existing authentication middleware and rechecks its live PHARMACY role on chain ID 31337.
It then requires exactly one approved, effective, unexpired, unrevoked Component 3 wallet
assignment matching that address. Wallet control, on-chain role, and approved pharmacy
mapping are separate checks; Component 4 is unchanged.

The proposed own-pharmacy policy allows OWNER and ADMIN to read assessment, evidence, and
critical-findings routes; PHARMACIST can read assessment and evidence; STAFF, VIEWER, and
other roles are denied by default. These are Component 3 application choices, not official
NMRA classifications. Regulatory access requires active organization membership, active
organization status, an explicitly approved Component 3 regulatory-organization record,
a verified Component 3 functional-designation record, and an active grant for the exact
pharmacy and route permission. Generic or technical administrator status gives no
regulatory access. No grant-management or wallet-approval API is included; provisioning
must be separately controlled and audited.

Review migrations/001_component3_authorization.sql before applying it through the approved
workflow. It has not been executed. It adds Component 3 wallet assignments, regulatory
organization/designation approval, pharmacy-scoped grants, and database-generated lifecycle
events without altering existing tables. Records start PENDING; triggers reject invalid
approval transitions and append lifecycle events in the same transaction. Event tables
reject UPDATE, DELETE, and TRUNCATE for ordinary database roles. This is not tamper-proof
against a database superuser, table owner, trigger/function owner, or BYPASSRLS role; those
remain trusted DBA principals.

The migration defines non-login group roles `component3_runtime` and
`component3_provisioner`, but does not guess or grant either role to an environment login.
Before migration, the database administrator must confirm the runtime login used by
`DATABASE_URL` is a dedicated non-superuser, non-BYPASSRLS role, is not a table owner or
member of `component3_provisioner`, and is a member of `component3_runtime`.
Startup checks these properties and refuses to listen if they do not hold. Grant
`component3_provisioner` only to a separately controlled, audited provisioning login. Do
not run the API as `postgres`, a Supabase service role, or another role that bypasses row
security. The migration requires authority to create/alter these group roles,
tables, policies, triggers, and functions. Confirm the target Supabase project permits
those operations before scheduling it. Ordinary API roles have SELECT-only access to the
new authorization records; the API exposes no provisioning route. Existing shared-table
RLS policies must also permit the dedicated runtime role to read only the required source
rows; this migration does not modify those policies.

Regulatory authorization additionally requires a Component 3 designation row in VERIFIED
status. The designation text and proof reference are free-form, separately reviewed data;
they do not define official Sri Lankan regulatory titles. A trusted provisioner must verify
each designation with an authoritative source and record the verifier and evidence before
granting access. The schema requires a different profile for submission and approval, but
does not itself verify that profile identity against a human session. Until the source and
review process are confirmed, regulatory requests fail closed.

Wallet assignments are separate human approval records. `proof_reference` is an audit
reference, not proof validation. The migration prevents one wallet from being active for
multiple pharmacies and prevents multiple active wallets for one pharmacy; expired
assignments do not block replacement. Wallet control, a current Component 4 role, and the
approved pharmacy mapping remain distinct checks. The database mapping still requires an
authoritative external approval process; the adapter does not establish legal pharmacy
ownership. Lifecycle events are trigger-generated and protected from ordinary row changes;
actor profile IDs are supplied by the trusted provisioner and are not cryptographically
bound to that login. Audit that provisioning login separately.

Wallet checks also need Component 4 runtime configuration, including AUTH_TOKEN_SECRET,
RPC_URL, and NETWORK. Component 4 loads the V1 `PrescriptionRegistry` address from
`shared/blockchain/contract-addresses.json` for the selected network; it is not a separately
named environment variable. Synthetic demo tokens are not valid authentication here. Tests
mock Supabase, PostgreSQL, and wallet checks; they do not prove live availability, pharmacy
ownership, regulatory authority, or policy approval. Migration tests that inspect SQL text
are not PostgreSQL execution tests. Use only a least-privilege database account and validate
role membership and policies in a separate test database before applying this migration to
any shared environment.
