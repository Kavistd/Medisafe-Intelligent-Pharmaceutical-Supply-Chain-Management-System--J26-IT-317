# Component 3 Indicator Scoring Specification

## Purpose and research status

This document proposes indicator-level methods for the isolated Component 3 trust scoring core. It is a review specification, not an implementation of evidence ingestion or indicator calculation. The existing `services/trustScore.js` accepts already-scored indicator values; it does not derive them from source records.

The proposed research weights remain:

| Indicator | Weight |
|---|---:|
| Delivery Reliability (`D`) | 35% |
| Recall Response (`R`) | 30% |
| Complaint-Handling Performance (`C`) | 20% |
| Inspection Performance (`I`) | 15% |

If and only if all four indicators are assessable, the existing aggregate formula is:

`TS = (0.35 * D) + (0.30 * R) + (0.20 * C) + (0.15 * I)`

Weights and all indicator methods below are proposed research-design choices, not official NMRA-prescribed weights, formulas, thresholds, penalties, or classifications. Missing or inadequate evidence yields `NOT_ASSESSABLE`; it is never silently converted to 0 or 100, and weights are never re-normalized. A verified indicator value of 0 is a real score and is distinct from `NOT_ASSESSABLE`.

A critical regulatory finding must be recorded and escalated separately from `TS`, even if the aggregate score is high or unavailable. The score is decision support and does not replace NMRA inspection, enforcement, or regulatory decisions.

## Common assessment conventions

Each indicator result is intended to fit the current core input contract:

```js
{ status: 'ASSESSABLE' | 'NOT_ASSESSABLE', value?, evidenceCount, source: 'REAL' | 'SYNTHETIC' }
```

An assessable value is numeric from 0 through 100. A not-assessable result omits `value`. `evidenceCount` counts distinct eligible source records after de-duplication, not raw event rows. `source` describes the assessment inputs' source labels; it does not independently authenticate them.

Every assessment should declare its pharmacy identity, measurement window, rule/version identifier, evidence references, eligible record count, exclusions, and calculation time in the future evidence contract. The current scoring core does not accept these additional fields and does not persist this context; they are specification requirements for a later service/storage design, not current module behavior.

A record is eligible only when its identity, source, timestamps, state, and relation to the pharmacy can be verified under an approved policy. Unknown attribution, incomplete windows, unresolved disputes, stale records, source outages, or unapproved rules must be disclosed and may require `NOT_ASSESSABLE`. Duplicate records must be collapsed using an authoritative stable identifier; do not deduplicate by approximate text or timestamps alone.

## 1. Delivery Reliability (`delivery`, 35%)

### Purpose and proposed method

Estimate the proportion of attributable pharmacy-bound delivery commitments completed by an approved expected deadline. Component 1 records transfer initiation and recipient confirmation times, but the repository has no authoritative expected-delivery deadline source. Therefore the current repository evidence cannot support a delivery-reliability score. Until a deadline source and policy are approved and integrated, return `NOT_ASSESSABLE`.

Candidate formula after approval:

`D = 100 * (eligible commitments completed by their approved deadline / eligible commitments whose deadline has matured)`

This formula assumes the research protocol defines “commitment,” “completed,” “by deadline,” and how late, pending, rejected, or cancelled commitments are treated. These decisions require logistics and research-expert validation. Do not infer an expected deadline from observed transfer duration or treat confirmation time as proof of timeliness.

### Required fields

- Stable shipment/transfer/commitment ID and batch ID.
- Canonical pharmacy ID and mapped receiving wallet, with mapping effective dates.
- Origin and destination identifiers and the event assigning the delivery to the pharmacy.
- Approved expected deadline, deadline source, policy version, and applicable time zone/clock convention.
- Actual receipt/completion timestamp and authoritative confirmation source.
- Outcome state: completed, pending, rejected, cancelled, or other policy-defined state; event IDs and timestamps for state transitions.
- Evidence source, verification status, and any correction/dispute reference.

### Numerator, denominator, exclusions, and attribution

- **Numerator:** eligible commitments with verified completion at or before the approved deadline.
- **Denominator:** eligible commitments assigned to that pharmacy whose approved deadline has elapsed, after applying the approved cancellation/rejection and maturity policy.
- **Attribution:** assign only to the pharmacy identified as the receiving party under the approved identity mapping. Do not attribute a distributor-to-distributor leg to a pharmacy without an explicit policy.
- **Exclusions/edge cases:** duplicate commitments, test records, commitments outside the window, deadlines not yet elapsed, and events with unresolved identity or timestamp conflicts. Whether a cancelled or rejected commitment counts as a failure must be approved; Component 1 cancellation events do not encode a distinct cancellation-versus-rejection outcome.

