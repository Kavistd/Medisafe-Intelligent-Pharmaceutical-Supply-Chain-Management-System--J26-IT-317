# Component 3 Live API

> Research prototype. Scores are **decision support, not a regulatory determination**. Weights and thresholds are
> proposed research parameters, not NMRA values. `blockchainVerification` is always `NOT_PERFORMED`.
> Seeded data (`SEEDED_SIMULATED`) and prototype entries (`PROTOTYPE_ENTRY`) are **not real-world verified**.

The design source of truth is [LIVE_DESIGN.md](LIVE_DESIGN.md). Implementation:
`backend/component3-pharmacy-trust/run-live.js` and `services/live/*`.

## Starting the live runtime

1. In `backend/component3-pharmacy-trust/.env`, set the variables `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The runtime refuses to start, naming any missing variable, if one is absent. Values are never printed.
2. Trust Supabase's CA certificate so TLS verification can stay **on**. Verification is never disabled, and any `sslmode` parameter in `DATABASE_URL` is removed so it cannot weaken it.
3. Start it:

   ```powershell
   cd backend\component3-pharmacy-trust
   $env:NODE_EXTRA_CA_CERTS='C:\certs\supabase-ca.crt'; node run-live.js
   # or: npm run start:live   (in the same PowerShell session after setting the variable)
   ```

It listens on `127.0.0.1:5005` (override with `COMPONENT3_PORT`). That's the target of the Vite `/c3-api` proxy, so the
frontend reaches it same-origin, and the API sends no CORS headers. Don't run `run-postgres.js` at the same time,
because it uses the same port.

If startup reports a certificate error (for example `SELF_SIGNED_CERT_IN_CHAIN`), the runtime prints a message naming
`NODE_EXTRA_CA_CERTS`. Set it as above and start again.

The runtime checks that `c3.policy` exists before listening. If it doesn't, apply
`migrations/live/001_c3_live_schema.sql` first.

## Authentication and authorization

- Send `Authorization: Bearer <Supabase access token>`. The server verifies it against Supabase `/auth/v1/user` and fails closed.
- **Role and scope always come from the caller's `c3.user_roles` row**, never from the request (headers and body fields are ignored or refused).
- A token that is missing, malformed, unknown or expired gets `401 UNAUTHORIZED`. If Supabase Auth is unreachable, the response is `503`.
- A user with no role row gets `403 NO_ACTIVE_ROLE`; a suspended role gets `403 ROLE_SUSPENDED`.
- Every route is checked against `services/live/permissions.js`:
  - the wrong role gets `403 FORBIDDEN`;
  - another pharmacy's code on a pharmacy-scoped read gets `403 FORBIDDEN`;
  - a record (by id) outside your scope gets `404 *_NOT_FOUND`, so its existence isn't revealed.
- Wallet verification (the Component 4 flow) is **not** required in this phase.

## Response format

- Success: `{ "success": true, "data": … }`
- Error: `{ "success": false, "error": "<CODE>", "message": "<safe text>" }`. Error responses never include stack traces, SQL or secrets.

| Status | Meaning (example codes) |
|---|---|
| 400 | `INVALID_JSON`, `INVALID_QUERY`, `UNSUPPORTED_QUERY_FIELDS`, `UNSUPPORTED_REQUEST_BODY` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `ROLE_SUSPENDED`, `NO_ACTIVE_ROLE` |
| 404 | `NOT_FOUND`, `PHARMACY_NOT_FOUND`, `DELIVERY_NOT_FOUND`, `RECALL_ACTION_NOT_FOUND`, `COMPLAINT_NOT_FOUND`, `INSPECTION_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` (with an `Allow` header) |
| 409 | `ALREADY_ARRIVED`, `NOT_ARRIVED`, `ALREADY_CONFIRMED`, `ALREADY_COMPLETED`, `ALREADY_SCREENED`, `ALREADY_RESOLVED`, `NOT_RESOLVABLE`, `ALREADY_FINAL`, `DUPLICATE_RECORD`, `TRANSITION_REJECTED` |
| 413 | `PAYLOAD_TOO_LARGE`: request bodies are limited to 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE`: POST bodies must be `application/json` |
| 422 | `UNSUPPORTED_FIELD`, `MISSING_FIELD`, `INVALID_TYPE`, `INVALID_VALUE`, `INVALID_TIMESTAMP`, `TIMESTAMP_ORDER`, `DUPLICATE_VALUE`, `UNKNOWN_PHARMACY`, `UNKNOWN_CRITERION`, `SNAPSHOT_NOT_ENCODABLE` |
| 503 | `AUTHENTICATION_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `POLICY_UNAVAILABLE` |

**Validation rules:**
- Unknown fields are rejected, including `role`, `actor_user_id`, `pharmacy_id`, `distributor_id` and `evidence_class`.
- Timestamps must be ISO 8601 with an explicit timezone.
- Each process step's own timestamp is the **server clock**.
- Unsupported query parameters are rejected.

## Existing read routes (unchanged response shape)

These are served by the existing `server.js` handler, with the live engine as its data source. The assessment is
computed on request with `now` from the server clock.

| Route | Roles | Data |
|---|---|---|
| `GET /api/v1/session/pharmacies` | all (distributor gets an empty list) | `{ pharmacies: [{ pharmacyCode, accessTypes: ['REGULATORY'|'PHARMACY'], permissions }], requiresWalletVerification: false }` |
| `GET /api/v1/pharmacies/:code/trust-assessment` | REGULATOR (any), PHARMACY_USER (own) | `pharmacyId, demoLabel (null), blockchainVerification, status, score (null if NOT_ASSESSABLE), tier, breakdown, missingIndicators, criticalEscalationRequired, evidenceSource, limitations` |
| `GET /api/v1/pharmacies/:code/trust-assessment/evidence` | REGULATOR, PHARMACY_USER (own) | `…, indicatorEvidence{indicator: {status, evidenceCount, provenance, evidenceIds, reason}}, evidenceValidation, component1 (null), limitations` |
| `GET /api/v1/pharmacies/:code/trust-assessment/critical-findings` | REGULATOR, PHARMACY_USER (own) | `pharmacyId, demoLabel, blockchainVerification, required, findings` |

`evidenceSource` is `SYNTHETIC` for both evidence classes, because neither is real-world verified.
`indicatorEvidence.*.provenance` names the class or classes actually used.

## Live read routes

| Route | Roles | Data |
|---|---|---|
| `GET /api/v1/live/session` | all active roles | `{ role, status, pharmacy, distributor, accessiblePharmacies, allowedActions, walletVerification }` |
| `GET /api/v1/live/pharmacies/:code/calculation` | REGULATOR, PHARMACY_USER (own) | How each number was calculated: `calculation.{delivery,recall,complaint,inspection}` with `numerator, denominator, formula, eligibleIds, successIds, failures, excluded (with reasons), notes`, plus `provenance` |
| `GET /api/v1/live/pharmacy/tasks` | PHARMACY_USER | `{ deliveriesToConfirm, recallActionsDue, complaintsToResolve }` for your own pharmacy only |
| `GET /api/v1/live/distributor/deliveries` | DISTRIBUTOR | Your own deliveries; never trust scores |
| `GET /api/v1/live/regulator/overview` | REGULATOR | `[{ pharmacyId, status, score, tier, criticalEscalationRequired, missingIndicators, evidenceCount, provenance, blockchainVerification }]` |
| `GET /api/v1/live/regulator/complaints` | REGULATOR | Open complaints (LOGGED, SUBSTANTIATED) |
| `GET /api/v1/live/regulator/recalls` | REGULATOR | Recalls with action and completion counts |
| `GET /api/v1/live/regulator/inspections` | REGULATOR | Inspections with item counts |
| `GET /api/v1/live/regulator/audit-log?limit=50` | REGULATOR | Latest audit rows (`limit` 1–200) |
| `GET /api/v1/live/pharmacy-directory` | REGULATOR, DISTRIBUTOR | `[{ pharmacy_code, display_name }]` |
| `GET /api/v1/live/inspection-criteria` | REGULATOR | The 22-item prototype checklist (clause mapping still to be verified) |

## Process routes (POST, `Content-Type: application/json`)

Each call is **one database transaction**:
1. It starts by setting `c3.actor_role` and `c3.actor_user_id` from the verified principal, which the audit trigger requires.
2. It then makes only the forward-only change the migration permits for that step.
3. Repeating a completed step returns `409`.

| Route | Role | Body | Effect |
|---|---|---|---|
| `/api/v1/live/deliveries` | DISTRIBUTOR | `{ pharmacyCode, expectedBy, deliveryRef? }` (`expectedBy` from now to 90 days) | Creates a DISPATCHED delivery from your distributor (201) |
| `/api/v1/live/deliveries/:id/arrive` | DISTRIBUTOR (own deliveries) | `{}` | DISPATCHED → ARRIVED; the database sets `confirm_due_at` |
| `/api/v1/live/deliveries/:id/confirm` | PHARMACY_USER (own pharmacy) | `{ confirmationStatus: ACCEPTED\|PARTIAL\|REJECTED, note? }` (note required unless ACCEPTED) | ARRIVED → CONFIRMED |
| `/api/v1/live/recall-actions/:id/complete` | PHARMACY_USER (own) | `{ note? }` | OPEN → COMPLETED |
| `/api/v1/live/complaints/:id/resolve` | PHARMACY_USER (own) | `{ note }` | SUBSTANTIATED → RESOLVED |
| `/api/v1/live/recalls` | REGULATOR | `{ batchReference, reason, pharmacyCodes[1..50], actions:[{ actionType, dueAt }] (unique types, due within 365 days), recallRef? }` | Recall plus one OPEN action per pharmacy per action type (201) |
| `/api/v1/live/complaints` | REGULATOR | `{ pharmacyCode, summary, complaintRef? }` | LOGGED complaint (201) |
| `/api/v1/live/complaints/:id/screen` | REGULATOR | `{ outcome: SUBSTANTIATED\|UNSUBSTANTIATED }` | LOGGED → screened; the database sets `resolution_due_at` (+30 days) when substantiated |
| `/api/v1/live/inspections` | REGULATOR | `{ pharmacyCode, inspectedAt (past 365 days), items:[{ criterionCode, result, critical?, note? }], inspectionRef? }` (critical only on NON_COMPLIANT) | DRAFT inspection with items (201) |
| `/api/v1/live/inspections/:id/finalize` | REGULATOR | `{}` | DRAFT → FINAL; the database raises critical findings; the response lists them |
| `/api/v1/live/pharmacies/:code/assessment-snapshots` | REGULATOR | `{}` | Computes the assessment now and stores it, finalised, with its `0x` sha256 hash (`anchorPayload.js`). **No blockchain transaction is sent** (201) |

### Database contract (migrations/live/001_c3_live_schema.sql)

- **The actor is set first.** Inside every write transaction, before any write: `set_config('c3.actor_role', role, true)` and `set_config('c3.actor_user_id', user, true)`. Both come from the verified principal.
- **`evidence_class` is validated, not derived.** The database checks the value against the actor (`c3.enforce_evidence_class` raises on a mismatch) but doesn't fill it in. The backend therefore sends `PROTOTYPE_ENTRY`, computed from the verified role and never taken from the client.
- **Derived columns are never sent:** `deliveries.confirm_due_at`, `complaints.resolution_due_at` and `c3.critical_findings`.
