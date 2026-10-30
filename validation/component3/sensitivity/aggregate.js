'use strict';

/**
 * Weight-parameterised aggregator for VALIDATION ONLY.
 * Production WEIGHTS stay frozen in backend/.../trustScore.js. This mirrors the
 * production arithmetic exactly (same indicator order, score = sum of value * weight,
 * starting from 0) so that alternative weight vectors can be compared. Its
 * equivalence with calculateTrustScore for the proposed weights is tested in
 * baseline.test.js. Tiers always come from the real classifyTier.
 */
const { INDICATORS, WEIGHTS, classifyTier } = require('../lib/pipeline');

const EQUAL_WEIGHTS = Object.freeze({ delivery: 0.25, recall: 0.25, complaint: 0.25, inspection: 0.25 });

function aggregate(values, weights) {
  let score = 0;
  for (const name of INDICATORS) {
    const value = values[name];
    const weight = weights[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Indicator "${name}" is not assessable.`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) throw new Error(`Weight "${name}" is invalid.`);
    score += value * weight;
  }
  return score;
}

/**
 * Renormalise a weight vector so it sums to 1. Used ONLY for weight-perturbation
 * analysis; the production rule never renormalises around a missing indicator.
 */
function normaliseWeights(weights) {
  const total = INDICATORS.reduce((sum, name) => sum + weights[name], 0);
  if (!(total > 0)) throw new Error('Weights must have a positive sum.');
  return Object.fromEntries(INDICATORS.map(name => [name, weights[name] / total]));
}

// Floating-point guard: a renormalised vector can sum to 1 +/- 1 ulp, giving
// e.g. 100.00000000000001, which classifyTier would reject as out of range.
function tierOf(score) {
  const bounded = score > 100 && score - 100 < 1e-9 ? 100 : score < 0 && score > -1e-9 ? 0 : score;
  return classifyTier(bounded);
}

module.exports = { WEIGHTS, EQUAL_WEIGHTS, aggregate, normaliseWeights, tierOf };
