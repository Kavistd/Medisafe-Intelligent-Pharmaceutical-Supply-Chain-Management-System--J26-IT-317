# Component 3 Live Role-Based System: Design

> Research prototype. All weights, thresholds and indicator parameters are **proposed research parameters,
> not NMRA values**. Assessments are **decision support, not a regulatory determination**.
> `blockchainVerification` stays `NOT_PERFORMED`.

This document is the source of truth for the live system's database design. Its implementation is:

| File | Purpose |
|---|---|
| `backend/component3-pharmacy-trust/migrations/live/001_c3_live_schema.sql` | Schema `c3`: tables, checks, triggers, RLS, revokes, policy `v1`, prototype checklist |
| `backend/component3-pharmacy-trust/migrations/live/002_c3_live_seed.sql` | Seed **template**: 3 pharmacies, 1 distributor, 4 role rows, simulated events |
| `backend/component3-pharmacy-trust/tests/liveSchema.test.js` | Static SQL checks and an independent recomputation of the seed results |

It is consistent with the research core: `services/indicatorScoring.js`, `services/trustScore.js`,
`INDICATOR_SCORING_SPEC.md` and `validation/component3/VALIDATION_METHODOLOGY.md`.

## Decisions

### 1. Isolation: a new schema `c3` in the shared Supabase project

- The migration creates objects **only in schema `c3`**. Its single outside reference is the foreign key `c3.user_roles.user_id -> auth.users(id)`.
- It creates or alters no role, extension, default privilege, publication, auth setting, `public.*` object or other team's schema, and it drops nothing.
- It uses plain `CREATE` (no `IF NOT EXISTS`) inside one transaction, so a partial or conflicting state fails loudly and rolls back.
- Sign-ups stay enabled, because that project-wide setting belongs to other teams. Access is deny-by-default: an authenticated user **without an ACTIVE `c3.user_roles` row gets no access at all**.
- The four demo auth users are created manually in the dashboard and named `c3.regulator`, `c3.pharmacy.a`, `c3.pharmacy.b` and `c3.distributor`.
- Sample mode (`run-local.js`) and the old `migrations/001_component3_authorization.sql` (schema `pharmacy_trust`) are untouched.

*Rationale:* the database is shared. A contained, additive schema cannot break other components, and it can be reviewed by reading one file.

### 2. Roles

`c3.user_roles` has these columns: `user_id -> auth.users`, `role` (REGULATOR | PHARMACY_USER | DISTRIBUTOR),
`pharmacy_id` (required if and only if PHARMACY_USER), `distributor_id` (required if and only if DISTRIBUTOR),
`status` (ACTIVE | SUSPENDED) and `granted_at`. A user may have at most one ACTIVE role. Roles are assigned **only by
provisioning SQL, never by an API**. Deleting an auth user cascades to their role rows, and that deletion is audited.

*Rationale:* a fixed, small role model is enough for the prototype. Keeping role assignment out of the API removes a
whole class of privilege-escalation bugs.

### 3. Entities

The tables are `pharmacies`, `distributors`, `deliveries`, `recalls`, `recall_actions`, `complaints`, `inspections`,
`inspection_items`, `critical_findings`, `audit_log` and `assessment_snapshots`, plus reference tables `policy` and
`inspection_criteria`.

- `audit_log` is append-only: triggers block UPDATE, DELETE and TRUNCATE.
- `assessment_snapshots` stores `policy_version`, `as_of`, `status`, `score`, `tier`, the `breakdown` and `evidence_refs` JSON, `evidence_classes`, `critical_escalation_required`, a `0x`-prefixed sha256 hash (the same format as `services/anchorPayload.js`), `computed_by`, an optional single finalisation, and `blockchain_verification` fixed to `NOT_PERFORMED`.

### 4. Processes and indicator policy v1

The parameters are stored in `c3.policy` (version `v1`, `parameter_status = 'PROPOSED_RESEARCH_PARAMETERS'`):

| Parameter | v1 |
|---|---|
| Weights D / R / C / I | 0.35 / 0.30 / 0.20 / 0.15 (identical to `trustScore.WEIGHTS`) |
| Tier minimums | 80 / 60 / 40 (identical to `classifyTier`) |
| Delivery confirmation window | 24 hours after `arrived_at` |
| Complaint resolution target | 30 days after substantiation |
| Inspection points | COMPLIANT 1, PARTIAL 0.5, NON_COMPLIANT 0; NOT_APPLICABLE excluded |

All indicators are evaluated **as of** an evaluation time `T`, using only records that exist at `T`:

- **D (delivery).** The distributor creates a delivery (`dispatched_at`, `expected_by`) and later marks `arrived_at`; the schema sets `confirm_due_at = arrived_at + 24 h`. The pharmacy confirms ACCEPTED, PARTIAL or REJECTED; a note is required unless ACCEPTED.
  - *Eligible:* arrived, and either confirmed or past `confirm_due_at`.
  - *Success:* `confirmed_at <= confirm_due_at`.
  - Distributor lateness (`arrived_at > expected_by`) is recorded but is **not** a pharmacy failure and does not affect D.