### Synthetic worked example

**Synthetic test example only; not real pharmacy data.** Suppose an approved future policy identifies 10 matured commitments attributable to one pharmacy, and 8 have verified receipt no later than their respective approved deadlines. Then `D = 100 * 8 / 10 = 80`. If no approved deadlines are available, the result is `NOT_ASSESSABLE`, regardless of the observed transfer durations.

### Evidence, assessability, and limitations

For real assessment, required evidence includes Component 1 transfer/event records plus an approved expected-deadline source and authoritative pharmacy receipt/identity evidence. Component 1's `CompletedTransfer` records `initiatedAt` and `confirmedAt`, and `TransferConfirmed` records participants and stage (`blockchain/contracts/MedicineTraceability.sol`, `CompletedTransfer`, `confirmTransfer`). These are actual chain timestamps, not promised delivery targets. Confirmation establishes the contract's custody transition; it does not independently prove physical delivery or on-time performance.

Return `NOT_ASSESSABLE` when the deadline source/policy is unapproved or absent, no eligible matured commitments exist, a material share cannot be attributed or verified, the window is incomplete, or unresolved duplicates/disputes could change the result. A zero can be returned only when eligible verified commitments exist and none meet the approved success rule; zero eligible records is not a zero score.

### Expert validation required

Logistics and research experts must approve deadline provenance, maturity window, success definition, cancellations/rejections, time zones, identity attribution, minimum evidence coverage, and treatment of pending commitments. No deadline or timing limit is supplied by this specification.

## 2. Recall Response (`recall`, 30%)

### Purpose and proposed method

Measure whether a pharmacy performs the required response actions for verified recall notices that were demonstrably delivered to it. A batch recall record alone does not show pharmacy notification, acknowledgement, quarantine, return, or other action. The existing `BatchRecallRecorded` event must not itself generate a pharmacy score.

Candidate formula after approval:

`R = 100 * (eligible pharmacy recall notices with all required actions completed within the approved response window / eligible pharmacy recall notices whose response window has matured)`

The required actions and response window must come from an approved operational/research policy. This specification invents no NMRA response deadline.

### Required fields

- Stable recall case ID, affected batch/product IDs, scope, issuing authority/source, and recall event reference.
- Canonical pharmacy ID and evidence the notice was delivered to that pharmacy, including delivery channel and timestamp.
- Required pharmacy actions, action owner, approved response window and policy version.
- Pharmacy acknowledgement timestamp, action timestamps, completion evidence, and verification status.
- Recall status, corrections, duplicate notice/case links, and dispute/appeal references.

### Numerator, denominator, exclusions, and attribution

- **Numerator:** eligible delivered notices for which all applicable required actions have verified completion within the approved window.
- **Denominator:** eligible notices delivered to the pharmacy whose response window has elapsed, after de-duplicating notices for the same recall obligation under an approved case rule.
- **Attribution:** count only pharmacies with verified notice delivery and identity mapping. A batch's current custodian is not by itself proof that the pharmacy received the recall notice.
- **Exclusions/edge cases:** notices not applicable to that pharmacy, duplicates/superseded notices, undelivered notices, cases whose response window has not elapsed, and records under material dispute. The policy must determine whether partial action receives partial credit or fails the “all required actions” rule; this proposal uses the latter for a simple binary case outcome.

### Synthetic worked example

**Synthetic test example only; not real pharmacy data.** Suppose 5 delivered recall notices have matured for a pharmacy; 4 have verified acknowledgement and completion of every required action within the approved window. Then `R = 100 * 4 / 5 = 80`. A recall event with no pharmacy-level notice/response evidence gives `NOT_ASSESSABLE`, not 0 and not a default score.

### Evidence, assessability, and limitations

Real assessment requires a verified pharmacy-level notice and response system linked to the batch recall event. Component 1's `recallBatch` stores a recalled flag and emits `BatchRecallRecorded` with batch ID, recall actor, and reason (`blockchain/contracts/MedicineTraceability.sol`, `recallBatch`). It contains no pharmacy recipient, acknowledgement, response, or completion fields. Those records must come from an approved additional evidence source.

Return `NOT_ASSESSABLE` when pharmacy-level notice delivery or identity cannot be verified, no matured eligible response obligations exist, required actions/window are undefined, the record set is incomplete, or unresolved disputes/duplicates may affect the outcome. A score of zero requires a non-empty, verified denominator and zero successful responses.

### Expert validation required

