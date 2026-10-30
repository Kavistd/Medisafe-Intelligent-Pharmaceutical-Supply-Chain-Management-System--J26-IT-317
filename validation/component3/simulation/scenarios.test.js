'use strict';

// SYNTHETIC validation data only; not real pharmacy data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENARIO_SEED, generateProfiles, evaluateScenarios, runScenarioChecks } = require('./scenarios');

test('generates about 40 profiles covering every archetype', () => {
  const profiles = generateProfiles();
  assert.equal(profiles.length, 40);
  assert.equal(new Set(profiles.map(item => item.pharmacyId)).size, profiles.length);
  for (const archetype of ['excellent', 'good', 'average', 'poor', 'recall-failure', 'delivery-weak',
    'complaint-weak', 'inspection-weak', 'critical-finding-with-high-score', 'missing-delivery',
    'missing-recall', 'missing-complaint', 'missing-inspection', 'all-missing', 'boundary-80',
    'boundary-60', 'boundary-40']) {
    assert.ok(profiles.some(item => item.archetype === archetype), archetype);
  }
});

test('profile generation is deterministic for the documented seed', () => {
  assert.equal(SCENARIO_SEED, 20261021);
  assert.deepEqual(generateProfiles(SCENARIO_SEED), generateProfiles(SCENARIO_SEED));
  assert.notDeepEqual(generateProfiles(SCENARIO_SEED), generateProfiles(SCENARIO_SEED + 1));
});

test('every expected-behaviour check passes', async () => {
  const results = await evaluateScenarios();
  const checks = await runScenarioChecks(results);
  assert.deepEqual(checks.map(item => item.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  for (const item of checks) {
    assert.ok(item.pass, `${item.id} failed for ${item.failures.join(', ')}`);
  }
});

test('critical-finding profiles keep high scores and still escalate', async () => {
  const results = await evaluateScenarios();
  const critical = results.filter(row => row.hasCriticalFinding);
  assert.equal(critical.length, 3);
  for (const row of critical) {
    assert.ok(row.score >= 80, `${row.pharmacyId} score ${row.score}`);
    assert.equal(row.criticalEscalationRequired, true);
  }
});