- **R (recall).** A regulator issues a recall to chosen pharmacies, creating one `recall_action` per pharmacy per action type (ACKNOWLEDGE, IDENTIFY_STOCK, QUARANTINE, REPORT_QUANTITY, CLOSE), each with a `due_at` set at issuance.
  - *Eligible:* completed, or `due_at` has passed.
  - *Success:* `completed_at <= due_at`.
  - No eligible actions gives NOT_ASSESSABLE, never 100.
- **C (complaints).** A regulator logs a complaint and screens it SUBSTANTIATED or UNSUBSTANTIATED. Substantiation sets `resolution_due_at = screened_at + 30 days` (computed by the schema from the policy). The pharmacy resolves it with a note.
  - *Eligible:* substantiated, and either resolved or past due.
  - *Success:* `resolved_at <= resolution_due_at`.
  - Unsubstantiated and unscreened complaints never count, and complaint volume is not scored.
- **I (inspection).** A regulator records an inspection (always created as DRAFT), adds items (criterion, result, critical flag, note) and finalises it. The score is `I = points / max applicable points × 100` for the **latest FINAL inspection** (by `inspected_at`); DRAFT inspections never count.
  - Finalising raises one `critical_findings` row per NON_COMPLIANT item flagged critical. Critical findings from the latest FINAL inspection set `criticalEscalationRequired`, **separately from the score**.
- **Missing evidence is never 0 or 100.** Any NOT_ASSESSABLE indicator makes the overall result NOT_ASSESSABLE, with no renormalisation, exactly like `calculateTrustScore`.

**Engine mapping.** The live engine turns the counts into the existing calculators: `assessDeliveryReliability`,
`assessRecallResponse`, `assessComplaintHandling` and `assessInspectionPerformance`, then `toTrustScoreInput`,
`calculateTrustScore` and `classifyTier`.
- Evidence IDs are the row references.
- The policy is passed as `{ id: 'c3-live-policy-v1', approved: true }`, a caller assertion as in sample mode. "Approved" here means approved for prototype use of proposed parameters, not regulatory approval.
- Both evidence classes map to the core's `SYNTHETIC` source label, because neither is real-world verified. `REAL` stays reserved until a verification adapter exists.

**Prototype checklist.** There are 22 criterion codes, including licence displayed, pharmacist registration
displayed, fridge temperature record, controlled medicines locked, registers and invoices available, recall/quarantine
segregation, complaint register and self-audit. All are marked `mapping_status = 'UNVERIFIED'`: *prototype checklist;
clause mapping to GL-013/GL-014/GL-033 still to be verified.*

*Rationale:* each indicator is a binary per-record outcome with a clearly defined due point. This makes the counts
reproducible and auditable, and it maps one-to-one onto the existing numerator/denominator calculators.

### 5. Authorization matrix

This is enforced by the backend; hiding things in the UI is only a convenience.

| Capability | REGULATOR | PHARMACY_USER | DISTRIBUTOR |
|---|---|---|---|
| Read assessments, evidence, critical findings | All pharmacies | **Own pharmacy only** | **None** (no trust scores) |
| Read deliveries | All | Own pharmacy | Own deliveries only |
| Read recalls, complaints, inspections | All | Own pharmacy | — |
| Create delivery / mark arrived | — | — | Own deliveries |
| Confirm delivery receipt | — | Own deliveries | — |
| Issue recall (and its actions) | Yes | — | — |
| Complete recall action | — | Own actions | — |
| Log and screen complaint | Yes | — | — |
| Resolve substantiated complaint | — | Own complaints | — |
| Record and finalise inspection | Yes | — | — |
| Read audit log | Yes | — | — |
| Finalise assessment snapshot | Yes | — | — |

**Forward-only records** are enforced in the database:
- Each table allows only its permitted state transitions (e.g. DISPATCHED→ARRIVED→CONFIRMED), and each transition may change only its own columns.
- Inspection items can be added only to a DRAFT inspection.
- Deletes and truncates are blocked on every event table.

**Every write is audited** by a database trigger. The backend must set the transaction-local settings
`c3.actor_role` and `c3.actor_user_id` (`set_config(..., true)`) before writing. Writes without an actor are rejected,
and the actor's role also determines the evidence class (see 6).

### 6. Evidence classes

Every event row carries `evidence_class`:

- `SEEDED_SIMULATED`: written by the seed (actor `SEED`).
- `PROTOTYPE_ENTRY`: entered by a role user in the prototype (actors REGULATOR, PHARMACY_USER, DISTRIBUTOR, PROVISIONING).

The schema rejects a mismatch between the class and the actor. **Neither class is real-world verified, and the UI must
say so.** Real data and wallet verification (the Component 4 flow) are out of scope for this phase and are listed
under planned hardening, as is any blockchain wiring.

### 7. Security

