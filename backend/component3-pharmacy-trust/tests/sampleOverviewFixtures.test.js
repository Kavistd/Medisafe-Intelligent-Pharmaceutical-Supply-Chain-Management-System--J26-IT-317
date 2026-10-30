'use strict';

// Sample-mode fixtures only; all data is simulated (SYNTHETIC / LOCAL_SYNTHETIC_DEMO).
const test = require('node:test');
const assert = require('node:assert/strict');
const { WEIGHTS } = require('../services/trustScore');
const { createAssessmentService } = require('../services/assessmentService');
const { SAMPLE_PHARMACIES } = require('../sampleOverviewFixtures');
const { createDemoFixtures, listDemoPharmacies, DEMO_IDS, DEMO_LABEL } = require('../run-local');

async function assessAll() {
  const fixtures = createDemoFixtures();
  const service = createAssessmentService({ readPharmacyAssessment: async id => fixtures.get(id) || null });
  const results = new Map();
  for (const id of fixtures.keys()) results.set(id, await service.getAssessment(id));
  return { fixtures, results };
}

test('sample mode covers every tier plus NOT_ASSESSABLE', async () => {
  const { results } = await assessAll();
  assert.equal(results.size, 2 + SAMPLE_PHARMACIES.length);
  const tiers = new Set([...results.values()].map(item => item.tier));
  for (const tier of ['HIGHLY_TRUSTED', 'TRUSTED', 'UNDER_REVIEW', 'ESCALATION_ALERT', 'NOT_ASSESSABLE']) {
    assert.ok(tiers.has(tier), `missing tier ${tier}`);
  }
});

test('existing demo pharmacies keep their results', async () => {
  const { results } = await assessAll();
  const assessable = results.get(DEMO_IDS.assessable);
  assert.equal(assessable.score, 80.5);
  assert.equal(assessable.tier, 'HIGHLY_TRUSTED');
  const insufficient = results.get(DEMO_IDS.insufficient);
  assert.equal(insufficient.status, 'NOT_ASSESSABLE');
  assert.equal(insufficient.score, null);
});

test('scores are recomputable from indicator values with the trustScore weights', async () => {
  const { results } = await assessAll();
  for (const [id, result] of results) {
    if (result.status !== 'ASSESSABLE') continue;
    const recomputed = Object.keys(WEIGHTS).reduce((sum, name) => sum + result.breakdown[name].value * WEIGHTS[name], 0);
    assert.ok(Math.abs(recomputed - result.score) <= 1e-9, `${id}: ${recomputed} vs ${result.score}`);
  }
});

test('NOT_ASSESSABLE sample has no score or tier and names the missing indicator', async () => {
  const { results } = await assessAll();
  const result = results.get('C3-DEMO-PHARMACY-NA-02');
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.equal(result.tier, 'NOT_ASSESSABLE');
  assert.deepEqual(result.missingIndicators.map(item => item.name), ['recall']);
});

test('a high-scoring sample still raises its critical escalation', async () => {
  const { results } = await assessAll();
  const result = results.get('C3-DEMO-PHARMACY-CRIT-01');
  assert.ok(result.score >= 80);
  assert.equal(result.tier, 'HIGHLY_TRUSTED');
  assert.equal(result.criticalEscalation.required, true);
  assert.equal(result.criticalEscalation.findings[0].source, 'SYNTHETIC_TEST_DATA');
});

test('every sample is labelled as simulated exactly like the existing fixtures', async () => {
  const { fixtures, results } = await assessAll();
  for (const [id, result] of results) {
    assert.equal(result.demoLabel, DEMO_LABEL, id);
    assert.equal(result.evidenceSource, 'SYNTHETIC', id);
    assert.ok(id.startsWith('C3-DEMO-'), id);
    assert.ok(fixtures.get(id).evidence.every(item => item.provenance === 'SYNTHETIC'), id);
  }
});

test('sample session list matches the server.js session response shape', () => {
  const fixtures = createDemoFixtures();
  const access = listDemoPharmacies(fixtures, { mode: 'LOCAL_DEMO' });
  assert.equal(access.requiresWalletVerification, false);
  assert.deepEqual(access.pharmacies.map(item => item.pharmacyCode), [...fixtures.keys()].sort());
  for (const item of access.pharmacies) {
    assert.deepEqual(item.accessTypes, ['REGULATORY']);
    assert.deepEqual(item.permissions, ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ']);
  }
  assert.deepEqual(listDemoPharmacies(fixtures, null), { pharmacies: [], requiresWalletVerification: false });
});
