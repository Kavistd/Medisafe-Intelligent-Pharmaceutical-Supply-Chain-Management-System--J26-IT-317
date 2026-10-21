# Component 3 AHP Expert Input Form (blank)

This form collects **real expert judgements** on the relative importance of the four
Component 3 pharmacy trust indicators. The Component 3 team must never fill it in
with assumed or invented answers. Until real forms are returned, results report:
"AHP: tooling ready, expert responses not yet collected".

## Expert details (kept separately from the judgement file if privacy requires)

| Field | Response |
|---|---|
| Expert ID (pseudonymous, e.g. `EXP-01`) | |
| Role / domain (e.g. regulator, hospital pharmacist, supply-chain) | |
| Years of relevant experience | |
| Date completed | |
| Consent to use responses for research | Yes / No |

## The four criteria

| Code | Indicator | What it measures (prototype definition) |
|---|---|---|
| D | Delivery Reliability | Share of eligible delivery commitments completed on time |
| R | Recall Response | Share of applicable recall notices handled completely and on time |
| C | Complaint-Handling Performance | Share of eligible complaints handled to protocol |
| I | Inspection Performance | Rubric points achieved out of applicable points |

Critical regulatory findings are **not** part of this weighting. They are escalated separately, whatever the score.

## Saaty scale

| Value | Meaning (row criterion compared with column criterion) |
|---|---|
| 1 | Equally important |
| 3 | Moderately more important |
| 5 | Strongly more important |
| 7 | Very strongly more important |
| 9 | Extremely more important |
| 2, 4, 6, 8 | Intermediate values |
| 1/3, 1/5, ... | The column criterion is more important (reciprocal) |

## Pairwise comparisons (fill the six upper cells only)

"How much more important is the **row** indicator than the **column** indicator for judging pharmacy trustworthiness?"

| | D | R | C | I |
|---|---|---|---|---|
| **D** | 1 | | | |
| **R** | (auto) | 1 | | |
| **C** | (auto) | (auto) | 1 | |
| **I** | (auto) | (auto) | (auto) | 1 |

Lower cells are the reciprocals of the upper cells (e.g. if D vs R = 3, then R vs D = 1/3).

Optional comments / rationale:

&nbsp;

## Machine-readable file (prepared by the researcher from the returned form)

Save one file per expert as `validation/component3/ahp/inputs/<EXPERT-ID>.json`:

```json
{
  "expertId": "EXP-01",
  "criteria": ["delivery", "recall", "complaint", "inspection"],
  "matrix": [
    [1,       "D/R",   "D/C",   "D/I"],
    ["1/(D/R)", 1,     "R/C",   "R/I"],
    ["1/(D/C)", "1/(R/C)", 1,   "C/I"],
    ["1/(D/I)", "1/(R/I)", "1/(C/I)", 1]
  ]
}
```

Replace every placeholder with a number (write reciprocals as decimals, e.g. `0.3333333333`).
The criteria order must be exactly `delivery, recall, complaint, inspection`.

## Processing

`node validation/component3/run.js` detects the files and, for each expert and for the group
(element-wise geometric mean), reports the priority weights, lambda_max, CI and CR (RI(4) = 0.90).
Judgements with CR >= 0.10 are flagged as inconsistent and should be revisited with the expert.