Pharmacy operations, recall-management, and research experts must approve notice applicability, proof of delivery, required action set, response window, partial completion rules, duplicate/supersession logic, minimum coverage, and the impact of disputed recalls.

## 3. Complaint-Handling Performance (`complaint`, 20%)

### Purpose and proposed method

Assess whether eligible, verified complaints receive acknowledgement, investigation, and resolution according to an approved research protocol. Real complaint data is not currently integrated in the repository. Do not infer complaint performance from absence of complaint records.

Candidate case-based formula after approval:

`C = 100 * (eligible complaints meeting every applicable approved acknowledgement, investigation, and resolution criterion / eligible complaints due for those criteria in the assessment window)`

A complaint is a successful numerator case only if all milestones applicable under the approved protocol are evidenced. The protocol may define milestone-level partial credit instead, but that is a separate research decision and must not be introduced implicitly. No official NMRA response-time limits are asserted here.

### Required fields

- Stable complaint ID, received timestamp, originating channel, pharmacy ID, and product/batch reference where applicable.
- Complaint category, allegation, severity/priority under the approved study taxonomy, and applicability decision.
- Acknowledgement timestamp and evidence; investigation start/completion, actions, findings, and supporting references.
- Resolution decision, resolution timestamp, complainant notification evidence where appropriate, closure status, and reviewer/verification state.
- Duplicate/related complaint links, withdrawal, appeal/dispute state, redactions, and the policy/version defining due milestones.

### Numerator, denominator, exclusions, and attribution

- **Numerator:** eligible complaints whose required acknowledgement, investigation, and resolution milestones are verified and satisfy the approved protocol.
- **Denominator:** eligible complaints for which required milestones became due during the assessment window; unresolved cases count according to their matured due milestones, not by being silently excluded.
- **Attribution:** assign only when evidence establishes the complaint is about a service or action attributable to the pharmacy being scored. Product/manufacturer complaints should not be assigned to a pharmacy without an approved responsibility rule.
- **Exclusions/edge cases:** duplicate reports linked to one underlying complaint, out-of-scope complaints, withdrawn/invalid records under an approved rule, and complaints whose milestones are not yet due. Preserve exclusion reason and count. Do not discard substantiated cases merely because outcome is unfavorable.

### Synthetic worked example

**Synthetic test example only; not real pharmacy data.** Suppose 10 unique, eligible complaints have all required milestones due; 8 have verified acknowledgement, investigation, and resolution satisfying the approved protocol. Then `C = 100 * 8 / 10 = 80`. With no integrated, verified complaint source or approved milestone policy, return `NOT_ASSESSABLE`.

### Evidence, assessability, and limitations

Real assessment requires access to an authoritative complaint register or approved source, stable case identifiers, auditable timestamps/status transitions, pharmacy attribution, and verified closure evidence. None was identified as integrated in the repository. Complaint privacy and personal data minimization must be designed before collection; identifying complainant data should not be placed on-chain.

Return `NOT_ASSESSABLE` when the source is absent/unavailable, case identity or attribution cannot be verified, milestone policy is unapproved, the observation window is incomplete, or unresolved duplicates/disputes materially affect the denominator. No eligible complaints is not automatically a perfect score; it is insufficient evidence unless a separately approved protocol defines a minimum exposure/volume rule.

### Expert validation required

Complaint-handling and research experts must define eligible complaint scope, severity taxonomy, response milestones, acceptable resolution evidence, timing rules, duplicate linkage, appeals, privacy controls, sample sufficiency, and treatment of open cases. This document defines no official NMRA response time.

## 4. Inspection Performance (`inspection`, 15%)

### Purpose and proposed method

Summarize verified inspection outcomes and corrective-action closure using an approved, transparent rubric. Real inspection data is not currently integrated in the repository. The score must not replace, reinterpret, or conceal the official inspection record or regulatory decision.

Candidate formula after approval, if experts approve criterion points:

`I = 100 * (verified applicable points achieved / total approved points applicable in eligible inspections)`

The approved rubric must define how findings affect points, what “achieved” means, treatment of not-applicable criteria, inspection recency, and how verified corrective-action closure changes the result. No official NMRA penalties or severity weights are proposed here. Critical findings remain separately escalated regardless of `I` or `TS`.

### Required fields

- Stable inspection ID, pharmacy/premises ID, inspection date, inspecting authority/source, and source authenticity/verification status.
- Applicable checklist/rubric version and each criterion's applicability, approved points, finding, and evidence reference.
- Finding status, required corrective action, responsible party, due date under the source process, action evidence, reviewer, and verified closure date/status.
- Inspection outcome as recorded by the authority, dispute/appeal/correction state, and links to superseding or follow-up inspections.
- Critical regulatory finding identifier and separate escalation status, without substituting an aggregate score for the official finding.

