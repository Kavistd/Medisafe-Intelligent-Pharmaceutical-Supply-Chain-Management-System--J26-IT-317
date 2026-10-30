'use strict';

/**
 * Weight sensitivity on the ASSESSABLE synthetic profiles.
 *
 * One-at-a-time (OAT): each proposed weight is multiplied by 0.90, 0.95, 1.05 and
 * 1.10, then the vector is renormalised to sum to 1 (4 factors x 4 weights = 16 runs).
 *
 * Global: GLOBAL_DRAWS weight vectors drawn uniformly from the simplex
 * (Dirichlet(1,1,1,1) via normalised -ln(U) exponentials), seeded with GLOBAL_SEED.
 * This is a deliberately wide stress test, not a plausible range of expert weights.
 *
 * NOTE: renormalisation is used here ONLY to perturb weights. It is different from
 * the production rule, which never renormalises around a missing indicator.
 */
const { INDICATORS } = require('../lib/pipeline');
const { mulberry32 } = require('../lib/prng');
const { mean, max, min, averageRanks, spearman, quantile } = require('../lib/stats');
const { WEIGHTS, aggregate, normaliseWeights, tierOf } = require('./aggregate');
const { assessableRows, compareWeights } = require('./baseline');

const OAT_FACTORS = Object.freeze([0.90, 0.95, 1.05, 1.10]);
const GLOBAL_SEED = 20261022;
const GLOBAL_DRAWS = 1000;
const RENORMALISATION_NOTE = 'Renormalisation is used here only for weight perturbation; the production rule never renormalises for missing indicators (missing indicator -> NOT_ASSESSABLE).';

function perturbedWeights(indicator, factor) {
  return normaliseWeights({ ...WEIGHTS, [indicator]: WEIGHTS[indicator] * factor });
}

function oneAtATime(results) {
  const runs = [];
  for (const indicator of INDICATORS) {
    for (const factor of OAT_FACTORS) {
      const weights = perturbedWeights(indicator, factor);
      const { summary } = compareWeights(results, weights);
      runs.push({
        indicator,
        change: `${factor > 1 ? '+' : '-'}${Math.round(Math.abs(factor - 1) * 100)}%`,
        factor,
        weights,
        meanAbsScoreChange: summary.meanAbsDiff,
        maxAbsScoreChange: summary.maxAbsDiff,
        spearmanRho: summary.spearmanRho,
        tierSwitches: summary.tierSwitches,
        tierSwitchRate: summary.tierSwitchRate,
        profilesCompared: summary.profilesCompared,
      });
    }
  }
  return runs;
}

function dirichletUniform(rng) {
  const draws = INDICATORS.map(() => -Math.log(1 - rng()));
  const total = draws.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(INDICATORS.map((name, index) => [name, draws[index] / total]));
}

function globalCheck(results, { seed = GLOBAL_SEED, draws = GLOBAL_DRAWS } = {}) {
  const rows = assessableRows(results);
  const rng = mulberry32(seed);
  const proposedScores = rows.map(row => aggregate(row.values, WEIGHTS));
  const proposedTiers = proposedScores.map(tierOf);
  // Descending rank: 1 = highest score; ties share the average rank.
  const proposedRanks = averageRanks(proposedScores.map(score => -score));

  const perProfile = rows.map((row, index) => ({
    pharmacyId: row.pharmacyId,
    archetype: row.archetype,
    proposedScore: proposedScores[index],
    proposedTier: proposedTiers[index],
    proposedRank: proposedRanks[index],
    minScore: Infinity,
    maxScore: -Infinity,
    minRank: Infinity,
    maxRank: -Infinity,
    sameTierDraws: 0,
  }));
  const rhos = [];
  let sameTierPairs = 0;
  for (let draw = 0; draw < draws; draw += 1) {
    const weights = dirichletUniform(rng);
    const scores = rows.map(row => aggregate(row.values, weights));
    const ranks = averageRanks(scores.map(score => -score));
    rhos.push(spearman(proposedScores, scores));
    scores.forEach((score, index) => {
      const item = perProfile[index];
      item.minScore = Math.min(item.minScore, score);
      item.maxScore = Math.max(item.maxScore, score);
      item.minRank = Math.min(item.minRank, ranks[index]);
      item.maxRank = Math.max(item.maxRank, ranks[index]);
      if (tierOf(score) === item.proposedTier) {
        item.sameTierDraws += 1;
        sameTierPairs += 1;
      }
    });
  }
  for (const item of perProfile) {
    item.scoreRange = item.maxScore - item.minScore;
    item.tierStability = item.sameTierDraws / draws;
  }
  const ranges = perProfile.map(item => item.scoreRange);
  return {
    seed,
    draws,
    distribution: 'Dirichlet(1,1,1,1): uniform over all weight vectors summing to 1',
    profilesCompared: rows.length,
    excludedNotAssessable: results.length - rows.length,
    summary: {
      spearmanMean: mean(rhos),
      spearmanMin: min(rhos),
      spearmanP05: quantile(rhos, 0.05),
      spearmanMedian: quantile(rhos, 0.5),
      overallTierStability: rows.length ? sameTierPairs / (rows.length * draws) : null,
      profilesFullyTierStable: perProfile.filter(item => item.sameTierDraws === draws).length,
      medianScoreRange: quantile(ranges, 0.5),
      maxScoreRange: max(ranges),
    },
    perProfile,
  };
}

function runSensitivity(results) {
  return {
    note: RENORMALISATION_NOTE,
    oneAtATime: { factors: [...OAT_FACTORS], runs: oneAtATime(results) },
    global: globalCheck(results),
  };
}

module.exports = { OAT_FACTORS, GLOBAL_SEED, GLOBAL_DRAWS, RENORMALISATION_NOTE, perturbedWeights, oneAtATime, globalCheck, runSensitivity };
