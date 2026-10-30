> **SYNTHETIC DATA - NOT REAL PHARMACY DATA.**
>
> **Proposed weights (D 0.35, R 0.30, C 0.20, I 0.15) and tier thresholds (80 / 60 / 40) are research parameters, not NMRA-prescribed values.**
>
> **These results show computational correctness and robustness to weight assumptions only. They do not show real-world accuracy.**

# Component 3 Validation Results

Reproduce with `node validation/component3/run.js`. Scenario seed 20261021; global-sensitivity seed 20261022 (1000 draws). Outputs are deterministic and contain no timestamps.

## 1. Functional tests (T01-T08, plus supplementary T09-T10)

Acceptance criteria (set before execution): 100% of cases pass; numeric |observed - expected| <= 1e-9.

**Observed: 10/10 cases passed (100.0%); 45/45 individual checks passed; max numeric |difference| = 1.42e-14.**

| ID | Case | Checks passed | Max abs diff | Result |
|---|---|---|---|---|
| T01 | Delivery reliability: 7 on-time of 10 eligible -> D = 70 | 2/2 | 0.00e+0 | PASS |
| T02 | Recall response: 9 of 12 applicable recall actions -> R = 75 | 2/2 | 0.00e+0 | PASS |
| T03 | Complaint handling: 4 of 6 eligible complaints -> C = 66.666... | 3/3 | 0.00e+0 | PASS |
| T04 | Inspection: 16 points of 20 applicable -> I = 80 | 2/2 | 0.00e+0 | PASS |
| T05 | Weighted trust score: (80,80,70,80) -> 78; (70,75,66.67,80) -> 72.334 | 4/4 | 1.42e-14 | PASS |
| T06 | No eligible recall records -> R NOT_ASSESSABLE; overall NOT_ASSESSABLE, score null, no renormalisation | 7/7 | n/a | PASS |
| T07 | Duplicate evidence submitted twice -> counted once; numerator and denominator unchanged | 7/7 | 0.00e+0 | PASS |
| T08 | Critical finding with high score (>= 80) -> escalation required, score unchanged | 6/6 | 0.00e+0 | PASS |
| T09 | Supplementary: indicator value 0 is ASSESSABLE and distinct from NOT_ASSESSABLE | 5/5 | 0.00e+0 | PASS |
| T10 | Supplementary: tier boundaries 80 / 79.99 / 60 / 59.99 / 40 / 39.99 | 7/7 | n/a | PASS |

## 2. Scenario profiles and expected-behaviour checks

40 synthetic profiles: 35 ASSESSABLE, 5 NOT_ASSESSABLE. Tier counts: HIGHLY_TRUSTED 12, TRUSTED 16, UNDER_REVIEW 3, ESCALATION_ALERT 4, NOT_ASSESSABLE 5.

**Observed: 7/7 checks passed.**

| ID | Expected behaviour | Profiles checked | Passed | Result |
|---|---|---|---|---|
| S1 | Missing indicator -> NOT_ASSESSABLE, score null, no renormalisation | 5 | 5 | PASS |
| S2 | Critical finding -> escalation required regardless of score; score unchanged | 3 | 3 | PASS |
| S3 | No critical finding -> escalation not required | 37 | 37 | PASS |
| S4 | Boundary profiles (80/60/40) -> exact score and tier | 3 | 3 | PASS |
| S5 | Zero-value indicator is ASSESSABLE and distinct from NOT_ASSESSABLE | 1 | 1 | PASS |
| S6 | All evidence SYNTHETIC; assessable scores labelled SYNTHETIC | 40 | 40 | PASS |
| S7 | Determinism: same seed -> identical results; different seed -> different profiles | 2 | 2 | PASS |

<details><summary>Per-profile results</summary>

