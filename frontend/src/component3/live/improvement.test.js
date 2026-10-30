import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAVEAT, ESCALATION_NOTICE, INDICATOR_UNITS, MAX_EXTRA_EVENTS, TIER_MINIMUMS, TIER_ORDER,
  improvementPath, nextTierAbove, scoreWith, tierForScore,
} from './improvement.js';
import { INDICATORS, TIER_LABELS } from './liveModel.js';
import { TIERS } from '../overview.js';

const KEYS = ['delivery', 'recall', 'complaint', 'inspection'];
const WEIGHT_PERCENT = { delivery: 35n, recall: 30n, complaint: 20n, inspection: 15n };

/** Calculation payload in the shape returned by GET /api/v1/live/pharmacies/:code/calculation. */
function payload(counts, { escalation = false } = {}) {
  const breakdown = {}; const calculation = {}; const missing = [];
  let score = 0;
  for (const key of KEYS) {
    const [numerator, denominator] = counts[key];
    const weight = Number(WEIGHT_PERCENT[key]) / 100;
    const assessable = denominator > 0;
    const value = assessable ? (100 * numerator) / denominator : null;
    breakdown[key] = { status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE', value, weight, weightedContribution: assessable ? value * weight : null };
    calculation[key] = { status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE', numerator, denominator };
    if (assessable) score += value * weight; else missing.push({ name: key });
  }
  const assessable = missing.length === 0;
  return {
    status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE', score: assessable ? score : null,
    tier: assessable ? tierForScore(score) : 'NOT_ASSESSABLE', breakdown, calculation, missingIndicators: missing, criticalEscalationRequired: escalation,
  };
}

/** Exact check, independent of improvement.js: sum W_i (n_i + k_i) / (d_i + k_i) >= minimum (W in percent). */
function reachesExact(counts, extra, minimum) {
  const terms = KEYS.map(key => ({ w: WEIGHT_PERCENT[key], n: BigInt(counts[key][0] + (extra[key] || 0)), d: BigInt(counts[key][1] + (extra[key] || 0)) }));
  const product = terms.reduce((acc, term) => acc * term.d, 1n);
  const lhs = terms.reduce((acc, term) => acc + term.w * term.n * (product / term.d), 0n);
  return lhs >= BigInt(minimum) * product;
}
const every = k => Object.fromEntries(KEYS.map(key => [key, k]));
function exactSmallest(reach) {
  for (let k = 1; k <= MAX_EXTRA_EVENTS; k += 1) if (reach(k)) return k;
  return null;
}

const A = { delivery: [7, 10], recall: [9, 12], complaint: [4, 6], inspection: [16, 20] };
const B = { delivery: [4, 8], recall: [3, 8], complaint: [1, 3], inspection: [6, 12] };
const C = { delivery: [7, 10], recall: [0, 0], complaint: [4, 6], inspection: [16, 20] };
const HIGH = { delivery: [9, 10], recall: [10, 10], complaint: [5, 5], inspection: [18, 20] };
const row = (path, key) => path.indicators.find(item => item.key === key);

test('tier minimums match classifyTier in the backend scoring core and the UI tier order', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../../backend/component3-pharmacy-trust/services/trustScore.js', import.meta.url)), 'utf8');
  const core = Object.fromEntries([...source.matchAll(/score >= (\d+)\) return '([A-Z_]+)'/g)].map(match => [match[2], Number(match[1])]));
  assert.deepEqual(core, { HIGHLY_TRUSTED: 80, TRUSTED: 60, UNDER_REVIEW: 40 });
  assert.deepEqual({ ...TIER_MINIMUMS }, core);
  assert.deepEqual([...TIER_ORDER].reverse(), [...TIERS]);
  for (const tier of TIER_ORDER) assert.ok(TIER_LABELS[tier]);
  assert.equal(tierForScore(80), 'HIGHLY_TRUSTED');
  assert.equal(tierForScore(79.999), 'TRUSTED');
  assert.equal(tierForScore(40), 'UNDER_REVIEW');
  assert.equal(tierForScore(39.999), 'ESCALATION_ALERT');
  assert.equal(nextTierAbove('HIGHLY_TRUSTED'), null);
});

test('Pharmacy A (7/10, 9/12, 4/6, 16/20): TRUSTED, next HIGHLY_TRUSTED, minimal k matches exact fractions', () => {
  const path = improvementPath(payload(A));
  assert.equal(path.kind, 'PLAN');
  assert.equal(path.currentTier, 'TRUSTED');
  assert.equal(path.nextTier, 'HIGHLY_TRUSTED');
  assert.ok(Math.abs(path.pointsNeeded - (80 - 217 / 3)) < 1e-9);
  const expected = exactSmallest(k => reachesExact(A, every(k), 80));
  assert.equal(path.kAll, expected);
  assert.ok(reachesExact(A, every(expected), 80) && !reachesExact(A, every(expected - 1), 80));
  assert.match(path.message, new RegExp(`About ${expected} more on-time events in each area would reach Highly trusted`));
  for (const key of KEYS) {
    const alone = exactSmallest(k => reachesExact(A, { [key]: k }, 80));
    assert.equal(row(path, key).kAlone, alone, key);
  }
  // Only delivery can lift A alone: R, C and I could not add the 7.67 points even at 100%.
  assert.equal(row(path, 'delivery').reachableAlone, true);
  for (const key of ['recall', 'complaint', 'inspection']) assert.equal(row(path, key).reachableAlone, false, key);
  assert.equal(path.weakest.key, 'delivery');
  assert.ok(Math.abs(path.weakest.weightedGap - 0.35 * 30) < 1e-9);
  assert.equal(path.escalationNotice, null);
});

