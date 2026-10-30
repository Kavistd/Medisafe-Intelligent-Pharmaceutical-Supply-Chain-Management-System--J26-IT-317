'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { calculateTrustScore, classifyTier } = require('../services/trustScore');
const { buildAnchorPayload, canonicalize } = require('../services/anchorPayload');

// Synthetic fixtures only; not real pharmacy data.
function assessmentFor(values, { pharmacyId = 'C3-TEST-001', findings = [] } = {}) {
  const input = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value === null
    ? { status: 'NOT_ASSESSABLE', evidenceCount: 0, source: 'SYNTHETIC' }
    : { status: 'ASSESSABLE', value, evidenceCount: 1, source: 'SYNTHETIC' }]));
  const result = calculateTrustScore({ ...input, criticalFindings: findings });
  return {
    pharmacyId,
    demoLabel: 'LOCAL_SYNTHETIC_DEMO',
    blockchainVerification: 'NOT_PERFORMED',
    status: result.status,
    score: result.score,
    tier: classifyTier(result.score),
    breakdown: result.breakdown,
    missingIndicators: result.missingIndicators,
    evidenceSource: result.evidenceSource,
    criticalEscalation: result.criticalEscalation,
  };
}

const SPEC = { delivery: 70, recall: 75, complaint: 66.67, inspection: 80 };
const finding = { id: 'SYN-CF-1', description: 'Synthetic critical finding.', source: 'SYNTHETIC_TEST_DATA' };

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])]));
  }
  return value;
}

test('encodes 72.334 as 72334 while the committed score stays unrounded', () => {
  const assessment = assessmentFor(SPEC);
  assert.equal(assessment.tier, 'TRUSTED');
  const payload = buildAnchorPayload(assessment, 'C3-TEST-001');
  assert.equal(payload.scoreMilli, 72334);
  assert.equal(payload.status, 'ASSESSABLE');
  assert.equal(payload.pharmacyKeyInput, 'C3-TEST-001');
  assert.equal(JSON.parse(payload.canonicalJson).score, assessment.score);
});

test('is deterministic and the hash is sha256 of the canonical JSON', () => {
  const first = buildAnchorPayload(assessmentFor(SPEC), 'C3-TEST-001');
  const second = buildAnchorPayload(assessmentFor(SPEC), 'C3-TEST-001');
  assert.deepEqual(first, second);
  assert.match(first.assessmentHash, /^0x[0-9a-f]{64}$/);
  assert.equal(first.assessmentHash, `0x${createHash('sha256').update(first.canonicalJson, 'utf8').digest('hex')}`);
});

