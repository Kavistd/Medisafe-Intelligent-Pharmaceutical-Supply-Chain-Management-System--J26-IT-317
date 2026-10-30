'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WEIGHTS, calculateTrustScore, classifyTier } = require('../services/trustScore');

// These are synthetic test fixtures, not real pharmacy data.
function fixture(values = { delivery: 80, recall: 80, complaint: 70, inspection: 80 }, source = 'SYNTHETIC') {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value === null
    ? { status: 'NOT_ASSESSABLE', evidenceCount: 0, source }
    : { status: 'ASSESSABLE', value, evidenceCount: 1, source }]));
}

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function withOverrides(overrides = {}) {
  return { ...fixture(), ...overrides };
}

test('WEIGHTS has the proposed values, is frozen, and sums to one', () => {
  assert.deepEqual(WEIGHTS, { delivery: 0.35, recall: 0.30, complaint: 0.20, inspection: 0.15 });
  assert.equal(Object.isFrozen(WEIGHTS), true);
  closeTo(Object.values(WEIGHTS).reduce((sum, value) => sum + value, 0), 1, 1e-12);
});

test('calculates 78 for D=80, R=80, C=70, I=80', () => {
  closeTo(calculateTrustScore(fixture()).score, 78);
});

test('calculates 72.334 for D=70, R=75, C=66.67, I=80', () => {
  closeTo(calculateTrustScore(fixture({ delivery: 70, recall: 75, complaint: 66.67, inspection: 80 })).score, 72.334);
});

test('all unavailable indicators return NOT_ASSESSABLE without a partial score', () => {
  const result = calculateTrustScore(fixture({ delivery: null, recall: null, complaint: null, inspection: null }));
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.equal(result.missingIndicators.length, 4);
  assert.ok(result.missingIndicators.every(item => item.reason.length > 0));
  assert.ok(Object.values(result.breakdown).every(item => item.weightedContribution === null));
});

test('one unavailable indicator prevents aggregation and names that indicator', () => {
  const result = calculateTrustScore(fixture({ delivery: 80, recall: null, complaint: 70, inspection: 80 }));
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.deepEqual(result.missingIndicators.map(item => item.name), ['recall']);
  assert.equal(result.breakdown.delivery.weightedContribution, 28);
  assert.equal(result.breakdown.recall.weightedContribution, null);
});

test('a legitimate zero remains assessable and distinct from unavailable evidence', () => {
  const assessed = calculateTrustScore(fixture({ delivery: 0, recall: 80, complaint: 70, inspection: 80 }));
  const unavailable = calculateTrustScore(fixture({ delivery: null, recall: 80, complaint: 70, inspection: 80 }));
  assert.equal(assessed.status, 'ASSESSABLE');
  assert.equal(assessed.breakdown.delivery.value, 0);
  assert.equal(assessed.breakdown.delivery.weightedContribution, 0);
  assert.equal(unavailable.status, 'NOT_ASSESSABLE');
  assert.equal(unavailable.breakdown.delivery.value, null);
});

test('rejects scores outside the inclusive 0 to 100 range', () => {
  for (const value of [-0.01, 100.01]) {
    assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'ASSESSABLE', value, evidenceCount: 1, source: 'SYNTHETIC' } })), /between 0 and 100/);
  }
});

test('rejects non-finite, non-numeric, and other invalid scores', () => {
  for (const value of [NaN, Infinity, -Infinity, '80', true, {}, undefined]) {
    assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'ASSESSABLE', value, evidenceCount: 1, source: 'SYNTHETIC' } })), /numeric value|finite number/);
  }
});

test('assessable indicators require an own value property', () => {
  const indicator = { status: 'ASSESSABLE', evidenceCount: 1, source: 'SYNTHETIC' };
  assert.throws(() => calculateTrustScore(withOverrides({ delivery: indicator })), /requires a numeric value/);
});

test('assessable indicators reject null values and missing required metadata', () => {
  assert.throws(() => calculateTrustScore(withOverrides({
    delivery: { status: 'ASSESSABLE', value: null, evidenceCount: 1, source: 'SYNTHETIC' },
  })), /finite number/);
  assert.throws(() => calculateTrustScore(withOverrides({
    delivery: { status: 'ASSESSABLE', value: 80, source: 'SYNTHETIC' },
  })), /requires "evidenceCount"/);
  assert.throws(() => calculateTrustScore(withOverrides({
    delivery: { status: 'ASSESSABLE', value: 80, evidenceCount: 1 },
  })), /requires "source"/);
});

test('not-assessable indicators reject an explicitly present value, including null', () => {
  for (const value of [null, undefined, 0]) {
    const indicator = { status: 'NOT_ASSESSABLE', evidenceCount: 0, source: 'SYNTHETIC', value };
    assert.throws(() => calculateTrustScore(withOverrides({ delivery: indicator })), /must not contain a value property/);
  }
});

test('rejects unknown status, source, and unexpected indicator fields', () => {
  assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'UNKNOWN', value: 1, evidenceCount: 1, source: 'SYNTHETIC' } })), /status must be/);
  assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'ASSESSABLE', value: 1, evidenceCount: 1, source: 'OTHER' } })), /source must be/);
  assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'ASSESSABLE', value: 1, evidenceCount: 1, source: 'SYNTHETIC', extra: true } })), /unsupported property/);
});

