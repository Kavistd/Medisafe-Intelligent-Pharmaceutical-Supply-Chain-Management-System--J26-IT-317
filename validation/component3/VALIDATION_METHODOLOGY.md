> **SYNTHETIC DATA - NOT REAL PHARMACY DATA.** Proposed weights (D 0.35, R 0.30, C 0.20, I 0.15) and tier
> thresholds (80 / 60 / 40) are research parameters, not NMRA-prescribed values. This validation shows
> computational correctness and robustness to weight assumptions only. It does not show real-world accuracy.

# Component 3 Validation Methodology

Component 3 computes a pharmacy trust score from four indicators: Delivery reliability (D), Recall response (R),
Complaint handling (C) and Inspection performance (I).

TS = 0.35 D + 0.30 R + 0.20 C + 0.15 I

It assigns a tier (>= 80 Highly trusted, >= 60 Trusted, >= 40 Under review, < 40 Escalation alert) and escalates
critical regulatory findings separately from the score. A missing indicator makes the assessment NOT_ASSESSABLE.
The score is never renormalised around missing data.

Reproduce everything with one command: `node validation/component3/run.js` (unit tests: `node --test validation/component3/`).
All randomness is seeded and outputs contain no timestamps, so results are byte-identical across runs.

## Validation methods

| # | Method | Question it answers | Evaluation criterion (fixed before execution) |
|---|---|---|---|
| 1 | **Functional tests T01-T08** (+ T09 zero vs missing, T10 tier boundaries) | Does the implementation compute exactly what the specification says? | 100% pass; numeric difference from hand-calculated values <= 1e-9 |
| 2 | **Scenario profiles**: 40 seeded synthetic pharmacies across 18 archetypes (excellent ... poor, single-indicator failures, critical finding with high score, each missing indicator, all missing, zero delivery, exact 80/60/40 boundaries) | Does the system behave as designed across realistic shapes of evidence? | Missing indicator -> NOT_ASSESSABLE and null score; critical finding -> escalation whatever the score; boundary profiles -> exact tier; same seed -> identical output |
| 3 | **Equal-weight baseline** (0.25 each) | How much do the proposed weights matter compared with a naive alternative? | Reported metrics: mean/max absolute score difference, Spearman rank correlation, tier-switch rate |
| 4 | **One-at-a-time sensitivity** (each weight x 0.90 / 0.95 / 1.05 / 1.10, renormalised) | Are scores, rankings and tiers stable under small changes to the weight assumptions? | Reported metrics: mean/max score change, Spearman rho, tier-switch rate per perturbation |
| 5 | **Global weight stress test** (1000 seeded uniform-simplex weight vectors) | How far can rankings and tiers move under any weighting at all? | Reported metrics: Spearman distribution, per-profile score and rank range, tier stability |
| 6 | **AHP tooling** (eigenvector weights, lambda_max, CI, CR with RI(4) = 0.90, geometric-mean group aggregation) | What weights do domain experts support, and are their judgements consistent? | CR < 0.10 per expert and for the group |

Every calculation runs through the real Component 3 modules (`evidenceValidation`, `indicatorScoring`,
`assessmentService`, `trustScore`). The only extra code in the harness is a weight-parameterised aggregator for
methods 3-5. A test shows it matches the production `calculateTrustScore` to within 1e-12 for the proposed weights.

## What each method does and does not show

| Method | Shows | Does NOT show |
|---|---|---|
| Functional tests | Formulas, NOT_ASSESSABLE handling, deduplication, escalation separation and tier boundaries are implemented correctly | That the formulas are the right way to measure trust |
| Scenario profiles | Correct, deterministic behaviour across many evidence shapes, including edge cases | How real pharmacies are distributed across the tiers |
| Equal-weight baseline | How much the chosen weights change results compared with no weighting | That the proposed weights are better than equal weights |
| Sensitivity (OAT + global) | Robustness of scores, rankings and tiers to the weight assumptions | Robustness to measurement error, missing data or biased sources |
| AHP | A structured, auditable way to turn expert judgement into weights | Anything until real experts respond (status: tooling ready, responses not yet collected) |

## Metrics

- **Absolute score difference**: |TS(alternative weights) - TS(proposed weights)| in points (0-100 scale).
- **Spearman rank correlation**: Pearson correlation of average ranks (ties share the mean rank). 1 means identical ordering.
- **Tier-switch rate**: share of assessable profiles whose tier differs from the tier under the proposed weights.
- **Tier stability (global)**: share of (profile, weight-draw) pairs that keep the proposed tier.
- **AHP CR**: consistency ratio CI / RI. CR < 0.10 is acceptable.

Note that renormalisation is used **only** to perturb weights in methods 4-5. The production rule never
renormalises around a missing indicator. NOT_ASSESSABLE profiles are excluded from ranking, and the number
excluded is reported.

## Limitations

1. **Synthetic data only.** All profiles are seeded synthetic counts. The archetype ranges are illustrative assumptions, not estimates of real pharmacy performance.
2. **Proposed parameters.** Weights and tier thresholds are research-design choices, not NMRA-prescribed or expert-validated values.
3. **No approved delivery-deadline source.** Component 1 supplies actual custody timestamps but no authoritative expected-delivery deadline, so D cannot yet be computed from real records.
4. **Recall response not derivable from Component 1.** Recall events carry no pharmacy recipient, acknowledgement or response action.
5. **Complaint and inspection sources are not integrated.** No health-authority entry path or inspection rubric exists yet; C and I use synthetic counts.
6. **Caller-asserted policy.** The synthetic scoring policy is marked approved by the harness (as in the local demo). No real scoring policy has been approved.
7. **No blockchain verification.** All assessments are off-chain (`blockchainVerification: NOT_PERFORMED`).
8. **Robustness covers weights only.** Measurement error, data quality and source bias are not modelled.

## Planned next steps

1. **Expert AHP round**: distribute `ahp/EXPERT_INPUT_TEMPLATE.md` to regulators and pharmacy experts, require CR < 0.10, then compare the group AHP weights with the proposed weights using the same baseline and sensitivity metrics.
2. **Approved indicator policies**: agree eligibility rules, deadlines and the inspection rubric with the supervisor and domain experts.
3. **Real or realistic data**: integrate Component 1 delivery evidence once a deadline source exists. Add a health-authority entry path for complaints and inspections.
4. **Face validity**: ask experts to rank a sample of anonymised profiles and compare their ranking with the system's (Spearman).
5. **On-chain anchoring**: anchor score and tier to `PharmacyTrust.sol` and re-run the functional suite against anchored values.
