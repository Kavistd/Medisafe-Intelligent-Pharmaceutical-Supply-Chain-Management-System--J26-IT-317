'use strict';

/**
 * Component 3 validation runner (SYNTHETIC DATA ONLY).
 *   node validation/component3/run.js
 * Runs the functional cases, scenario profiles, equal-weight baseline, weight
 * sensitivity and AHP status, then writes deterministic outputs (no timestamps)
 * to validation/component3/results/.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runFunctionalCases, TOLERANCE } = require('./functional');
const { SCENARIO_SEED, evaluateScenarios, runScenarioChecks } = require('./simulation/scenarios');
const { runBaseline } = require('./sensitivity/baseline');
const { runSensitivity, GLOBAL_SEED, GLOBAL_DRAWS } = require('./sensitivity/sensitivity');
const { ahpStatus } = require('./ahp/ahp');
const { INDICATORS, WEIGHTS } = require('./lib/pipeline');

const RESULTS_DIR = path.join(__dirname, 'results');
const AHP_INPUTS_DIR = path.join(__dirname, 'ahp', 'inputs');

const BANNER = Object.freeze([
  'SYNTHETIC DATA - NOT REAL PHARMACY DATA.',
  'Proposed weights (D 0.35, R 0.30, C 0.20, I 0.15) and tier thresholds (80 / 60 / 40) are research parameters, not NMRA-prescribed values.',
  'These results show computational correctness and robustness to weight assumptions only. They do not show real-world accuracy.',
]);

const fmt = (value, digits = 4) => (value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits));
const pct = value => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);

function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(name, header, rows) {
  const lines = [...BANNER.map(line => `# ${line}`), header.join(','), ...rows.map(row => row.map(csvCell).join(','))];
  fs.writeFileSync(path.join(RESULTS_DIR, name), `${lines.join('\n')}\n`);
}

function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function weightsText(weights) {
  return INDICATORS.map(name => `${name[0].toUpperCase()} ${fmt(weights[name], 4)}`).join(', ');
}

function buildMarkdown({ functional, scenarios, checks, baseline, sensitivity, ahp }) {
  const casesPassed = functional.filter(item => item.pass).length;
  const checksPassed = functional.reduce((sum, item) => sum + item.checksPassed, 0);
  const checksTotal = functional.reduce((sum, item) => sum + item.checksTotal, 0);
  const maxDiff = Math.max(...functional.filter(item => item.maxAbsDiff !== null).map(item => item.maxAbsDiff));
  const scenarioPassed = checks.filter(item => item.pass).length;
  const { summary: b } = baseline;
  const g = sensitivity.global.summary;
  const counts = scenarios.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  const tiers = scenarios.reduce((acc, row) => ({ ...acc, [row.tier]: (acc[row.tier] || 0) + 1 }), {});

  const out = [];
  out.push(BANNER.map(line => `> **${line}**`).join('\n>\n'));
  out.push('');
  out.push('# Component 3 Validation Results');
  out.push('');
  out.push(`Reproduce with \`node validation/component3/run.js\`. Scenario seed ${SCENARIO_SEED}; global-sensitivity seed ${GLOBAL_SEED} (${GLOBAL_DRAWS} draws). Outputs are deterministic and contain no timestamps.`);
  out.push('');

  out.push('## 1. Functional tests (T01-T08, plus supplementary T09-T10)');
  out.push('');
  out.push(`Acceptance criteria (set before execution): 100% of cases pass; numeric |observed - expected| <= ${TOLERANCE}.`);
  out.push('');
  out.push(`**Observed: ${casesPassed}/${functional.length} cases passed (${pct(casesPassed / functional.length)}); ${checksPassed}/${checksTotal} individual checks passed; max numeric |difference| = ${maxDiff.toExponential(2)}.**`);
  out.push('');
  out.push(table(['ID', 'Case', 'Checks passed', 'Max abs diff', 'Result'], functional.map(item => [
    item.id, item.title, `${item.checksPassed}/${item.checksTotal}`,
    item.maxAbsDiff === null ? 'n/a' : item.maxAbsDiff.toExponential(2), item.pass ? 'PASS' : 'FAIL',
  ])));
  out.push('');

  out.push('## 2. Scenario profiles and expected-behaviour checks');
  out.push('');
  out.push(`${scenarios.length} synthetic profiles: ${counts.ASSESSABLE || 0} ASSESSABLE, ${counts.NOT_ASSESSABLE || 0} NOT_ASSESSABLE. ` +
    `Tier counts: ${['HIGHLY_TRUSTED', 'TRUSTED', 'UNDER_REVIEW', 'ESCALATION_ALERT', 'NOT_ASSESSABLE'].map(t => `${t} ${tiers[t] || 0}`).join(', ')}.`);
  out.push('');
  out.push(`**Observed: ${scenarioPassed}/${checks.length} checks passed.**`);
  out.push('');
  out.push(table(['ID', 'Expected behaviour', 'Profiles checked', 'Passed', 'Result'], checks.map(item => [
    item.id, item.description, item.profilesChecked, item.passed, item.pass ? 'PASS' : 'FAIL',
  ])));
  out.push('');
  out.push('<details><summary>Per-profile results</summary>');
  out.push('');
  out.push(table(['Pharmacy', 'Archetype', 'D', 'R', 'C', 'I', 'Status', 'Score', 'Tier', 'Escalation'], scenarios.map(row => [
    row.pharmacyId, row.archetype, ...INDICATORS.map(name => fmt(row.values[name], 2)),
    row.status, fmt(row.score, 3), row.tier, row.criticalEscalationRequired ? 'REQUIRED' : 'no',
  ])));
  out.push('');
  out.push('</details>');
  out.push('');

  out.push('## 3. Equal-weight baseline');
  out.push('');
  out.push(`Proposed (${weightsText(WEIGHTS)}) vs equal (all 0.25), on ASSESSABLE profiles only. ` +
    `Aggregator consistency with production calculateTrustScore: max |difference| = ${baseline.consistency.maxAbsDiff.toExponential(2)} over ${baseline.consistency.profilesCompared} profiles.`);
  out.push('');
  out.push(table(['Metric', 'Observed'], [
    ['Profiles compared', b.profilesCompared],
    ['Excluded (NOT_ASSESSABLE)', b.excludedNotAssessable],
    ['Mean absolute score difference', fmt(b.meanAbsDiff)],
    ['Max absolute score difference', fmt(b.maxAbsDiff)],
    ['Spearman rank correlation', fmt(b.spearmanRho)],
    ['Tier switches', `${b.tierSwitches} of ${b.profilesCompared}`],
    ['Tier-switch rate', pct(b.tierSwitchRate)],
  ]));
  out.push('');

  out.push('## 4. One-at-a-time weight sensitivity');
  out.push('');
  out.push(`${sensitivity.note}`);
  out.push('');
  out.push(table(['Weight', 'Change', 'Renormalised weights', 'Mean abs change', 'Max abs change', 'Spearman rho', 'Tier switches', 'Switch rate'],
    sensitivity.oneAtATime.runs.map(run => [
      run.indicator, run.change, weightsText(run.weights), fmt(run.meanAbsScoreChange), fmt(run.maxAbsScoreChange),
      fmt(run.spearmanRho), run.tierSwitches, pct(run.tierSwitchRate),
    ])));
  out.push('');

  out.push('## 5. Global weight check and tier stability');
  out.push('');
  out.push(`${GLOBAL_DRAWS} weight vectors drawn uniformly over all weightings that sum to 1 (Dirichlet(1,1,1,1), seed ${GLOBAL_SEED}). ` +
    'This is a deliberately extreme stress test (it includes weightings far from any plausible expert view), not an estimate of expected variation.');
  out.push('');
  out.push(table(['Metric', 'Observed'], [
    ['Profiles compared', sensitivity.global.profilesCompared],
    ['Spearman rho vs proposed: mean', fmt(g.spearmanMean)],
    ['Spearman rho vs proposed: median', fmt(g.spearmanMedian)],
    ['Spearman rho vs proposed: 5th percentile', fmt(g.spearmanP05)],
    ['Spearman rho vs proposed: minimum', fmt(g.spearmanMin)],
    ['Overall tier stability (profile x draw pairs keeping proposed tier)', pct(g.overallTierStability)],
    ['Profiles keeping their tier in every draw', `${g.profilesFullyTierStable} of ${sensitivity.global.profilesCompared}`],
    ['Median per-profile score range', fmt(g.medianScoreRange)],
    ['Max per-profile score range', fmt(g.maxScoreRange)],
  ]));
  out.push('');
  out.push(table(['Pharmacy', 'Archetype', 'Proposed score', 'Proposed tier', 'Score range (min-max)', 'Rank range', 'Tier stability'],
    sensitivity.global.perProfile.map(item => [
      item.pharmacyId, item.archetype, fmt(item.proposedScore, 3), item.proposedTier,
      `${fmt(item.minScore, 2)}-${fmt(item.maxScore, 2)}`, `${item.minRank}-${item.maxRank}`, pct(item.tierStability),
    ])));
  out.push('');

  out.push('## 6. AHP');
  out.push('');
  out.push(`**${ahp.status}.**`);
  out.push('');
  if (ahp.expertCount > 0) {
    out.push(table(['Expert', 'Weights', 'CR', 'CR < 0.10'], ahp.individual.map(item => [
      item.expertId, weightsText(item.weights), fmt(item.cr), item.consistent ? 'yes' : 'no',
    ])));
    out.push('');
    out.push(`Group (geometric mean): ${weightsText(ahp.group.weights)}; lambda_max ${fmt(ahp.group.lambdaMax)}, CR ${fmt(ahp.group.cr)} (${ahp.group.consistent ? 'acceptable' : 'inconsistent'}).`);
  } else {
    out.push('Priority-vector, lambda_max, CI/CR (RI(4) = 0.90) and geometric-mean aggregation are implemented and unit-tested. No weights are derived until real expert forms (ahp/EXPERT_INPUT_TEMPLATE.md) are returned.');
  }
  out.push('');

  out.push('## Interpretation limits');
  out.push('');
  out.push('- All profiles are generated synthetic counts; archetype ranges are illustrative assumptions.');
  out.push('- Robustness here is measured with respect to the weight assumptions only. It says nothing about whether the indicators measure real pharmacy trustworthiness.');
  out.push('- See VALIDATION_METHODOLOGY.md for methods, criteria and limitations.');
  out.push('');
  return out.join('\n');
}

async function main() {
  const functional = await runFunctionalCases();
  const scenarios = await evaluateScenarios(SCENARIO_SEED);
  const checks = await runScenarioChecks(scenarios, SCENARIO_SEED);
  const baseline = runBaseline(scenarios);
  const sensitivity = runSensitivity(scenarios);
  const ahp = ahpStatus(AHP_INPUTS_DIR);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const results = {
    banner: BANNER,
    parameters: { scenarioSeed: SCENARIO_SEED, globalSeed: GLOBAL_SEED, globalDraws: GLOBAL_DRAWS, functionalTolerance: TOLERANCE, proposedWeights: { ...WEIGHTS } },
    functional,
    scenarios: { profiles: scenarios, checks },
    baseline,
    sensitivity,
    ahp,
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

  writeCsv('functional.csv', ['case', 'check', 'expected', 'observed', 'abs_diff', 'pass'],
    functional.flatMap(item => item.checks.map(c => [item.id, c.label, c.expected, c.observed, c.absDiff, c.pass])));
  writeCsv('scenarios.csv', ['pharmacy_id', 'archetype',
    ...INDICATORS.flatMap(name => [`${name}_numerator`, `${name}_denominator`, `${name}_value`]),
    'status', 'score', 'tier', 'critical_escalation_required', 'evidence_source'],
  scenarios.map(row => [row.pharmacyId, row.archetype,
    ...INDICATORS.flatMap(name => [row.counts[name].numerator, row.counts[name].denominator, row.values[name]]),
    row.status, row.score, row.tier, row.criticalEscalationRequired, row.evidenceSource]));
  writeCsv('scenario_checks.csv', ['check', 'description', 'profiles_checked', 'passed', 'pass', 'failures'],
    checks.map(item => [item.id, item.description, item.profilesChecked, item.passed, item.pass, item.failures.join(' ')]));
  writeCsv('baseline_equal_weights.csv', ['pharmacy_id', 'archetype', 'proposed_score', 'equal_weight_score', 'difference', 'proposed_tier', 'equal_weight_tier', 'tier_switched'],
    baseline.perProfile.map(item => [item.pharmacyId, item.archetype, item.proposedScore, item.alternativeScore, item.difference, item.proposedTier, item.alternativeTier, item.tierSwitched]));
  writeCsv('sensitivity_oat.csv', ['indicator', 'change', 'factor', ...INDICATORS.map(name => `w_${name}`), 'mean_abs_score_change', 'max_abs_score_change', 'spearman_rho', 'tier_switches', 'tier_switch_rate'],
    sensitivity.oneAtATime.runs.map(run => [run.indicator, run.change, run.factor, ...INDICATORS.map(name => run.weights[name]),
      run.meanAbsScoreChange, run.maxAbsScoreChange, run.spearmanRho, run.tierSwitches, run.tierSwitchRate]));
  writeCsv('sensitivity_global.csv', ['pharmacy_id', 'archetype', 'proposed_score', 'proposed_tier', 'proposed_rank', 'min_score', 'max_score', 'score_range', 'min_rank', 'max_rank', 'tier_stability'],
    sensitivity.global.perProfile.map(item => [item.pharmacyId, item.archetype, item.proposedScore, item.proposedTier, item.proposedRank,
      item.minScore, item.maxScore, item.scoreRange, item.minRank, item.maxRank, item.tierStability]));
  fs.writeFileSync(path.join(RESULTS_DIR, 'RESULTS.md'), buildMarkdown({ functional, scenarios, checks, baseline, sensitivity, ahp }));

  const functionalPassed = functional.filter(item => item.pass).length;
  const checksPassed = checks.filter(item => item.pass).length;
  console.log('Component 3 validation (SYNTHETIC DATA - not real pharmacy data)');
  console.log(`Functional cases: ${functionalPassed}/${functional.length} passed`);
  console.log(`Scenario checks: ${checksPassed}/${checks.length} passed (${scenarios.length} profiles)`);
  console.log(`Equal-weight baseline: Spearman ${fmt(baseline.summary.spearmanRho)}, tier-switch rate ${pct(baseline.summary.tierSwitchRate)}`);
  console.log(`Results written to ${path.relative(process.cwd(), RESULTS_DIR) || '.'}`);
  if (functionalPassed !== functional.length || checksPassed !== checks.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
