'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTrustScore } = require('../services/trustScore');
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
  toTrustScoreInput,
} = require('../services/indicatorScoring');

// All inputs below are synthetic test fixtures; no fixture is real pharmacy evidence.
const syntheticPolicy = { id: 'synthetic-test-policy', approved: true };
const COUNT_FIELDS = {
  delivery: ['onTimeCount', 'eligibleCommitmentCount'],
  recall: ['timelyCompleteNoticeCount', 'eligibleNoticeCount'],
  complaint: ['compliantComplaintCount', 'eligibleComplaintCount'],
};
function countInput(indicator, numerator, denominator, overrides = {}) {
  const [numeratorField, denominatorField] = COUNT_FIELDS[indicator];
  return {
    [numeratorField]: numerator,
    [denominatorField]: denominator,
    evidenceIds: Array.from({ length: denominator }, (_unused, index) => `SYNTHETIC-${indicator}-${index + 1}`),
    source: 'SYNTHETIC',
    policy: { ...syntheticPolicy },
    ...overrides,
  };
}
function inspectionInput(pointsAchieved, pointsApplicable, overrides = {}) {
  return {
    pointsAchieved,
    pointsApplicable,
    evidenceIds: pointsApplicable > 0 ? ['SYNTHETIC-inspection-1'] : [],
    source: 'SYNTHETIC',
    policy: { ...syntheticPolicy },
    ...overrides,
  };
}

const assessors = [
  ['delivery', assessDeliveryReliability, (n, d, extra) => countInput('delivery', n, d, extra)],
  ['recall', assessRecallResponse, (n, d, extra) => countInput('recall', n, d, extra)],
  ['complaint', assessComplaintHandling, (n, d, extra) => countInput('complaint', n, d, extra)],
  ['inspection', assessInspectionPerformance, inspectionInput],
];

for (const [name, assessor, makeInput] of assessors) {
  test(`${name} returns NOT_ASSESSABLE when its scoring policy is unapproved`, () => {
    const result = assessor(makeInput(1, 1, { policy: { id: 'synthetic-unapproved-policy', approved: false } }));
    assert.equal(result.indicator.status, 'NOT_ASSESSABLE');
    assert.equal(Object.hasOwn(result.indicator, 'value'), false);
    assert.match(result.reason, /not been approved/);
    assert.equal(result.indicator.source, 'SYNTHETIC');
  });

  test(`${name} calculates its specification ratio under a supplied approved test policy`, () => {
    const result = assessor(makeInput(3, 4));
    assert.equal(result.indicator.status, 'ASSESSABLE');
    assert.equal(result.indicator.value, 75);
    assert.equal(result.indicator.evidenceCount, name === 'inspection' ? 1 : 4);
    assert.equal(result.indicator.source, 'SYNTHETIC');
    assert.equal(result.policyId, 'synthetic-test-policy');
  });

  test(`${name} accepts score boundaries of zero and 100`, () => {
    const zero = name === 'inspection' ? inspectionInput(0, 10) : makeInput(0, 2);
    const perfect = name === 'inspection' ? inspectionInput(10, 10) : makeInput(2, 2);
    assert.equal(assessor(zero).indicator.value, 0);
    assert.equal(assessor(perfect).indicator.value, 100);
  });

  test(`${name} returns NOT_ASSESSABLE for empty eligible evidence`, () => {
    const result = assessor(makeInput(0, 0));
    assert.equal(result.indicator.status, 'NOT_ASSESSABLE');
    assert.equal(Object.hasOwn(result.indicator, 'value'), false);
    assert.match(result.reason, /No eligible evidence/);
  });

  test(`${name} rejects invalid counts, malformed provenance, and duplicate evidence IDs`, () => {
    const valid = makeInput(1, 2);
    const numeratorField = name === 'inspection' ? 'pointsAchieved' : COUNT_FIELDS[name][0];
    assert.throws(() => assessor({ ...valid, [numeratorField]: -1 }), /finite non-negative/);
    assert.throws(() => assessor({ ...valid, source: 'UNKNOWN' }), /source must be/);
    assert.throws(() => assessor({ ...valid, evidenceIds: ['DUPLICATE', 'DUPLICATE'] }), /duplicates/);
  });
}

test('assessors reject missing, malformed, and out-of-range inputs', () => {
  assert.throws(() => assessDeliveryReliability(null), /plain object/);
  assert.throws(() => assessDeliveryReliability({ evidenceIds: [], source: 'SYNTHETIC' }), /requires/);
  assert.throws(() => assessRecallResponse(countInput('recall', 3, 2)), /cannot exceed/);
  assert.throws(() => assessInspectionPerformance(inspectionInput(101, 100)), /cannot exceed/);
});

test('evidence provenance and identifiers are preserved defensively and results are deterministic', () => {
  const input = countInput('delivery', 1, 1, { evidenceIds: ['SYNTHETIC-D-1'] });
  const before = JSON.stringify(input);
  const first = assessDeliveryReliability(input);
  const second = assessDeliveryReliability(input);
  assert.equal(first.indicator.source, 'SYNTHETIC');
  assert.deepEqual(first.evidenceIds, ['SYNTHETIC-D-1']);
  assert.notStrictEqual(first.evidenceIds, input.evidenceIds);
  first.evidenceIds.push('SYNTHETIC-EXTRA');
  assert.deepEqual(second.evidenceIds, ['SYNTHETIC-D-1']);
  assert.deepEqual(assessDeliveryReliability(input), second);
  assert.equal(JSON.stringify(input), before);
});

test('assessment output adapts to the existing aggregate input contract', () => {
  const assessments = {
    delivery: assessDeliveryReliability(countInput('delivery', 1, 1)),
    recall: assessRecallResponse(countInput('recall', 1, 1)),
    complaint: assessComplaintHandling(countInput('complaint', 1, 1)),
    inspection: assessInspectionPerformance(inspectionInput(1, 1)),
  };
  const aggregateInput = toTrustScoreInput(assessments);
  assert.deepEqual(Object.keys(aggregateInput), ['delivery', 'recall', 'complaint', 'inspection', 'criticalFindings']);
  for (const key of ['delivery', 'recall', 'complaint', 'inspection']) {
    assert.deepEqual(Object.keys(aggregateInput[key]).sort(), ['evidenceCount', 'source', 'status', 'value']);
  }
  assert.equal(calculateTrustScore(aggregateInput).score, 100);
});

test('unavailable evidence and critical findings remain separate in aggregate output', () => {
  const assessments = {
    delivery: assessDeliveryReliability(countInput('delivery', 0, 0)),
    recall: assessRecallResponse(countInput('recall', 1, 1)),
    complaint: assessComplaintHandling(countInput('complaint', 1, 1)),
    inspection: assessInspectionPerformance(inspectionInput(1, 1)),
  };
  const finding = { id: 'SYNTHETIC-CRITICAL-1', description: 'Synthetic test finding' };
  const aggregate = calculateTrustScore(toTrustScoreInput(assessments, [finding]));
  assert.equal(aggregate.status, 'NOT_ASSESSABLE');
  assert.equal(aggregate.score, null);
  assert.equal(aggregate.criticalEscalation.required, true);
  assert.equal(aggregate.criticalEscalation.findings[0].id, finding.id);
});
