/**
 * Extracts the dashboard's validation summary from
 * validation/component3/results/results.json. validationSummary.json is the
 * committed output of this function; validationSummary.test.js fails if the two drift.
 */
const values = (items, pick) => items.map(pick).filter(value => typeof value === 'number' && Number.isFinite(value));
const min = list => (list.length ? Math.min(...list) : null);
const max = list => (list.length ? Math.max(...list) : null);

export function summarizeValidationResults(results) {
  const functional = results.functional;
  const checks = results.scenarios.checks;
  const runs = results.sensitivity.oneAtATime.runs;
  const global = results.sensitivity.global;
  return {
    source: 'validation/component3/results/results.json',
    banner: [...results.banner],
    functional: {
      casesPassed: functional.filter(item => item.pass).length,
      casesTotal: functional.length,
      checksPassed: functional.reduce((sum, item) => sum + item.checksPassed, 0),
      checksTotal: functional.reduce((sum, item) => sum + item.checksTotal, 0),
    },
    scenarios: {
      profiles: results.scenarios.profiles.length,
      checksPassed: checks.filter(item => item.pass).length,
      checksTotal: checks.length,
    },
    equalWeightBaseline: {
      profilesCompared: results.baseline.summary.profilesCompared,
      excludedNotAssessable: results.baseline.summary.excludedNotAssessable,
      spearmanRho: results.baseline.summary.spearmanRho,
      tierSwitches: results.baseline.summary.tierSwitches,
      tierSwitchRate: results.baseline.summary.tierSwitchRate,
    },
    oneAtATime: {
      runs: runs.length,
      spearmanMin: min(values(runs, run => run.spearmanRho)),
      spearmanMax: max(values(runs, run => run.spearmanRho)),
      maxAbsScoreChange: max(values(runs, run => run.maxAbsScoreChange)),
      tierSwitchRateMin: min(values(runs, run => run.tierSwitchRate)),
      tierSwitchRateMax: max(values(runs, run => run.tierSwitchRate)),
    },
    globalStressTest: {
      draws: global.draws,
      seed: global.seed,
      profilesCompared: global.profilesCompared,
      spearmanMean: global.summary.spearmanMean,
      spearmanP05: global.summary.spearmanP05,
      spearmanMin: global.summary.spearmanMin,
      overallTierStability: global.summary.overallTierStability,
      profilesFullyTierStable: global.summary.profilesFullyTierStable,
    },
    ahp: { status: results.ahp.status, expertCount: results.ahp.expertCount },
    renormalisationNote: results.sensitivity.note,
  };
}
