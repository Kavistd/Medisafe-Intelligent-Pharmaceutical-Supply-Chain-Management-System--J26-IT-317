
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvidence } = require('../services/evidenceValidation');
const { adaptComponent1Evidence } = require('../services/component1EvidenceAdapter');

const pharmacyWallet = '0x2222222222222222222222222222222222222222';
const manufacturer = '0x1111111111111111111111111111111111111111';
const batchKey = `0x${'a'.repeat(64)}`;

function transfer(overrides = {}) {
  return { id: '1', from: manufacturer, to: pharmacyWallet, stage: '2', initiatedAt: '100', confirmedAt: '110', ...overrides };
}
function input(overrides = {}) {
  return { batchId: 'BATCH-1', transferHistory: [transfer()], recallEvents: [], ...overrides };
}
function pharmacyIdentity() {
  return { pharmacyId: 'PHARMACY-ABC', participantAddress: pharmacyWallet };
}

test('maps supported completed transfer fields without treating timestamps as deadlines', () => {
  const result = adaptComponent1Evidence(input({ pharmacyIdentity: pharmacyIdentity() }));
  const record = result.transferHistory.records[0];
  assert.equal(record.fact.transferId, '1');
  assert.equal(record.fact.from, manufacturer);
  assert.equal(record.fact.to, pharmacyWallet);
  assert.equal(record.fact.stage, '2');
  assert.equal(record.fact.initiatedAtSeconds, '100');
  assert.equal(record.fact.confirmedAtSeconds, '110');
  assert.equal(record.evidence.eventTimestamp, '1970-01-01T00:01:50.000Z');
  assert.equal(record.evidence.pharmacyId, 'PHARMACY-ABC');
  assert.equal(result.delivery.status, 'INSUFFICIENT');
  assert.equal(result.delivery.score, null);
  assert.match(result.delivery.reason, /expected-delivery deadline/);
});

test('does not invent pharmacy attribution when only participant addresses exist', () => {
  const result = adaptComponent1Evidence(input());
  const record = result.transferHistory.records[0];
  assert.equal(record.status, 'INSUFFICIENT');
  assert.equal(record.evidence, null);
  assert.equal(record.fact.to, pharmacyWallet);
  assert.match(record.reason, /identity mapping/);
});

test('batch recall events preserve their actual contract arguments but imply no pharmacy response', () => {
  const event = { batchKey, batchId: 'BATCH-1', actor: manufacturer, reason: 'Synthetic test recall' };
  const result = adaptComponent1Evidence(input({ recallEvents: [event] }));
  assert.deepEqual(result.recallEvents.events[0], { ...event, eventReference: null, eventTimestamp: null, pharmacyEvidence: null });
  assert.equal(result.recallResponse.status, 'INSUFFICIENT');
  assert.equal(result.recallResponse.score, null);
  assert.match(result.recallResponse.reason, /no pharmacy recipient/);
});

test('complaint and inspection evidence are explicitly unavailable from Component 1', () => {
  const result = adaptComponent1Evidence(input());
  assert.equal(result.complaint.status, 'INSUFFICIENT');
  assert.match(result.complaint.reason, /no complaint evidence/);
  assert.equal(result.inspection.status, 'INSUFFICIENT');
  assert.match(result.inspection.reason, /no inspection evidence/);
});

test('malformed transfer and recall inputs are reported explicitly', () => {
  const result = adaptComponent1Evidence(input({
    transferHistory: [transfer({ stage: 'PHARMACY' }), { id: '2' }],
    recallEvents: [{ batchKey, batchId: 'OTHER', actor: manufacturer, reason: 'Wrong batch' }, { batchId: 'BATCH-1', actor: manufacturer }],
  }));
  assert.equal(result.transferHistory.invalid.length, 2);
  assert.match(result.transferHistory.invalid[0].reason, /stage/);
  assert.equal(result.recallEvents.invalid.length, 2);
  assert.match(result.recallEvents.invalid[0].reason, /does not match/);
  assert.match(result.recallEvents.invalid[1].reason, /requires "batchKey"/);
  assert.throws(() => adaptComponent1Evidence({ ...input(), unsupported: true }), /unsupported field/);
});

test('duplicate identical transfers collapse; conflicting source records remain conflicts', () => {
  const result = adaptComponent1Evidence(input({
    pharmacyIdentity: pharmacyIdentity(),
    transferHistory: [transfer(), transfer(), transfer({ confirmedAt: '111' })],
  }));
  assert.equal(result.transferHistory.evidenceValidation.evidence.length, 1);
  assert.equal(result.transferHistory.evidenceValidation.duplicates.length, 1);
  assert.equal(result.transferHistory.evidenceValidation.conflicts.length, 1);
  assert.deepEqual(result.transferHistory.records.map(record => record.candidateHandling.status), [
    'REQUIRES_VERIFICATION', 'DUPLICATE', 'CONFLICT',
  ]);
});

test('preserves source identifiers and declared provenance without claiming chain verification', () => {
  const result = adaptComponent1Evidence(input({ pharmacyIdentity: pharmacyIdentity() }));
  const evidence = result.transferHistory.records[0].evidence;
  assert.equal(evidence.evidenceId, 'component1-history:BATCH-1:transfer:1');
  assert.equal(evidence.source.system, 'component1-traceability-api');
  assert.equal(evidence.source.reference, evidence.evidenceId);
  assert.equal(evidence.provenance, 'DECLARED_REAL');
  assert.equal(evidence.metadata.batchId, 'BATCH-1');
  assert.equal(evidence.metadata.transferId, '1');
  assert.equal(evidence.metadata.sourceEventReference, null);
  assert.equal(result.blockchainVerification, 'NOT_PERFORMED');
  assert.equal(Object.hasOwn(result, 'verifiedOnChain'), false);
});

test('does not mutate input and produces deterministic output', () => {
  const original = input({
    pharmacyIdentity: pharmacyIdentity(),
    recallEvents: [{ batchKey, batchId: 'BATCH-1', actor: manufacturer, reason: 'Synthetic test recall' }],
  });
  const before = JSON.stringify(original);
  const first = adaptComponent1Evidence(original);
  assert.deepEqual(adaptComponent1Evidence(original), first);
  assert.equal(JSON.stringify(original), before);
});

test('mapped transfer candidates use the existing evidence-validation envelope', () => {
  const result = adaptComponent1Evidence(input({ pharmacyIdentity: pharmacyIdentity() }));
  const evidence = result.transferHistory.records[0].evidence;
  assert.equal(normalizeEvidence(evidence).provenance, 'DECLARED_REAL');
  assert.equal(result.transferHistory.evidenceValidation.status, 'REQUIRES_VERIFICATION');
});

test('recall event deduplication is stable and conflicting batch events are surfaced', () => {
  const same = { batchKey, batchId: 'BATCH-1', actor: manufacturer, reason: 'Recall' };
  const different = { ...same, reason: 'Corrected reason' };
  const result = adaptComponent1Evidence(input({ recallEvents: [same, { ...same }, different] }));
  assert.deepEqual(result.recallEvents.duplicates, [{ batchId: 'BATCH-1', index: 1, duplicateOf: 0 }]);
  assert.deepEqual(result.recallEvents.conflicts, [{ batchId: 'BATCH-1', index: 2, conflictsWith: 0 }]);
  assert.equal(result.recallEvents.events.length, 1);
});
