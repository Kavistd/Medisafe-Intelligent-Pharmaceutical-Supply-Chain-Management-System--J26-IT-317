'use strict';

/**
 * Functional test cases T01-T08 (+ supplementary T09, T10) for Component 3.
 * SYNTHETIC inputs only. Expected values were calculated by hand, independently
 * of the code, and are written below as exact fractions where needed.
 *
 * Acceptance criteria (fixed before execution):
 *   - 100% of cases pass;
 *   - every numeric check: |observed - expected| <= 1e-9.
 */
const {
  WEIGHTS,
  classifyTier,
  assessDeliveryReliability,
  countRecords,
  evaluateSpec,
} = require('./lib/pipeline');

const TOLERANCE = 1e-9;

// Default synthetic counts: D = 8/10 = 80, R = 8/10 = 80, C = 7/10 = 70, I = 16/20 = 80.
function spec(pharmacyId, overrides = {}, extra = {}) {
  return {
    pharmacyId,
    indicators: {
      delivery: { successes: 8, total: 10 },
      recall: { successes: 8, total: 10 },
      complaint: { successes: 7, total: 10 },
      inspection: { reports: [{ achieved: 16, applicable: 20 }] },
      ...overrides,
    },
    ...extra,
  };
}

function check(label, expected, observed, tolerance = TOLERANCE) {
  if (typeof expected === 'number' && typeof observed === 'number') {
    const absDiff = Math.abs(observed - expected);
    return { label, expected, observed, absDiff, pass: absDiff <= tolerance };
  }
  return { label, expected, observed, absDiff: null, pass: JSON.stringify(expected) === JSON.stringify(observed) };
}