test('is independent of input key order', () => {
  const assessment = assessmentFor(SPEC);
  const reordered = reverseKeys(assessment);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(assessment));
  assert.deepEqual(buildAnchorPayload(reordered, 'C3-TEST-001'), buildAnchorPayload(assessment, 'C3-TEST-001'));
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('different assessment content produces a different hash', () => {
  const base = buildAnchorPayload(assessmentFor(SPEC), 'C3-TEST-001');
  const changed = buildAnchorPayload(assessmentFor({ ...SPEC, recall: 76 }), 'C3-TEST-001');
  assert.notEqual(changed.assessmentHash, base.assessmentHash);
});

test('NOT_ASSESSABLE produces scoreMilli null and commits no score or tier', () => {
  const assessment = assessmentFor({ ...SPEC, recall: null });
  const payload = buildAnchorPayload(assessment, 'C3-TEST-001');
  assert.equal(payload.status, 'NOT_ASSESSABLE');
  assert.equal(payload.scoreMilli, null);
  const committed = JSON.parse(payload.canonicalJson);
  assert.equal(committed.score, null);
  assert.equal(committed.tier, 'NOT_ASSESSABLE');
  assert.deepEqual(committed.missingIndicators, ['recall']);
});

test('a score of 0 is ASSESSABLE and encodes as 0, not null', () => {
  const payload = buildAnchorPayload(assessmentFor({ delivery: 0, recall: 0, complaint: 0, inspection: 0 }), 'C3-TEST-001');
  assert.equal(payload.status, 'ASSESSABLE');
  assert.equal(payload.scoreMilli, 0);
  assert.equal(JSON.parse(payload.canonicalJson).tier, 'ESCALATION_ALERT');
});

test('carries the critical escalation flag from either result shape', () => {
  const withFinding = assessmentFor({ delivery: 100, recall: 90, complaint: 90, inspection: 90 }, { findings: [finding] });
  const payload = buildAnchorPayload(withFinding, 'C3-TEST-001');
  assert.equal(payload.criticalEscalationRequired, true);
  assert.equal(payload.scoreMilli, 93500);
  assert.deepEqual(JSON.parse(payload.canonicalJson).criticalFindingIds, ['SYN-CF-1']);

  const apiShape = { pharmacyId: 'C3-TEST-001', status: 'ASSESSABLE', score: 93.5, tier: 'HIGHLY_TRUSTED', criticalEscalationRequired: true };
  assert.equal(buildAnchorPayload(apiShape, 'C3-TEST-001').criticalEscalationRequired, true);
  assert.equal(buildAnchorPayload(assessmentFor(SPEC), 'C3-TEST-001').criticalEscalationRequired, false);
  assert.throws(() => buildAnchorPayload({ ...apiShape, criticalEscalationRequired: 'yes' }, 'C3-TEST-001'), /boolean/);
});

test('does not mutate its input or change blockchainVerification', () => {
  const assessment = assessmentFor(SPEC, { findings: [finding] });
  const snapshot = structuredClone(assessment);
  const payload = buildAnchorPayload(assessment, 'C3-TEST-001');
  assert.deepEqual(assessment, snapshot);
  assert.equal(assessment.blockchainVerification, 'NOT_PERFORMED');
  assert.equal(Object.hasOwn(payload, 'blockchainVerification'), false);
  assert.deepEqual(Object.keys(payload).sort(),
    ['assessmentHash', 'canonicalJson', 'criticalEscalationRequired', 'pharmacyKeyInput', 'scoreMilli', 'status']);
});

test('refuses rounding that would move a score across a tier boundary', () => {
  const nearBoundary = { pharmacyId: 'C3-TEST-001', status: 'ASSESSABLE', score: 79.9996, tier: 'TRUSTED', criticalEscalationRequired: false };
  assert.throws(() => buildAnchorPayload(nearBoundary, 'C3-TEST-001'), /would change its tier/);
  const exact = buildAnchorPayload({ ...nearBoundary, score: 80, tier: 'HIGHLY_TRUSTED' }, 'C3-TEST-001');
  assert.equal(exact.scoreMilli, 80000);
});

test('rejects inconsistent or malformed assessments', () => {
  const valid = { pharmacyId: 'C3-TEST-001', status: 'ASSESSABLE', score: 72.334, tier: 'TRUSTED', criticalEscalationRequired: false };
  assert.throws(() => buildAnchorPayload(valid, 'OTHER-CODE'), /does not match/);
  assert.throws(() => buildAnchorPayload(valid, ' C3-TEST-001'), /pharmacyCode/);
  assert.throws(() => buildAnchorPayload({ ...valid, tier: 'HIGHLY_TRUSTED' }, 'C3-TEST-001'), /tier does not match/);
  assert.throws(() => buildAnchorPayload({ ...valid, score: 100.5 }, 'C3-TEST-001'), /between 0 and 100/);
  assert.throws(() => buildAnchorPayload({ ...valid, status: 'NOT_ASSESSABLE' }, 'C3-TEST-001'), /must not carry a score/);
  assert.throws(() => buildAnchorPayload({ ...valid, status: 'UNKNOWN' }, 'C3-TEST-001'), /status/);
  assert.throws(() => buildAnchorPayload(null, 'C3-TEST-001'), /plain object/);
});