| Pharmacy | Archetype | D | R | C | I | Status | Score | Tier | Escalation |
|---|---|---|---|---|---|---|---|---|---|
| SYN-EXCELLENT-01 | excellent | 88.89 | 100.00 | 100.00 | 93.33 | ASSESSABLE | 95.111 | HIGHLY_TRUSTED | no |
| SYN-EXCELLENT-02 | excellent | 87.50 | 91.67 | 100.00 | 97.14 | ASSESSABLE | 92.696 | HIGHLY_TRUSTED | no |
| SYN-EXCELLENT-03 | excellent | 95.00 | 91.67 | 100.00 | 92.31 | ASSESSABLE | 94.596 | HIGHLY_TRUSTED | no |
| SYN-EXCELLENT-04 | excellent | 93.75 | 100.00 | 100.00 | 96.30 | ASSESSABLE | 97.257 | HIGHLY_TRUSTED | no |
| SYN-GOOD-01 | good | 86.36 | 75.00 | 71.43 | 81.48 | ASSESSABLE | 79.235 | TRUSTED | no |
| SYN-GOOD-02 | good | 85.71 | 83.33 | 80.00 | 80.39 | ASSESSABLE | 83.059 | HIGHLY_TRUSTED | no |
| SYN-GOOD-03 | good | 80.95 | 75.00 | 83.33 | 79.17 | ASSESSABLE | 79.375 | TRUSTED | no |
| SYN-GOOD-04 | good | 76.47 | 75.00 | 75.00 | 77.27 | ASSESSABLE | 75.856 | TRUSTED | no |
| SYN-AVERAGE-01 | average | 60.00 | 50.00 | 70.00 | 65.00 | ASSESSABLE | 59.750 | UNDER_REVIEW | no |
| SYN-AVERAGE-02 | average | 75.00 | 55.56 | 60.00 | 69.09 | ASSESSABLE | 65.280 | TRUSTED | no |
| SYN-AVERAGE-03 | average | 69.57 | 66.67 | 75.00 | 70.21 | ASSESSABLE | 69.880 | TRUSTED | no |
| SYN-AVERAGE-04 | average | 58.82 | 60.00 | 71.43 | 73.33 | ASSESSABLE | 63.874 | TRUSTED | no |
| SYN-POOR-01 | poor | 20.83 | 50.00 | 50.00 | 34.48 | ASSESSABLE | 37.464 | ESCALATION_ALERT | no |
| SYN-POOR-02 | poor | 33.33 | 22.22 | 27.27 | 28.13 | ASSESSABLE | 28.007 | ESCALATION_ALERT | no |
| SYN-POOR-03 | poor | 20.00 | 40.00 | 42.86 | 38.64 | ASSESSABLE | 33.367 | ESCALATION_ALERT | no |
| SYN-POOR-04 | poor | 23.81 | 33.33 | 33.33 | 33.33 | ASSESSABLE | 30.000 | ESCALATION_ALERT | no |
| SYN-RECALL-FAIL-01 | recall-failure | 100.00 | 18.18 | 85.71 | 89.19 | ASSESSABLE | 70.976 | TRUSTED | no |
| SYN-RECALL-FAIL-02 | recall-failure | 94.44 | 0.00 | 100.00 | 98.04 | ASSESSABLE | 67.761 | TRUSTED | no |
| SYN-RECALL-FAIL-03 | recall-failure | 86.67 | 25.00 | 100.00 | 93.33 | ASSESSABLE | 71.833 | TRUSTED | no |
| SYN-DELIVERY-WEAK-01 | delivery-weak | 26.32 | 88.89 | 100.00 | 90.00 | ASSESSABLE | 69.377 | TRUSTED | no |
| SYN-DELIVERY-WEAK-02 | delivery-weak | 26.67 | 85.71 | 100.00 | 88.64 | ASSESSABLE | 68.343 | TRUSTED | no |
| SYN-DELIVERY-WEAK-03 | delivery-weak | 42.86 | 100.00 | 100.00 | 97.83 | ASSESSABLE | 79.674 | TRUSTED | no |
| SYN-COMPLAINT-WEAK-01 | complaint-weak | 100.00 | 83.33 | 25.00 | 90.91 | ASSESSABLE | 78.636 | TRUSTED | no |
| SYN-COMPLAINT-WEAK-02 | complaint-weak | 100.00 | 100.00 | 40.00 | 88.24 | ASSESSABLE | 86.235 | HIGHLY_TRUSTED | no |
| SYN-COMPLAINT-WEAK-03 | complaint-weak | 87.50 | 81.82 | 20.00 | 88.00 | ASSESSABLE | 72.370 | TRUSTED | no |
| SYN-INSPECTION-WEAK-01 | inspection-weak | 90.00 | 83.33 | 80.00 | 40.00 | ASSESSABLE | 78.500 | TRUSTED | no |
| SYN-INSPECTION-WEAK-02 | inspection-weak | 86.36 | 100.00 | 100.00 | 33.96 | ASSESSABLE | 85.322 | HIGHLY_TRUSTED | no |
| SYN-INSPECTION-WEAK-03 | inspection-weak | 95.83 | 100.00 | 100.00 | 28.07 | ASSESSABLE | 87.752 | HIGHLY_TRUSTED | no |
| SYN-CRITICAL-HIGH-01 | critical-finding-with-high-score | 100.00 | 85.71 | 85.71 | 91.67 | ASSESSABLE | 91.607 | HIGHLY_TRUSTED | REQUIRED |
| SYN-CRITICAL-HIGH-02 | critical-finding-with-high-score | 95.24 | 100.00 | 100.00 | 100.00 | ASSESSABLE | 98.333 | HIGHLY_TRUSTED | REQUIRED |
| SYN-CRITICAL-HIGH-03 | critical-finding-with-high-score | 95.83 | 100.00 | 90.00 | 97.62 | ASSESSABLE | 96.185 | HIGHLY_TRUSTED | REQUIRED |
| SYN-MISSING-D-01 | missing-delivery | n/a | 81.82 | 72.73 | 79.17 | NOT_ASSESSABLE | n/a | NOT_ASSESSABLE | no |
| SYN-MISSING-R-01 | missing-recall | 76.47 | n/a | 80.00 | 86.05 | NOT_ASSESSABLE | n/a | NOT_ASSESSABLE | no |
| SYN-MISSING-C-01 | missing-complaint | 78.57 | 81.82 | n/a | 88.89 | NOT_ASSESSABLE | n/a | NOT_ASSESSABLE | no |
| SYN-MISSING-I-01 | missing-inspection | 85.71 | 81.82 | 100.00 | n/a | NOT_ASSESSABLE | n/a | NOT_ASSESSABLE | no |
| SYN-MISSING-ALL-01 | all-missing | n/a | n/a | n/a | n/a | NOT_ASSESSABLE | n/a | NOT_ASSESSABLE | no |
| SYN-ZERO-D-01 | zero-delivery | 0.00 | 80.00 | 83.33 | 89.19 | ASSESSABLE | 54.045 | UNDER_REVIEW | no |
| SYN-BOUNDARY-80 | boundary-80 | 80.00 | 80.00 | 80.00 | 80.00 | ASSESSABLE | 80.000 | HIGHLY_TRUSTED | no |
| SYN-BOUNDARY-60 | boundary-60 | 60.00 | 60.00 | 60.00 | 60.00 | ASSESSABLE | 60.000 | TRUSTED | no |
| SYN-BOUNDARY-40 | boundary-40 | 40.00 | 40.00 | 40.00 | 40.00 | ASSESSABLE | 40.000 | UNDER_REVIEW | no |