test('evidenceCount must be a non-negative integer', () => {
  for (const evidenceCount of [-1, 0.5, NaN, Infinity, '1']) {
    assert.throws(() => calculateTrustScore(withOverrides({ delivery: { status: 'ASSESSABLE', value: 50, evidenceCount, source: 'SYNTHETIC' } })), /evidenceCount must be an integer/);
  }
});

test('all four indicator objects are required and must be plain objects', () => {
  const missing = fixture();
  delete missing.inspection;
  assert.throws(() => calculateTrustScore(missing), /requires indicator "inspection"/);
  assert.throws(() => calculateTrustScore(withOverrides({ delivery: null })), /must be a plain object/);
  assert.throws(() => calculateTrustScore({ ...fixture(), unexpected: true }), /unsupported property/);
});

test('critical findings remain escalated with a high aggregate score', () => {
  const result = calculateTrustScore({ ...fixture({ delivery: 100, recall: 100, complaint: 100, inspection: 100 }), criticalFindings: [{ id: 'CRIT-1', description: 'Synthetic test finding' }] });
  assert.equal(result.score, 100);
  assert.equal(result.criticalEscalation.required, true);
  assert.equal(result.criticalEscalation.findings[0].id, 'CRIT-1');
});

test('critical findings remain escalated when the aggregate is not assessable', () => {
  const result = calculateTrustScore({ ...fixture({ delivery: null, recall: 90, complaint: 90, inspection: 90 }), criticalFindings: [{ id: 'CRIT-2', description: 'Synthetic finding' }] });
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.criticalEscalation.required, true);
});

test('rejects invalid criticalFindings and malformed finding objects', () => {
  for (const criticalFindings of [null, {}, 'finding', [null], [{}], [{ id: '  ', description: 'x' }], [{ id: 'x', description: '  ' }], [{ id: 3, description: 'x' }]]) {
    assert.throws(() => calculateTrustScore({ ...fixture(), criticalFindings }), /criticalFindings|Critical finding/);
  }
  assert.throws(() => calculateTrustScore({ ...fixture(), criticalFindings: [{ id: 'x', description: 'ok', detail: new Date() }] }), /plain objects and arrays/);
});

test('classifies evidence sources as all synthetic, all real, or mixed', () => {
  assert.equal(calculateTrustScore(fixture()).evidenceSource, 'SYNTHETIC');
  assert.equal(calculateTrustScore(fixture(undefined, 'REAL')).evidenceSource, 'REAL');
  const mixed = fixture();
  mixed.inspection = { ...mixed.inspection, source: 'REAL' };
  assert.equal(calculateTrustScore(mixed).evidenceSource, 'MIXED');
});

test('classifyTier uses the specified inclusive boundaries', () => {
  const cases = [[80, 'HIGHLY_TRUSTED'], [79.99, 'TRUSTED'], [60, 'TRUSTED'], [59.99, 'UNDER_REVIEW'], [40, 'UNDER_REVIEW'], [39.99, 'ESCALATION_ALERT'], [null, 'NOT_ASSESSABLE']];
  for (const [score, expected] of cases) assert.equal(classifyTier(score), expected);
});

test('classifyTier rejects invalid scores', () => {
  for (const score of [undefined, NaN, Infinity, -Infinity, '80', true, -1, 100.01]) {
    assert.throws(() => classifyTier(score), /finite number between 0 and 100/);
  }
});

test('calculation does not mutate caller inputs and repeated calls are equivalent', () => {
  const input = { ...fixture(), criticalFindings: [{ id: 'C-1', description: 'Synthetic', details: { tags: ['review'] } }] };
  const before = JSON.stringify(input);
  const first = calculateTrustScore(input);
  const second = calculateTrustScore(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first, second);
});

test('returned breakdown and findings are defensive copies', () => {
  const input = { ...fixture(), criticalFindings: [{ id: 'C-1', description: 'Synthetic', details: { tags: ['review'] } }] };
  const result = calculateTrustScore(input);
  result.breakdown.delivery.weight = 99;
  result.criticalEscalation.findings[0].details.tags.push('changed');
  assert.equal(WEIGHTS.delivery, 0.35);
  assert.equal(input.criticalFindings[0].details.tags.length, 1);
  assert.equal(Object.isFrozen(WEIGHTS), true);
});

test('critical finding nested JSON data is preserved as a defensive copy', () => {
  const finding = { id: 'C-TEST', description: 'Synthetic test finding', details: { tags: ['review'] } };
  const input = { ...fixture(), criticalFindings: [finding] };
  const result = calculateTrustScore(input);
  const returnedFinding = result.criticalEscalation.findings[0];

  assert.deepEqual(returnedFinding, finding);
  assert.notStrictEqual(returnedFinding, finding);
  assert.notStrictEqual(returnedFinding.details, finding.details);
  assert.notStrictEqual(returnedFinding.details.tags, finding.details.tags);

  returnedFinding.details.tags.push('changed');
  assert.deepEqual(finding.details.tags, ['review']);
  assert.deepEqual(WEIGHTS, { delivery: 0.35, recall: 0.30, complaint: 0.20, inspection: 0.15 });
});

test('omitted or undefined criticalFindings defaults to an empty list', () => {
  assert.deepEqual(calculateTrustScore(fixture()).criticalEscalation, { required: false, findings: [] });
  assert.deepEqual(calculateTrustScore({ ...fixture(), criticalFindings: undefined }).criticalEscalation, { required: false, findings: [] });
});
