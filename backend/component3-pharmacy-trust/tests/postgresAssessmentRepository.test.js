'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresAssessmentRepository } = require('../services/postgresAssessmentRepository');
const { createAssessmentService } = require('../services/assessmentService');
const { createPostgresServer, parsePort, DEFAULT_PORT, HOST, createPostgresRuntime } = require('../run-postgres');

const PHARMACY = { id: 'pharmacy-uuid-1', pharmacy_code: 'C3-PHARM-001' };
const ASSESSMENT = { id: 'assessment-uuid-1', critical_escalation_required: true, evidence_source: 'SYNTHETIC' };

function mockPool({ pharmacies = [PHARMACY], assessments = [ASSESSMENT], indicators = [], evidence = [], errorAt } = {}) {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.startsWith('BEGIN')) return { rows: [] };
      if (text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (errorAt && text.includes(errorAt)) throw new Error('synthetic database failure');
      if (text.includes('FROM pharmacy_trust.pharmacies')) return { rows: pharmacies };
      if (text.includes('FROM pharmacy_trust.trust_assessments')) return { rows: assessments };
      if (text.includes('FROM pharmacy_trust.indicator_scores')) return { rows: indicators };
      if (text.includes('FROM pharmacy_trust.assessment_evidence')) return { rows: evidence };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() { calls.push({ release: true }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

function allIndicatorRows() {
  return ['DELIVERY', 'RECALL', 'COMPLAINT', 'INSPECTION'].map(indicator_type => ({
    indicator_type,
    indicator_status: 'ASSESSABLE',
    indicator_score: '99.99',
    weight: '0.2500',
    weighted_contribution: '24.998',
    evidence_count: 17,
  }));
}

function evidenceRow(overrides = {}) {
  return {
    evidence_id: 'evidence-uuid-1',
    pharmacy_id: PHARMACY.id,
    indicator_type: 'DELIVERY',
    event_type: 'transfer-confirmed',
    source_type: 'VERIFIED_REAL',
    source_system: 'component1',
    source_reference: 'source-ref-1',
    event_timestamp: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('uses parameterized SELECTs and maps records without trusting stored scores or verification labels', async () => {
  const { pool, calls } = mockPool({ indicators: allIndicatorRows(), evidence: [evidenceRow()] });
  const repository = createPostgresAssessmentRepository({ pool });
  const record = await repository.readPharmacyAssessment(PHARMACY.pharmacy_code);

  assert.equal(record.pharmacyId, PHARMACY.pharmacy_code);
  assert.deepEqual(record.criticalFindings, []);
  assert.equal(record.criticalEscalationRequired, true);
  assert.deepEqual(Object.keys(record.assessments).sort(), ['complaint', 'delivery', 'inspection', 'recall']);
  assert.equal(record.assessments.delivery.indicator.status, 'NOT_ASSESSABLE');
  assert.equal(Object.hasOwn(record.assessments.delivery.indicator, 'value'), false);
  assert.equal(record.assessments.delivery.indicator.evidenceCount, 0);
  assert.equal(record.assessments.delivery.evidenceIds[0], 'evidence-uuid-1');
  assert.equal(record.evidence[0].provenance, 'UNKNOWN');
  assert.equal(Object.hasOwn(record.evidence[0], 'metadata'), false);

  const selects = calls.filter(call => call.text?.trimStart().startsWith('SELECT'));
  assert.equal(selects.length, 4);
  assert.ok(selects.every(call => !call.text.includes(PHARMACY.pharmacy_code)));
  assert.ok(selects.some(call => call.values[0] === PHARMACY.pharmacy_code));
  assert.ok(selects.every(call => !/\b(overall_score|trust_tier|indicator_score|weighted_contribution|evidence_summary|payload)\b/i.test(call.text)));
  assert.ok(calls.some(call => call.text === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(calls.some(call => call.text === 'COMMIT'));

  const service = createAssessmentService({ readPharmacyAssessment: repository.readPharmacyAssessment });
  const result = await service.getAssessment(PHARMACY.pharmacy_code);
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.equal(result.criticalEscalation.required, true);
  assert.deepEqual(result.criticalEscalation.findings, []);
  assert.match(result.limitations.join(' '), /no critical-finding details/i);
});

test('unknown pharmacy returns null without querying assessment or child tables', async () => {
  const { pool, calls } = mockPool({ pharmacies: [] });
  const repository = createPostgresAssessmentRepository({ pool });
  assert.equal(await repository.readPharmacyAssessment('UNKNOWN'), null);
  assert.equal(calls.filter(call => call.text?.trimStart().startsWith('SELECT')).length, 1);
  assert.ok(calls.some(call => call.text === 'COMMIT'));
});

test('missing evidence links yield no fabricated envelopes or assessable indicators', async () => {
  const { pool } = mockPool({ indicators: allIndicatorRows(), evidence: [] });
  const repository = createPostgresAssessmentRepository({ pool });
  const record = await repository.readPharmacyAssessment(PHARMACY.pharmacy_code);
  assert.deepEqual(record.evidence, []);
  for (const assessment of Object.values(record.assessments)) {
    assert.equal(assessment.indicator.status, 'NOT_ASSESSABLE');
    assert.equal(assessment.indicator.evidenceCount, 0);
    assert.deepEqual(assessment.evidenceIds, []);
  }
});

test('linked synthetic evidence remains insufficient without raw inputs and approved policy', async () => {
  const { pool } = mockPool({
    indicators: allIndicatorRows(),
    evidence: [evidenceRow({ source_type: 'SYNTHETIC' })],
  });
  const repository = createPostgresAssessmentRepository({ pool });
  const service = createAssessmentService({ readPharmacyAssessment: repository.readPharmacyAssessment });
  const result = await service.getAssessment(PHARMACY.pharmacy_code);
  assert.equal(result.evidenceValidation.status, 'USABLE');
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.equal(result.indicatorEvidence.delivery.status, 'INSUFFICIENT');
});

test('database errors roll back and release the checked-out client', async () => {
  const { pool, calls } = mockPool({ errorAt: 'FROM pharmacy_trust.indicator_scores' });
  const repository = createPostgresAssessmentRepository({ pool });
  await assert.rejects(repository.readPharmacyAssessment(PHARMACY.pharmacy_code), /synthetic database failure/);
  assert.ok(calls.some(call => call.text === 'ROLLBACK'));
  assert.ok(calls.some(call => call.release));
});

test('runtime validates local port and fails closed before creating a pool without auth configuration', () => {
  assert.equal(HOST, '127.0.0.1');
  assert.equal(DEFAULT_PORT, 5004);
  assert.equal(parsePort(undefined), DEFAULT_PORT);
  assert.equal(parsePort('5124'), 5124);
  for (const port of ['0', '-1', '65536', 'abc']) assert.throws(() => parsePort(port), /COMPONENT3_PORT/);

  let poolCreated = false;
  class MockPool { constructor() { poolCreated = true; } }
  assert.throws(() => createPostgresRuntime({
    env: { DATABASE_URL: 'postgres://test', COMPONENT3_PORT: '5004' },
    PoolClass: MockPool,
  }), /COMPONENT3_AUTH_MODULE/);
  assert.equal(poolCreated, false);
});

test('database server factory keeps injected authentication and authorization dependencies', () => {
  const { pool } = mockPool();
  const server = createPostgresServer({
    pool,
    authenticate: async () => null,
    authorizePharmacy: async () => false,
  });
  assert.equal(typeof server.listen, 'function');
});