</details>

## 3. Equal-weight baseline

Proposed (D 0.3500, R 0.3000, C 0.2000, I 0.1500) vs equal (all 0.25), on ASSESSABLE profiles only. Aggregator consistency with production calculateTrustScore: max |difference| = 0.00e+0 over 35 profiles.

| Metric | Observed |
|---|---|
| Profiles compared | 35 |
| Excluded (NOT_ASSESSABLE) | 5 |
| Mean absolute score difference | 2.3778 |
| Max absolute score difference | 9.0856 |
| Spearman rank correlation | 0.9700 |
| Tier switches | 3 of 35 |
| Tier-switch rate | 8.6% |

## 4. One-at-a-time weight sensitivity

Renormalisation is used here only for weight perturbation; the production rule never renormalises for missing indicators (missing indicator -> NOT_ASSESSABLE).

| Weight | Change | Renormalised weights | Mean abs change | Max abs change | Spearman rho | Tier switches | Switch rate |
|---|---|---|---|---|---|---|---|
| delivery | -10% | D 0.3264, R 0.3109, C 0.2073, I 0.1554 | 0.4280 | 1.9602 | 0.9986 | 2 | 5.7% |
| delivery | -5% | D 0.3384, R 0.3053, C 0.2036, I 0.1527 | 0.2102 | 0.9626 | 0.9992 | 1 | 2.9% |
| delivery | +5% | D 0.3612, R 0.2948, C 0.1966, I 0.1474 | 0.2030 | 0.9295 | 0.9989 | 0 | 0.0% |
| delivery | +10% | D 0.3720, R 0.2899, C 0.1932, I 0.1449 | 0.3990 | 1.8276 | 0.9961 | 0 | 0.0% |
| recall | -10% | D 0.3608, R 0.2784, C 0.2062, I 0.1546 | 0.3515 | 2.0957 | 0.9972 | 3 | 8.6% |
| recall | -5% | D 0.3553, R 0.2893, C 0.2030, I 0.1523 | 0.1731 | 1.0319 | 0.9992 | 0 | 0.0% |
| recall | +5% | D 0.3448, R 0.3103, C 0.1970, I 0.1478 | 0.1680 | 1.0014 | 1.0000 | 0 | 0.0% |
| recall | +10% | D 0.3398, R 0.3204, C 0.1942, I 0.1456 | 0.3310 | 1.9736 | 0.9986 | 1 | 2.9% |
| complaint | -10% | D 0.3571, R 0.3061, C 0.1837, I 0.1531 | 0.2751 | 1.0946 | 0.9972 | 0 | 0.0% |
| complaint | -5% | D 0.3535, R 0.3030, C 0.1919, I 0.1515 | 0.1362 | 0.5418 | 1.0000 | 0 | 0.0% |
| complaint | +5% | D 0.3465, R 0.2970, C 0.2079, I 0.1485 | 0.1335 | 0.5311 | 0.9994 | 0 | 0.0% |
| complaint | +10% | D 0.3431, R 0.2941, C 0.2157, I 0.1471 | 0.2643 | 1.0517 | 0.9989 | 1 | 2.9% |
| inspection | -10% | D 0.3553, R 0.3046, C 0.2030, I 0.1371 | 0.1712 | 0.9089 | 0.9997 | 0 | 0.0% |
| inspection | -5% | D 0.3526, R 0.3023, C 0.2015, I 0.1436 | 0.0849 | 0.4510 | 0.9997 | 0 | 0.0% |
| inspection | +5% | D 0.3474, R 0.2978, C 0.1985, I 0.1563 | 0.0837 | 0.4443 | 1.0000 | 0 | 0.0% |
| inspection | +10% | D 0.3448, R 0.2956, C 0.1970, I 0.1626 | 0.1661 | 0.8820 | 1.0000 | 0 | 0.0% |