- RLS is enabled on **every** `c3` table, with **no policies**, so `anon` and `authenticated` are denied by default.
- `REVOKE ALL` on schema `c3` and its tables, sequences and functions from `PUBLIC`, `anon` and `authenticated`, scoped to `c3` only. Default privileges are never altered.
- `c3` must **not** be added to the exposed API schemas. Only the backend connects to the database.
- All functions use `SET search_path = ''` and schema-qualified names.
- **Database role caveat:** the migration may not create roles, so the backend currently connects with the project-owner connection (`DATABASE_URL`). As table owner it is not subject to RLS. A dedicated least-privilege runtime role needs DBA action outside this migration and is listed under planned hardening.
- Any future `c3` migration must repeat the `ENABLE ROW LEVEL SECURITY` and `REVOKE` statements for new objects.

### 8. Honesty rules carried over

- Decision support, not a regulatory determination.
- Thresholds and weights are proposed research parameters (`policy.parameter_status` can only be `PROPOSED_RESEARCH_PARAMETERS`).
- `blockchain_verification` can only be `NOT_PERFORMED`.
- Simulated data is labelled at row level.

## Seed template (002) and expected results

**Placeholders.** Replace the four placeholders with the demo users' UUIDs: `<<REGULATOR_AUTH_USER_UUID>>`,
`<<PHARMACY_A_AUTH_USER_UUID>>`, `<<PHARMACY_B_AUTH_USER_UUID>>` and `<<DISTRIBUTOR_AUTH_USER_UUID>>`. A guard block
aborts the transaction if any is left unchanged, and the foreign key rejects UUIDs that aren't real auth users.

**Time anchor.** All times are hour offsets after **2026-08-01T00:00:00Z**. Every deadline falls before
**2026-10-01T00:00:00Z**, so any evaluation at or after that instant gives identical results.

| Pharmacy | D | R | C | I | Result |
|---|---|---|---|---|---|
| C3-PH-A | 7/10 = 70 | 9/12 = 75 | 4/6 = 66.67 | 16/20 = 80 | TS = 217/3 = **72.333**, TRUSTED |
| C3-PH-B | 4/8 = 50 | 3/8 = 37.5 | 1/3 = 33.33 | 6/12 = 50 | TS = **42.917**, UNDER_REVIEW + **critical finding** (CONTROLLED_MEDICINES_LOCKED) |
| C3-PH-C | 5/5 = 100 | **none** | 2/2 = 100 | 10/10 = 100 | **NOT_ASSESSABLE** (recall missing; never 100) |

**Note on 72.334.** The worked example's 72.334 is what you get when C is rounded to 66.67 *before* weighting, as in
validation test T05. With the exact 4/6 the core gives 217/3 = 72.333…. The test asserts both.

The seed also demonstrates each exclusion rule:
- a delivery that never arrived (A11) is not eligible;
- distributor lateness (A03) is not a pharmacy failure;
- a confirmation at exactly 24 h (A07) counts as on time;
- unsubstantiated (A07, A08) and unscreened (A09) complaints don't count;
- an older FINAL inspection (A01) is superseded by the latest one;
- a DRAFT inspection (A03) with a critical item raises nothing.

## Applying

1. Review both SQL files.
2. In the Supabase SQL editor, as the project owner, run `001_c3_live_schema.sql` once.
3. Create the four demo users in the dashboard.
4. Fill in the placeholders in a local copy of `002_c3_live_seed.sql` and run it. Don't commit real UUIDs if you prefer to keep them out of the repository.
5. Confirm `c3` is **not** listed among the exposed API schemas.

## Deviations and assumptions

- **22 checklist codes instead of about 12.** With 1 / 0.5 / 0 points per item, the worked example's literal "16 of 20 points" needs 20 applicable items. Two extra conditional criteria (compounding area, vaccine log) show the N/A exclusion.
- **R is scored per action, not per notice.** `INDICATOR_SCORING_SPEC.md` proposes a per-notice "all actions" rule but leaves this choice to the approved policy. Decision 4 chooses per-action outcomes.
- **Escalation scope.** Critical escalation uses findings from the latest FINAL inspection, the same scope as I. Findings are kept permanently as records.
- **Seed history.** The seed may insert records directly in their final historical states (actor `SEED`). Role users must create records in their initial state (DISPATCHED, ACTIVE, OPEN, LOGGED, DRAFT); this is enforced by the schema.

## Planned hardening (out of scope for this phase)

- A least-privilege database runtime role for the backend, created by a DBA (not by this migration), with RLS policies or `FORCE ROW LEVEL SECURITY` as appropriate.
- Pharmacy wallet verification through the Component 4 flow.
- Real-data integration and a verification adapter, which would enable the core's `REAL` source label.
- Expert-approved policy versions (AHP weights, clause-verified checklist) as new `c3.policy` rows.
- Blockchain anchoring of finalised snapshots via `PharmacyTrustAnchor`, with `blockchain_verification` changing only after a confirmed transaction exists.