test('Pharmacy B (4/8, 3/8, 1/3, 6/12): UNDER_REVIEW, next TRUSTED, escalation notice kept separate', () => {
  const path = improvementPath(payload(B, { escalation: true }));
  assert.equal(path.kind, 'PLAN');
  assert.equal(path.currentTier, 'UNDER_REVIEW');
  assert.equal(path.nextTier, 'TRUSTED');
  assert.ok(Math.abs(path.pointsNeeded - (60 - (17.5 + 11.25 + 20 / 3 + 7.5))) < 1e-9);
  const expected = exactSmallest(k => reachesExact(B, every(k), 60));
  assert.equal(path.kAll, expected);
  assert.ok(reachesExact(B, every(expected), 60) && !reachesExact(B, every(expected - 1), 60));
  for (const key of KEYS) assert.equal(row(path, key).kAlone, exactSmallest(k => reachesExact(B, { [key]: k }, 60)), key);
  // Recall alone reaches TRUSTED; delivery alone would need more than the 200-event cap; C and I cannot.
  assert.equal(row(path, 'recall').reachableAlone, true);
  assert.equal(row(path, 'delivery').reachableAlone, false);
  assert.equal(row(path, 'complaint').kAlone, null);
  assert.equal(path.weakest.key, 'recall');
  assert.equal(path.escalationNotice, ESCALATION_NOTICE);
  assert.match(path.escalationNotice, /not cleared by score improvement/);
});

test('Pharmacy C (no eligible recall actions): no number, names the indicator, never 0 or 100', () => {
  const path = improvementPath(payload(C));
  assert.equal(path.kind, 'NOT_ENOUGH_EVIDENCE');
  assert.equal(path.message, 'Not enough evidence yet: Recall response has no eligible events.');
  assert.doesNotMatch(path.message, /\d/);
  assert.equal(path.kAll, undefined);
  assert.deepEqual(path.indicators, []);
  const two = improvementPath(payload({ ...C, complaint: [0, 0] }));
  assert.equal(two.message, 'Not enough evidence yet: Recall response and Complaint handling have no eligible events.');
  assert.equal(improvementPath(null).kind, 'NOT_ENOUGH_EVIDENCE');
});

test('escalation notice also appears when evidence is insufficient', () => {
  assert.equal(improvementPath(payload(C), { criticalEscalation: true }).escalationNotice, ESCALATION_NOTICE);
});

test('HIGHLY_TRUSTED: maintain current performance, no k', () => {
  const path = improvementPath(payload(HIGH));
  assert.equal(path.kind, 'MAINTAIN');
  assert.equal(path.message, 'Maintain current performance.');
  assert.equal(path.nextTier, null);
  assert.ok(path.indicators.every(item => item.kAlone === null));
});

test('more successful events never lower the score (monotonic)', () => {
  for (const counts of [A, B, HIGH, { delivery: [0, 4], recall: [1, 9], complaint: [0, 1], inspection: [2.5, 10] }]) {
    const rows = KEYS.map(key => ({ key, weight: Number(WEIGHT_PERCENT[key]) / 100, numerator: counts[key][0], denominator: counts[key][1] }));
    let previous = -Infinity;
    for (let k = 0; k <= 60; k += 1) {
      const all = scoreWith(rows, every(k));
      assert.ok(all >= previous - 1e-12);
      previous = all;
      for (const key of KEYS) assert.ok(scoreWith(rows, { [key]: k + 1 }) >= scoreWith(rows, { [key]: k }) - 1e-12);
    }
  }
});

test('k values are positive integers or null, never negative or fractional', () => {
  const paths = [A, B, { delivery: [0, 4], recall: [0, 3], complaint: [0, 2], inspection: [3.5, 10] }].map(counts => improvementPath(payload(counts)));
  for (const path of paths) {
    for (const k of [path.kAll, ...path.indicators.map(item => item.kAlone)]) {
      assert.ok(k === null || (Number.isInteger(k) && k >= 1 && k <= MAX_EXTRA_EVENTS), String(k));
    }
  }
  assert.equal(paths[2].currentTier, 'ESCALATION_ALERT');
  assert.equal(paths[2].nextTier, 'UNDER_REVIEW');
});

test('caveat wording and units are stated for every indicator', () => {
  assert.equal(CAVEAT, 'Indicative, assumes all future events are eligible and successful.');
  assert.deepEqual(Object.keys(INDICATOR_UNITS), INDICATORS.map(meta => meta.key));
  assert.equal(INDICATOR_UNITS.inspection, 'inspection points');
});
