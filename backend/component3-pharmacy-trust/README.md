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

The repository has no Component 3 package manifest or central backend host. The prototype uses Node's built-in HTTP module and adds no dependency. Hosting, identity authorization, a trusted assessment provider, and any synchronization policy require separate integration decisions.

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
