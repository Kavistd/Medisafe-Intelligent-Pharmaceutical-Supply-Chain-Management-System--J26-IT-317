'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessDeliveryReliability } = require('../services/indicatorScoring');
const {
  CLASSIFICATION,
  normalizeEvidence,
  validateEvidence,
  validateEvidenceSet,
  classifyEvidenceSufficiency,
  toIndicatorEvidenceMetadata,
} = require('../services/evidenceValidation');

function synthetic(overrides = {}) {
  return {
    evidenceId: 'SYN-D-001',
    pharmacyId: 'PHARMACY-001',
    indicator: 'delivery',
    eventType: 'transfer-confirmed',
    eventTimestamp: '2026-04-03T10:00:00+05:30',
    source: { system: 'synthetic-fixture', reference: 'fixture-001' },
    provenance: 'SYNTHETIC',
    metadata: { batchId: 'SYN-BATCH-1', labels: ['prototype'] },
    ...overrides,
  };
}

test('normalizes a valid envelope and its timestamp deterministically', () => {
  const input = synthetic();
  const first = normalizeEvidence(input);
  assert.deepEqual(first, normalizeEvidence(input));
  assert.equal(first.eventTimestamp, '2026-04-03T04:30:00.000Z');
  assert.deepEqual(first.source, input.source);
  assert.notStrictEqual(first.metadata, input.metadata);
  assert.notStrictEqual(first.metadata.labels, input.metadata.labels);
});

test('rejects malformed objects, missing and malformed identifiers, and unsupported fields', () => {
  assert.throws(() => normalizeEvidence(null), /plain object/);
  for (const field of ['evidenceId', 'pharmacyId', 'indicator', 'eventType']) {
    const missing = synthetic();
    delete missing[field];
    assert.throws(() => normalizeEvidence(missing), new RegExp(`requires "${field}"`));
    assert.throws(() => normalizeEvidence(synthetic({ [field]: '  ' })), /non-empty string/);
  }
  assert.throws(() => normalizeEvidence(synthetic({ pharmacyId: 42 })), /pharmacyId must be/);
  assert.throws(() => normalizeEvidence(synthetic({ indicator: 'wallet' })), /indicator must be/);
  assert.throws(() => normalizeEvidence({ ...synthetic(), unexpected: true }), /unsupported property/);
});

test('rejects invalid timestamps and requires an explicit timezone', () => {
  for (const eventTimestamp of ['not-a-date', '2026-03-01T10:00:00', '2026-02-30T10:00:00Z']) {
    assert.throws(() => normalizeEvidence(synthetic({ eventTimestamp })), /ISO 8601 timestamp/);
  }
});

test('classifies synthetic, declared-real, and unknown provenance distinctly', () => {
  assert.equal(validateEvidence(synthetic()).status, CLASSIFICATION.USABLE);
  const declared = validateEvidence(synthetic({
    provenance: 'DECLARED_REAL',
    source: { system: 'named-register', reference: 'record-123' },
  }));
  assert.equal(declared.status, CLASSIFICATION.REQUIRES_VERIFICATION);
  assert.match(declared.reason, /declaration/);
  assert.equal(validateEvidence(synthetic({ provenance: 'UNKNOWN' })).status, CLASSIFICATION.REQUIRES_VERIFICATION);
  assert.throws(() => normalizeEvidence(synthetic({ provenance: 'REAL' })), /provenance must be/);
  assert.throws(() => normalizeEvidence(synthetic({ provenance: 'DECLARED_REAL', source: { system: 'register' } })), /source reference/);
});

test('deduplicates identical records and reports same-ID conflicts without merging', () => {
  const original = synthetic();
  const duplicate = { ...synthetic(), metadata: { labels: ['prototype'], batchId: 'SYN-BATCH-1' } };
  const conflict = synthetic({ eventType: 'transfer-cancelled' });
  const result = validateEvidenceSet([original, duplicate, conflict]);
  assert.equal(result.status, CLASSIFICATION.INVALID);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.duplicates, [{ evidenceId: 'SYN-D-001', index: 1, duplicateOf: 0 }]);
  assert.deepEqual(result.conflicts, [{ evidenceId: 'SYN-D-001', index: 2, conflictsWith: 0 }]);
});

test('keeps pharmacies and indicators separate, and input objects unchanged', () => {
  const records = [
    synthetic(),
    synthetic({ evidenceId: 'SYN-R-002', pharmacyId: 'PHARMACY-002', indicator: 'recall', eventType: 'notice-acknowledged' }),
  ];
  const before = JSON.stringify(records);
  const first = validateEvidenceSet(records);
  const second = validateEvidenceSet(records);
  assert.deepEqual(first, second);
  assert.equal(first.evidence.length, 2);
  assert.deepEqual(first.evidence.map(item => [item.pharmacyId, item.indicator]), [
    ['PHARMACY-001', 'delivery'], ['PHARMACY-002', 'recall'],
  ]);
  first.evidence[0].metadata.labels.push('local-change');
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(validateEvidenceSet(records), second);
});

test('reports malformed entries as invalid and empty evidence as insufficient', () => {
  assert.equal(validateEvidenceSet([]).status, CLASSIFICATION.INSUFFICIENT);
  const invalid = validateEvidenceSet([synthetic(), { evidenceId: '' }]);
  assert.equal(invalid.status, CLASSIFICATION.INVALID);
  assert.equal(invalid.invalid.length, 1);
  assert.equal(classifyEvidenceSufficiency([]).status, CLASSIFICATION.INSUFFICIENT);
});

test('structural usability does not invent a score or claim policy sufficiency', () => {
  const classification = classifyEvidenceSufficiency([synthetic()]);
  assert.equal(classification.status, CLASSIFICATION.USABLE);
  assert.equal(classification.evidenceCount, 1);
  assert.match(classification.reason, /approved policy/);
  assert.equal(Object.hasOwn(classification, 'score'), false);
});

test('exports only synthetic metadata in the existing indicator evidence contract', () => {
  const metadata = toIndicatorEvidenceMetadata([synthetic()]);
  assert.deepEqual(metadata, { evidenceIds: ['SYN-D-001'], source: 'SYNTHETIC' });
  const assessment = assessDeliveryReliability({
    onTimeCount: 1,
    eligibleCommitmentCount: metadata.evidenceIds.length,
    ...metadata,
    policy: { id: 'synthetic-test-only', approved: false },
  });
  assert.equal(assessment.indicator.status, 'NOT_ASSESSABLE');
  assert.equal(Object.hasOwn(assessment.indicator, 'value'), false);
  assert.throws(() => toIndicatorEvidenceMetadata([synthetic({ provenance: 'DECLARED_REAL', source: { system: 'registry', reference: 'r-1' } })]), /cannot be prepared/);
});

test('preserves declared source and pharmacy identifiers without treating them as wallets', () => {
  const record = normalizeEvidence(synthetic({
    pharmacyId: 'registry-pharmacy-9',
    provenance: 'DECLARED_REAL',
    source: { system: 'inspection-register', reference: 'case-9' },
  }));
  assert.equal(record.pharmacyId, 'registry-pharmacy-9');
  assert.equal(record.source.reference, 'case-9');
  assert.equal(Object.hasOwn(record, 'walletAddress'), false);
});