## 5. Global weight check and tier stability

1000 weight vectors drawn uniformly over all weightings that sum to 1 (Dirichlet(1,1,1,1), seed 20261022). This is a deliberately extreme stress test (it includes weightings far from any plausible expert view), not an estimate of expected variation.

| Metric | Observed |
|---|---|
| Profiles compared | 35 |
| Spearman rho vs proposed: mean | 0.8600 |
| Spearman rho vs proposed: median | 0.8658 |
| Spearman rho vs proposed: 5th percentile | 0.7087 |
| Spearman rho vs proposed: minimum | 0.6294 |
| Overall tier stability (profile x draw pairs keeping proposed tier) | 73.5% |
| Profiles keeping their tier in every draw | 12 of 35 |
| Median per-profile score range | 13.7039 |
| Max per-profile score range | 84.5494 |

| Pharmacy | Archetype | Proposed score | Proposed tier | Score range (min-max) | Rank range | Tier stability |
|---|---|---|---|---|---|---|
| SYN-EXCELLENT-01 | excellent | 95.111 | HIGHLY_TRUSTED | 89.51-99.75 | 3-11 | 100.0% |
| SYN-EXCELLENT-02 | excellent | 92.696 | HIGHLY_TRUSTED | 88.16-99.56 | 2-12 | 100.0% |
| SYN-EXCELLENT-03 | excellent | 94.596 | HIGHLY_TRUSTED | 91.92-99.34 | 2-9 | 100.0% |
| SYN-EXCELLENT-04 | excellent | 97.257 | HIGHLY_TRUSTED | 94.10-99.86 | 2-9 | 100.0% |
| SYN-GOOD-01 | good | 79.235 | TRUSTED | 72.00-85.71 | 11-23 | 70.3% |
| SYN-GOOD-02 | good | 83.059 | HIGHLY_TRUSTED | 80.12-85.35 | 8-19 | 100.0% |
| SYN-GOOD-03 | good | 79.375 | TRUSTED | 75.86-82.80 | 12-21 | 59.8% |
| SYN-GOOD-04 | good | 75.856 | TRUSTED | 75.04-77.20 | 16-22 | 100.0% |
| SYN-AVERAGE-01 | average | 59.750 | UNDER_REVIEW | 51.83-69.12 | 23-30 | 35.3% |
| SYN-AVERAGE-02 | average | 65.280 | TRUSTED | 57.04-74.14 | 19-29 | 93.4% |
| SYN-AVERAGE-03 | average | 69.880 | TRUSTED | 67.21-74.41 | 20-25 | 100.0% |
| SYN-AVERAGE-04 | average | 63.874 | TRUSTED | 59.62-72.49 | 21-27 | 99.5% |
| SYN-POOR-01 | poor | 37.464 | ESCALATION_ALERT | 22.57-49.36 | 28-35 | 56.6% |
| SYN-POOR-02 | poor | 28.007 | ESCALATION_ALERT | 23.33-32.73 | 29-35 | 100.0% |
| SYN-POOR-03 | poor | 33.367 | ESCALATION_ALERT | 21.69-42.42 | 30-35 | 92.0% |
| SYN-POOR-04 | poor | 30.000 | ESCALATION_ALERT | 24.65-33.33 | 32-35 | 100.0% |
| SYN-RECALL-FAIL-01 | recall-failure | 70.976 | TRUSTED | 29.59-98.43 | 2-33 | 41.7% |
| SYN-RECALL-FAIL-02 | recall-failure | 67.761 | TRUSTED | 14.27-98.82 | 2-35 | 32.9% |
| SYN-RECALL-FAIL-03 | recall-failure | 71.833 | TRUSTED | 34.64-97.69 | 7-31 | 39.8% |
| SYN-DELIVERY-WEAK-01 | delivery-weak | 69.377 | TRUSTED | 31.88-98.85 | 7-31 | 45.3% |
| SYN-DELIVERY-WEAK-02 | delivery-weak | 68.343 | TRUSTED | 32.02-98.66 | 8-30 | 47.4% |
| SYN-DELIVERY-WEAK-03 | delivery-weak | 79.674 | TRUSTED | 47.76-99.79 | 2-27 | 25.9% |
| SYN-COMPLAINT-WEAK-01 | complaint-weak | 78.636 | TRUSTED | 30.50-98.89 | 2-33 | 43.0% |
| SYN-COMPLAINT-WEAK-02 | complaint-weak | 86.235 | HIGHLY_TRUSTED | 45.22-99.33 | 1-29 | 64.2% |
| SYN-COMPLAINT-WEAK-03 | complaint-weak | 72.370 | TRUSTED | 25.59-87.71 | 10-35 | 56.8% |
| SYN-INSPECTION-WEAK-01 | inspection-weak | 78.500 | TRUSTED | 43.14-88.62 | 10-30 | 65.2% |
| SYN-INSPECTION-WEAK-02 | inspection-weak | 85.322 | HIGHLY_TRUSTED | 37.56-99.37 | 5-31 | 58.0% |
| SYN-INSPECTION-WEAK-03 | inspection-weak | 87.752 | HIGHLY_TRUSTED | 32.53-99.52 | 1-34 | 60.7% |
| SYN-CRITICAL-HIGH-01 | critical-finding-with-high-score | 91.607 | HIGHLY_TRUSTED | 85.97-99.06 | 1-14 | 100.0% |
| SYN-CRITICAL-HIGH-02 | critical-finding-with-high-score | 98.333 | HIGHLY_TRUSTED | 95.66-100.00 | 1-6 | 100.0% |
| SYN-CRITICAL-HIGH-03 | critical-finding-with-high-score | 96.185 | HIGHLY_TRUSTED | 90.79-99.34 | 2-13 | 100.0% |
| SYN-ZERO-D-01 | zero-delivery | 54.045 | UNDER_REVIEW | 7.51-86.52 | 11-35 | 28.9% |
| SYN-BOUNDARY-80 | boundary-80 | 80.000 | HIGHLY_TRUSTED | 80.00-80.00 | 11-20 | 87.3% |
| SYN-BOUNDARY-60 | boundary-60 | 60.000 | TRUSTED | 60.00-60.00 | 24-30 | 79.6% |
| SYN-BOUNDARY-40 | boundary-40 | 40.000 | UNDER_REVIEW | 40.00-40.00 | 28-33 | 87.3% |

## 6. AHP

**AHP: tooling ready, expert responses not yet collected.**

Priority-vector, lambda_max, CI/CR (RI(4) = 0.90) and geometric-mean aggregation are implemented and unit-tested. No weights are derived until real expert forms (ahp/EXPERT_INPUT_TEMPLATE.md) are returned.

## Interpretation limits

- All profiles are generated synthetic counts; archetype ranges are illustrative assumptions.
- Robustness here is measured with respect to the weight assumptions only. It says nothing about whether the indicators measure real pharmacy trustworthiness.
- See VALIDATION_METHODOLOGY.md for methods, criteria and limitations.