### Numerator, denominator, exclusions, and attribution

- **Numerator:** approved points achieved on applicable criteria, based on verified findings and any closure credit allowed by the approved rubric.
- **Denominator:** total approved points applicable to the pharmacy/premises across eligible inspections in the defined window. The rubric must state whether and how inspections are combined; do not average incomparable rubrics without normalization approval.
- **Attribution:** inspection must apply to the same legal entity/premises represented by the scored identity; a wallet address alone is insufficient to establish that relation.
- **Exclusions/edge cases:** draft/unverified inspections, superseded duplicates, inspections outside the approved recency window, criteria not applicable under the rubric, and records under unresolved dispute as policy specifies. Missing inspection records are not evidence of a pass.

### Synthetic worked example

**Synthetic test example only; not real pharmacy data.** Suppose a future expert-approved rubric has 100 applicable points for one eligible synthetic inspection and verified findings show 90 points achieved under that rubric. Then `I = 100 * 90 / 100 = 90`. This example does not define a real inspection penalty or severity value. Without verified inspection records and an approved rubric, return `NOT_ASSESSABLE`.

### Evidence, assessability, and limitations

Real assessment requires authoritative inspection records, a versioned approved rubric, pharmacy/premises identity mapping, verified findings, and auditable corrective-action/closure information. No inspection source integration or scoring rubric was found in the repository. Inspection records may contain sensitive operational details and must be handled under approved access and retention rules.

Return `NOT_ASSESSABLE` when no valid eligible inspection evidence exists, the rubric/version is absent, identity or source authenticity is uncertain, the measurement window is incomplete, or open disputes make the calculation unreliable. A critical finding is separately escalated; it must not be hidden by a high `I` or `TS`.

### Expert validation required

Regulatory, pharmacy practice, and research experts must approve the rubric, applicability/points, recency, follow-up and closure treatment, disputed findings, premises/entity attribution, minimum evidence, and escalation procedure. This proposal invents no official inspection penalty or severity weighting.

## Repository evidence and source interfaces

- Component 1 contract `blockchain/contracts/MedicineTraceability.sol` records confirmed custody transfers and batch-level recall events. The Component 1 API exposes transfer history at `GET /api/v1/traceability/batches/:batchId/history` through `backend/component1-traceability/server.js`.
- These interfaces do not provide an approved expected-delivery deadline, pharmacy-level recall acknowledgement, complaint records, or inspection records.
- The current trust score core (`backend/component3-pharmacy-trust/services/trustScore.js`) receives four already-normalized values and returns `NOT_ASSESSABLE` if any indicator is unavailable. It has no data adapters or regulatory decision authority.

## Research references requiring source verification

The project brief identifies these guideline references by name/topic:

- **GL-013:** Good Distribution Practices — complaints, product recall, and self-inspection.
- **GL-014:** Good Pharmacy Practice — complaints policy, medicine recall policy, and audit policy.
- **GL-015:** Good Storage Practices — dispatch and transport.

The actual guideline documents were not present in the inspected repository inventory. These references are recorded from the project brief, not from inspection of the source documents. Before operationalizing any indicator, obtain the applicable official versions and verify exact titles, clauses, scope, current validity, and applicability with the supervisor/domain experts. No quotations, section numbers, official thresholds, response deadlines, penalty weights, or NMRA-prescribed scoring formulas are asserted in this document.

## Decisions requiring supervisor or expert approval

1. Canonical pharmacy identity, premises/entity mapping, wallet ownership, and historical mapping rules.
2. Delivery commitment definition, authoritative expected-deadline source, on-time rule, maturity window, cancellation/rejection treatment, and minimum volume.
3. Recall notice delivery proof, pharmacy-specific required actions, approved response window, partial completion, and duplicate/superseded case handling.
4. Complaint scope, severity taxonomy, milestone policy, response/resolution windows, open-case treatment, privacy, and minimum evidence.
5. Inspection source verification, rubric, applicability and point allocation, follow-up/closure treatment, recency, and dispute handling.
6. De-duplication keys, measurement windows, stale-data policy, evidence provenance, source outage behavior, and minimum evidence sufficiency for each indicator.
7. Critical-finding escalation recipients, process, audit trail, and separation from aggregate score and official regulatory decisions.
8. Verification of GL-013, GL-014, and GL-015 source documents and their applicability to this research protocol.
9. Whether any computed indicator is ready to move from `NOT_ASSESSABLE` to assessable status; this requires approved rules and actual verified sources, not synthetic examples.
