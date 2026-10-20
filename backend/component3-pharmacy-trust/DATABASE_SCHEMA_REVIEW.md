# Component 3 PostgreSQL schema and evidence review

## Scope and source

`OBSERVED_DATABASE_SCHEMA.sql` is a read-only reference snapshot of the live `pharmacy_trust` PostgreSQL catalog inspected on 2026-10-21. It documents the five existing tables, their columns, defaults, check/unique/primary-key constraints, foreign keys, and observed indexes. It is not a migration and must not be applied to the existing Supabase database. No source migration defining these tables was present in the repository at review time.

The snapshot includes foreign-key targets in other schemas (`public.organizations`, `public.profiles`, and `traceability.participants`) but does not define those external tables.

## Confirmed database structure

- `pharmacies`: UUID primary key, unique `pharmacy_code`, optional organization/participant/wallet/registration fields, text `registration_status` with a check constraint.
- `trust_assessments`: FK to pharmacy; text `assessment_status`, nullable `overall_score numeric(5,2)`, `trust_tier`, text `scoring_policy_version`, text `evidence_source`, separate boolean `critical_escalation_required`, JSONB `limitations`, and assessment/creation timestamps.
- `indicator_scores`: one row per `(assessment_id, indicator_type)`; status and score consistency check; `indicator_score numeric(5,2)`, `weight numeric(5,4)`, `weighted_contribution numeric(7,3)`, integer `evidence_count`, JSONB `evidence_summary`.
- `evidence`: FK to pharmacy; indicator/event/source labels, optional source system/reference, verification-status text, event timestamp, JSONB `payload`, optional checksum and recorder, creation timestamp.
- `assessment_evidence`: join table with composite primary key `(assessment_id, evidence_id)` and FKs to assessments and evidence.
- Status, indicator, source, and tier values are text columns constrained by `CHECK` clauses, not PostgreSQL enum types.
- The inspected synthetic `evidence_summary` objects have only `note` and `source`, both strings. The `assessment_evidence` table currently contains zero rows. No evidence payload shape was available to inspect through linked synthetic records.

## Unknown semantics and missing score inputs

The catalog establishes storage types and constraints; it does not define policy meaning. In particular:

- No approved policy registry or FK is present. `scoring_policy_version` is text without a documented approval provenance.
- `evidence_source`, `source_type`, and `verification_status` are labels. A favorable value does not establish independent source verification.
- The JSONB contract for `evidence.payload` and `trust_assessments.limitations` is undocumented. `evidence_summary` has no enforced key schema; observed `note`/`source` fields do not contain reproducible numerator/denominator inputs.
- Stored overall score, indicator score, weight, weighted contribution, tier, and assessment status cannot establish their own correctness. No transaction-level calculation inputs are currently linked to the sample assessments.
- Critical-finding details are not represented in these five tables. Only the separate `critical_escalation_required` boolean exists.

The existing synthetic assessment values remain synthetic prototype records. This review does not verify, recalculate, backfill, or promote them.

## Minimum proposed evidence fields for reproducible indicator calculations

These are data requirements for future research review, not official NMRA requirements or an approved policy. The existing scoring utilities accept numerators, denominators, evidence IDs, a source label, and a caller-provided policy object; those utilities do not verify source authenticity or approve policy. Proposed aggregate weights remain 35% delivery, 30% recall, 20% complaint handling, and 15% inspection performance as research-design choices only.

All evidence records need a stable source-record ID, canonical pharmacy/premises attribution and its verification reference, indicator/event type, source system and source reference, event timestamp with timezone, declared provenance, verification result plus verifier/method/reference, deduplication or supersession link, and assessment-window/policy-version linkage. Preserve exclusion decisions and reasons. These fields support review; they do not make evidence trusted by themselves.

| Indicator | Minimum transaction-level inputs to reproduce the candidate ratio |
| --- | --- |
| Delivery | Stable commitment/transfer and batch IDs; verified pharmacy recipient mapping; assignment event; approved expected deadline and its source/policy/time-zone convention; actual receipt/completion event and timestamp; status transitions including pending/cancelled/rejected; stable source-event references. A transfer timestamp alone is not a deadline. |
| Recall response | Stable recall obligation/case and batch IDs; proof and timestamp of notice delivery to the pharmacy; required action set and approved policy/window version; pharmacy acknowledgement and per-action completion timestamps with evidence references; case status, duplicate/supersession links, and disputes. A batch recall event alone is insufficient. |
| Complaint handling | Stable complaint ID; received timestamp; verified pharmacy/service attribution; applicability/category decision under an approved taxonomy; due milestone definitions/version; acknowledgement, investigation, and resolution events/timestamps with evidence references; closure/open status, duplicate/related links, withdrawal, appeal, and dispute state. Minimize or redact complainant personal data. |
| Inspection | Stable inspection and premises IDs; inspection date and authoritative source; verified source status; rubric/checklist version; each criterion’s applicability and approved points; finding and achieved points with evidence references; corrective-action status and verified closure events; dispute, correction, supersession, and follow-up links. |

For a reproducible assessment record, also retain the exact assessment-window boundaries, eligible record IDs, exclusions and reasons, deduplication outcome, policy version/approval reference, numerator, denominator, calculation timestamp, and algorithm version. A zero score requires a verified non-empty eligible denominator; absent or insufficient evidence remains `NOT_ASSESSABLE`.

The specification leaves deadline policy, recall actions/windows, complaint milestones, inspection rubric, eligibility, timing windows, minimum sufficiency, identity mapping, and dispute handling for supervisor/research-expert approval. This review does not supply those decisions.

## Critical-finding representation proposal

Keep `trust_assessments.critical_escalation_required` as a distinct escalation flag. Do not derive it from the aggregate score or ordinary evidence, and do not interpret `true` as a finding record. The current schema has no finding details to return.

For future review, prefer a separate, access-controlled `critical_findings` relation keyed to the assessment, with a stable finding ID, authoritative source reference, finding timestamp, minimal structured finding details, and review/escalation status. Any classification/severity field must use a separately approved taxonomy. Link supporting evidence explicitly and retain an audit trail for corrections/closure. Avoid embedding complainant or other unnecessary sensitive data. Keep the boolean as a separate assessment-level escalation state; define its relationship to individual finding records only after research/supervisor approval. This is a proposal only; no live schema change is made here.