const CASES = [
  {
    id: 'T01',
    title: 'Delivery reliability: 7 on-time of 10 eligible -> D = 70',
    async run() {
      const { assessment } = await evaluateSpec(spec('SYN-T01', { delivery: { successes: 7, total: 10 } }));
      return [
        check('delivery status', 'ASSESSABLE', assessment.breakdown.delivery.status),
        check('D', 70, assessment.breakdown.delivery.value),
      ];
    },
  },
  {
    id: 'T02',
    title: 'Recall response: 9 of 12 applicable recall actions -> R = 75',
    async run() {
      const { assessment } = await evaluateSpec(spec('SYN-T02', { recall: { successes: 9, total: 12 } }));
      return [
        check('recall status', 'ASSESSABLE', assessment.breakdown.recall.status),
        check('R', 75, assessment.breakdown.recall.value),
      ];
    },
  },
  {
    id: 'T03',
    title: 'Complaint handling: 4 of 6 eligible complaints -> C = 66.666...',
    async run() {
      const { assessment } = await evaluateSpec(spec('SYN-T03', { complaint: { successes: 4, total: 6 } }));
      return [
        check('complaint status', 'ASSESSABLE', assessment.breakdown.complaint.status),
        check('C (= 200/3)', 200 / 3, assessment.breakdown.complaint.value),
        check('C rounded to 2 dp', '66.67', assessment.breakdown.complaint.value.toFixed(2)),
      ];
    },
  },
  {
    id: 'T04',
    title: 'Inspection: 16 points of 20 applicable -> I = 80',
    async run() {
      const { assessment } = await evaluateSpec(spec('SYN-T04', { inspection: { reports: [{ achieved: 16, applicable: 20 }] } }));
      return [
        check('inspection status', 'ASSESSABLE', assessment.breakdown.inspection.status),
        check('I', 80, assessment.breakdown.inspection.value),
      ];
    },
  },
  {
    id: 'T05',
    title: 'Weighted trust score: (80,80,70,80) -> 78; (70,75,66.67,80) -> 72.334',
    async run() {
      // Hand calculation: 0.35*80 + 0.30*80 + 0.20*70 + 0.15*80 = 28 + 24 + 14 + 12 = 78.
      const a = (await evaluateSpec(spec('SYN-T05-A'))).assessment;
      // Specification example with C = 66.67 entered as 6667 compliant of 10000 eligible:
      // 0.35*70 + 0.30*75 + 0.20*66.67 + 0.15*80 = 24.5 + 22.5 + 13.334 + 12 = 72.334.
      const b = (await evaluateSpec(spec('SYN-T05-B', {
        delivery: { successes: 7, total: 10 },
        recall: { successes: 9, total: 12 },
        complaint: { successes: 6667, total: 10000 },
      }))).assessment;
      // Same profile with the exact C = 4/6: 24.5 + 22.5 + 40/3 + 12 = 217/3 = 72.333...
      const c = (await evaluateSpec(spec('SYN-T05-C', {
        delivery: { successes: 7, total: 10 },
        recall: { successes: 9, total: 12 },
        complaint: { successes: 4, total: 6 },
      }))).assessment;
      return [
        check('TS (80,80,70,80)', 78, a.score),
        check('tier at 78', 'TRUSTED', a.tier),
        check('TS (70,75,66.67,80)', 72.334, b.score),
        check('TS (70,75,200/3,80) = 217/3', 217 / 3, c.score),
      ];
    },
  },
  {
    id: 'T06',
    title: 'No eligible recall records -> R NOT_ASSESSABLE; overall NOT_ASSESSABLE, score null, no renormalisation',
    async run() {
      const { assessment } = await evaluateSpec(spec('SYN-T06', { recall: { successes: 0, total: 0 } }));
      return [
        check('recall status', 'NOT_ASSESSABLE', assessment.breakdown.recall.status),
        check('recall value (not 100, not 0)', null, assessment.breakdown.recall.value),
        check('overall status', 'NOT_ASSESSABLE', assessment.status),
        check('overall score', null, assessment.score),
        check('tier', 'NOT_ASSESSABLE', assessment.tier),
        check('missing indicators', ['recall'], assessment.missingIndicators.map(item => item.name)),
        // A renormalised score would have been (28 + 14 + 12) / 0.70 = 77.142857...; it must NOT appear.
        check('no renormalised score produced', false, assessment.score !== null),
      ];
    },
  },
  {
    id: 'T07',
    title: 'Duplicate evidence submitted twice -> counted once; numerator and denominator unchanged',
    async run() {
      // 7 on-time of 10 deliveries; on-time record #1 is resubmitted verbatim.
      const [duplicate] = countRecords('SYN-T07', 'delivery', 7, 10);
      const result = await evaluateSpec(spec('SYN-T07', { delivery: { successes: 7, total: 10 } }, { extraEvidence: [duplicate] }));
      let rawDuplicateRejected = false;
      try {
        // The real calculator also refuses double-counted IDs outright.
        assessDeliveryReliability({
          onTimeCount: 8,
          eligibleCommitmentCount: 11,
          evidenceIds: [...result.inputs.delivery.evidenceIds, duplicate.evidenceId],
          source: 'SYNTHETIC',
          policy: { id: 'c3-validation-synthetic-policy', approved: true },
        });
      } catch {
        rawDuplicateRejected = true;
      }
      return [
        check('raw delivery records submitted', 11, result.record.evidence.filter(item => item.indicator === 'delivery').length),
        check('duplicates detected', 1, result.validation.duplicates.length),
        check('numerator (on-time)', 7, result.inputs.delivery.onTimeCount),
        check('denominator (eligible)', 10, result.inputs.delivery.eligibleCommitmentCount),
        check('D', 70, result.assessment.breakdown.delivery.value),
        check('service duplicateCount', 1, result.assessment.evidenceValidation.duplicateCount),
        check('calculator rejects duplicate IDs', true, rawDuplicateRejected),
      ];
    },
  },
  {
    id: 'T08',
    title: 'Critical finding with high score (>= 80) -> escalation required, score unchanged',
    async run() {
      // 0.35*100 + 0.30*90 + 0.20*90 + 0.15*90 = 35 + 27 + 18 + 13.5 = 93.5.
      const indicators = {
        delivery: { successes: 10, total: 10 },
        recall: { successes: 9, total: 10 },
        complaint: { successes: 9, total: 10 },
        inspection: { reports: [{ achieved: 18, applicable: 20 }] },
      };
      const finding = {
        id: 'SYN-CF-T08',
        description: 'Synthetic critical finding for validation; not a real regulatory finding.',
        source: 'SYNTHETIC_TEST_DATA',
      };
      const withFinding = (await evaluateSpec(spec('SYN-T08', indicators, { criticalFindings: [finding] }))).assessment;
      const without = (await evaluateSpec(spec('SYN-T08', indicators))).assessment;
      return [
        check('score with finding', 93.5, withFinding.score),
        check('score >= 80', true, withFinding.score >= 80),
        check('escalation required', true, withFinding.criticalEscalation.required),
        check('score identical without finding', without.score, withFinding.score, 0),
        check('tier unchanged by finding', without.tier, withFinding.tier),
        check('no escalation without finding', false, without.criticalEscalation.required),
      ];
    },
  },
  {
    id: 'T09',
    title: 'Supplementary: indicator value 0 is ASSESSABLE and distinct from NOT_ASSESSABLE',
    async run() {
      // D = 0/10 = 0; TS = 0 + 24 + 14 + 12 = 50.
      const zero = (await evaluateSpec(spec('SYN-T09-ZERO', { delivery: { successes: 0, total: 10 } }))).assessment;
      const missing = (await evaluateSpec(spec('SYN-T09-MISSING', { delivery: { successes: 0, total: 0 } }))).assessment;
      return [
        check('zero delivery status', 'ASSESSABLE', zero.breakdown.delivery.status),
        check('zero delivery value', 0, zero.breakdown.delivery.value),
        check('overall score with D = 0', 50, zero.score),
        check('missing delivery status', 'NOT_ASSESSABLE', missing.breakdown.delivery.status),
        check('missing delivery overall score', null, missing.score),
      ];
    },
  },
  {
    id: 'T10',
    title: 'Supplementary: tier boundaries 80 / 79.99 / 60 / 59.99 / 40 / 39.99',
    async run() {
      return [
        check('80', 'HIGHLY_TRUSTED', classifyTier(80)),
        check('79.99', 'TRUSTED', classifyTier(79.99)),
        check('60', 'TRUSTED', classifyTier(60)),
        check('59.99', 'UNDER_REVIEW', classifyTier(59.99)),
        check('40', 'UNDER_REVIEW', classifyTier(40)),
        check('39.99', 'ESCALATION_ALERT', classifyTier(39.99)),
        check('null', 'NOT_ASSESSABLE', classifyTier(null)),
      ];
    },
  },
];

async function runFunctionalCases() {
  const results = [];
  for (const testCase of CASES) {
    const checks = await testCase.run();
    const numeric = checks.filter(item => item.absDiff !== null).map(item => item.absDiff);
    results.push({
      id: testCase.id,
      title: testCase.title,
      checks,
      checksPassed: checks.filter(item => item.pass).length,
      checksTotal: checks.length,
      maxAbsDiff: numeric.length ? Math.max(...numeric) : null,
      pass: checks.every(item => item.pass),
    });
  }
  return results;
}

module.exports = { TOLERANCE, WEIGHTS, CASES, runFunctionalCases };
