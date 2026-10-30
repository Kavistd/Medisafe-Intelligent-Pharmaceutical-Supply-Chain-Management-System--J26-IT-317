'use strict';

// SYNTHETIC validation data only; not real pharmacy data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateScenarios } = require('../simulation/scenarios');
const { calculateTrustScore, toTrustScoreInput, INDICATORS } = require('../lib/pipeline');
const { averageRanks, spearman, quantile } = require('../lib/stats');
const { WEIGHTS, EQUAL_WEIGHTS, aggregate, normaliseWeights } = require('./aggregate');
const { runBaseline } = require('./baseline');
const { OAT_FACTORS, perturbedWeights, oneAtATime, globalCheck } = require('./sensitivity');

let cached;
const scenarioResults = async () => (cached ||= await evaluateScenarios());

test('aggregator matches calculateTrustScore exactly (<= 1e-12) for proposed weights on all assessable profiles', async () => {
  const results = await scenarioResults();
  const assessable = results.filter(row => row.status === 'ASSESSABLE');
  assert.ok(assessable.length >= 30);
  for (const row of assessable) {
    const input = toTrustScoreInput(Object.fromEntries(INDICATORS.map(name => [name, {
      indicator: { status: 'ASSESSABLE', value: row.values[name], evidenceCount: 1, source: 'SYNTHETIC' },
    }])));
    const production = calculateTrustScore(input).score;
    assert.ok(Math.abs(aggregate(row.values, WEIGHTS) - production) <= 1e-12, row.pharmacyId);
    assert.ok(Math.abs(aggregate(row.values, WEIGHTS) - row.score) <= 1e-12, row.pharmacyId);
  }
  const baseline = runBaseline(results);
  assert.ok(baseline.consistency.maxAbsDiff <= 1e-12);
});

test('production WEIGHTS are untouched by the harness', () => {
  assert.deepEqual(WEIGHTS, { delivery: 0.35, recall: 0.30, complaint: 0.20, inspection: 0.15 });
  assert.equal(Object.isFrozen(WEIGHTS), true);
  assert.equal(Object.values(EQUAL_WEIGHTS).reduce((a, b) => a + b, 0), 1);
});

test('aggregator rejects NOT_ASSESSABLE (null) values instead of renormalising', () => {
  assert.throws(() => aggregate({ delivery: 80, recall: null, complaint: 70, inspection: 80 }, WEIGHTS), /not assessable/);
});

test('average ranks and Spearman match a hand-calculated tie example', () => {
  assert.deepEqual(averageRanks([5, 6, 7, 8, 7]), [1, 2, 3.5, 5, 3.5]);
  // ranks x = 1..5, ranks y = 1,2,3.5,5,3.5: cov = 8, var x = 10, var y = 9.5 -> rho = 8 / sqrt(95).
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]) - 8 / Math.sqrt(95)) <= 1e-12);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 2, 3], [4, 4, 4]), null);
  assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5);
});

test('equal-weight baseline reports exclusions and bounded metrics', async () => {
  const results = await scenarioResults();
  const { summary, perProfile } = runBaseline(results);
  assert.equal(summary.profilesCompared + summary.excludedNotAssessable, results.length);
  assert.equal(summary.excludedNotAssessable, 5);
  assert.equal(perProfile.length, summary.profilesCompared);
  assert.ok(summary.spearmanRho > -1 && summary.spearmanRho <= 1);
  assert.ok(summary.tierSwitchRate >= 0 && summary.tierSwitchRate <= 1);
  // Boundary profiles have equal indicator values, so every weight vector scores them identically.
  for (const id of ['SYN-BOUNDARY-80', 'SYN-BOUNDARY-60', 'SYN-BOUNDARY-40']) {
    const item = perProfile.find(row => row.pharmacyId === id);
    assert.ok(Math.abs(item.difference) <= 1e-9, id);
  }
});

test('OAT perturbations renormalise to 1 and cover 4 factors x 4 weights', async () => {
  const runs = oneAtATime(await scenarioResults());
  assert.equal(runs.length, OAT_FACTORS.length * INDICATORS.length);
  for (const run of runs) {
    assert.ok(Math.abs(Object.values(run.weights).reduce((a, b) => a + b, 0) - 1) <= 1e-12);
  }
  const up = perturbedWeights('delivery', 1.10);
  // 0.385 / 1.035 for delivery; the others scale by 1 / 1.035.
  assert.ok(Math.abs(up.delivery - 0.385 / 1.035) <= 1e-12);
  assert.ok(Math.abs(up.recall - 0.30 / 1.035) <= 1e-12);
  assert.deepEqual(normaliseWeights({ delivery: 2, recall: 1, complaint: 1, inspection: 0 }),
    { delivery: 0.5, recall: 0.25, complaint: 0.25, inspection: 0 });
});

test('global check is seeded and deterministic', async () => {
  const results = await scenarioResults();
  const first = globalCheck(results, { draws: 200 });
  const second = globalCheck(results, { draws: 200 });
  assert.deepEqual(first, second);
  assert.ok(first.summary.overallTierStability >= 0 && first.summary.overallTierStability <= 1);
  assert.notDeepEqual(globalCheck(results, { draws: 200, seed: 1 }).summary, first.summary);
});
