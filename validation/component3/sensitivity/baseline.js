'use strict';

/**
 * Proposed weights (0.35/0.30/0.20/0.15) vs an equal-weight baseline (0.25 each)
 * on the ASSESSABLE synthetic profiles. NOT_ASSESSABLE profiles have no score
 * under either scheme and are excluded from ranking (their count is reported).
 */
const { WEIGHTS, EQUAL_WEIGHTS, aggregate, tierOf } = require('./aggregate');
const { mean, max, spearman } = require('../lib/stats');

function assessableRows(results) {
  return results.filter(row => row.status === 'ASSESSABLE');
}

/** Max |aggregate(values, WEIGHTS) - production score| across assessable rows. */
function consistencyWithProduction(results) {
  const rows = assessableRows(results);
  const diffs = rows.map(row => Math.abs(aggregate(row.values, WEIGHTS) - row.score));
  return { profilesCompared: rows.length, maxAbsDiff: rows.length ? max(diffs) : null };
}

/** Compare an alternative weight vector with the proposed weights. */
function compareWeights(results, alternative) {
  const rows = assessableRows(results);
  const perProfile = rows.map(row => {
    const proposed = aggregate(row.values, WEIGHTS);
    const alt = aggregate(row.values, alternative);
    const proposedTier = tierOf(proposed);
    const altTier = tierOf(alt);
    return {
      pharmacyId: row.pharmacyId,
      archetype: row.archetype,
      proposedScore: proposed,
      alternativeScore: alt,
      difference: alt - proposed,
      proposedTier,
      alternativeTier: altTier,
      tierSwitched: proposedTier !== altTier,
    };
  });
  const absDiffs = perProfile.map(item => Math.abs(item.difference));
  const switches = perProfile.filter(item => item.tierSwitched).length;
  return {
    perProfile,
    summary: {
      profilesCompared: rows.length,
      excludedNotAssessable: results.length - rows.length,
      meanAbsDiff: mean(absDiffs),
      maxAbsDiff: max(absDiffs),
      spearmanRho: spearman(perProfile.map(item => item.proposedScore), perProfile.map(item => item.alternativeScore)),
      tierSwitches: switches,
      tierSwitchRate: rows.length ? switches / rows.length : null,
    },
  };
}

function runBaseline(results) {
  return {
    weights: { proposed: { ...WEIGHTS }, equal: { ...EQUAL_WEIGHTS } },
    consistency: consistencyWithProduction(results),
    ...compareWeights(results, EQUAL_WEIGHTS),
  };
}

module.exports = { assessableRows, consistencyWithProduction, compareWeights, runBaseline };
