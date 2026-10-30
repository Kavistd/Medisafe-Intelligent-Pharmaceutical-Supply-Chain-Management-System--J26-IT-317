'use strict';

/**
 * Deterministic SYNTHETIC pharmacy profiles for Component 3 validation.
 * NOT REAL PHARMACY DATA. Archetype rate ranges are illustrative assumptions
 * chosen to exercise the scoring logic, not estimates of real pharmacy behaviour.
 *
 * Generator: mulberry32 seeded with SCENARIO_SEED (= 20261021). Each profile is a
 * set of evidence COUNTS that is passed through the real indicatorScoring and
 * assessmentService modules (see ../lib/pipeline.js); every record is SYNTHETIC.
 */
const { mulberry32, randomInt, uniform } = require('../lib/prng');
const { INDICATORS, evaluateSpec, indicatorValues } = require('../lib/pipeline');

const SCENARIO_SEED = 20261021;

// Eligible-record count ranges per indicator (inclusive) and inspection rubric size.
const DENOMINATORS = Object.freeze({
  delivery: [10, 24],
  recall: [4, 12],
  complaint: [4, 12],
  inspectionReports: [1, 2],
  inspectionPointsPerReport: [10, 30],
});

const EXCELLENT = [0.90, 1.00];
const GOOD = [0.75, 0.90];
const AVERAGE = [0.55, 0.75];
const POOR = [0.20, 0.50];
const STRONG = [0.85, 1.00];
const WEAK = [0.20, 0.45];
const all = range => ({ delivery: range, recall: range, complaint: range, inspection: range });

// Success-rate ranges per indicator; null = no eligible evidence (missing indicator).
const ARCHETYPES = Object.freeze([
  { code: 'EXCELLENT', archetype: 'excellent', count: 4, ranges: all(EXCELLENT) },
  { code: 'GOOD', archetype: 'good', count: 4, ranges: all(GOOD) },
  { code: 'AVERAGE', archetype: 'average', count: 4, ranges: all(AVERAGE) },
  { code: 'POOR', archetype: 'poor', count: 4, ranges: all(POOR) },
  { code: 'RECALL-FAIL', archetype: 'recall-failure', count: 3, ranges: { ...all(STRONG), recall: [0.00, 0.30] } },
  { code: 'DELIVERY-WEAK', archetype: 'delivery-weak', count: 3, ranges: { ...all(STRONG), delivery: WEAK } },
  { code: 'COMPLAINT-WEAK', archetype: 'complaint-weak', count: 3, ranges: { ...all(STRONG), complaint: WEAK } },
  { code: 'INSPECTION-WEAK', archetype: 'inspection-weak', count: 3, ranges: { ...all(STRONG), inspection: WEAK } },
  { code: 'CRITICAL-HIGH', archetype: 'critical-finding-with-high-score', count: 3, ranges: all(EXCELLENT), critical: true },
  { code: 'MISSING-D', archetype: 'missing-delivery', count: 1, ranges: { ...all(GOOD), delivery: null } },
  { code: 'MISSING-R', archetype: 'missing-recall', count: 1, ranges: { ...all(GOOD), recall: null } },
  { code: 'MISSING-C', archetype: 'missing-complaint', count: 1, ranges: { ...all(GOOD), complaint: null } },
  { code: 'MISSING-I', archetype: 'missing-inspection', count: 1, ranges: { ...all(GOOD), inspection: null } },
  { code: 'MISSING-ALL', archetype: 'all-missing', count: 1, ranges: { delivery: null, recall: null, complaint: null, inspection: null } },
  { code: 'ZERO-D', archetype: 'zero-delivery', count: 1, ranges: { ...all(GOOD), delivery: [0, 0] } },
]);

// Fixed profiles that land exactly on the tier thresholds (every indicator = target).
const BOUNDARY_PROFILES = Object.freeze([
  { target: 80, tier: 'HIGHLY_TRUSTED', d: [8, 10], r: [4, 5], c: [8, 10], i: [16, 20] },
  { target: 60, tier: 'TRUSTED', d: [6, 10], r: [3, 5], c: [6, 10], i: [12, 20] },
  { target: 40, tier: 'UNDER_REVIEW', d: [4, 10], r: [2, 5], c: [4, 10], i: [8, 20] },
]);

function countsFor(rng, indicator, range) {
  if (range === null) {
    return indicator === 'inspection' ? { reports: [] } : { successes: 0, total: 0 };
  }
  if (indicator === 'inspection') {
    const reportCount = randomInt(rng, ...DENOMINATORS.inspectionReports);
    const reports = [];
    for (let k = 0; k < reportCount; k += 1) {
      const applicable = randomInt(rng, ...DENOMINATORS.inspectionPointsPerReport);
      const rate = uniform(rng, range[0], range[1]);
      reports.push({ achieved: Math.min(applicable, Math.max(0, Math.round(rate * applicable))), applicable });
    }
    return { reports };
  }
  const total = randomInt(rng, ...DENOMINATORS[indicator]);
  const rate = uniform(rng, range[0], range[1]);
  return { successes: Math.min(total, Math.max(0, Math.round(rate * total))), total };
}

function syntheticFinding(pharmacyId) {
  return {
    id: `SYN-CF:${pharmacyId}`,
    description: 'Synthetic critical finding for validation; not a real regulatory finding.',
    source: 'SYNTHETIC_TEST_DATA',
  };
}

/** Generate the deterministic list of profile specifications for a seed. */
function generateProfiles(seed = SCENARIO_SEED) {
  const rng = mulberry32(seed);
  const profiles = [];
  for (const type of ARCHETYPES) {
    for (let k = 1; k <= type.count; k += 1) {
      const pharmacyId = `SYN-${type.code}-${String(k).padStart(2, '0')}`;
      const indicators = {};
      for (const name of INDICATORS) indicators[name] = countsFor(rng, name, type.ranges[name]);
      profiles.push({
        pharmacyId,
        archetype: type.archetype,
        expectedMissing: INDICATORS.filter(name => type.ranges[name] === null),
        indicators,
        criticalFindings: type.critical ? [syntheticFinding(pharmacyId)] : [],
      });
    }
  }
  for (const boundary of BOUNDARY_PROFILES) {
    profiles.push({
      pharmacyId: `SYN-BOUNDARY-${boundary.target}`,
      archetype: `boundary-${boundary.target}`,
      expectedMissing: [],
      boundary: { target: boundary.target, tier: boundary.tier },
      indicators: {
        delivery: { successes: boundary.d[0], total: boundary.d[1] },
        recall: { successes: boundary.r[0], total: boundary.r[1] },
        complaint: { successes: boundary.c[0], total: boundary.c[1] },
        inspection: { reports: [{ achieved: boundary.i[0], applicable: boundary.i[1] }] },
      },
      criticalFindings: [],
    });
  }
  return profiles;
}

function summariseCounts(spec) {
  const counts = {};
  for (const name of INDICATORS) {
    const value = spec.indicators[name];
    counts[name] = name === 'inspection'
      ? {
        numerator: value.reports.reduce((sum, report) => sum + report.achieved, 0),
        denominator: value.reports.reduce((sum, report) => sum + report.applicable, 0),
      }
      : { numerator: value.successes, denominator: value.total };
  }
  return counts;
}

/** Evaluate every profile through the real services. */
async function evaluateScenarios(seed = SCENARIO_SEED) {
  const results = [];
  for (const spec of generateProfiles(seed)) {
    const { assessment, record } = await evaluateSpec(spec);
    results.push({
      pharmacyId: spec.pharmacyId,
      archetype: spec.archetype,
      expectedMissing: spec.expectedMissing,
      boundary: spec.boundary || null,
      hasCriticalFinding: spec.criticalFindings.length > 0,
      counts: summariseCounts(spec),
      values: indicatorValues(assessment),
      status: assessment.status,
      score: assessment.score,
      tier: assessment.tier,
      missingIndicators: assessment.missingIndicators.map(item => item.name),
      criticalEscalationRequired: assessment.criticalEscalation.required,
      evidenceSource: assessment.evidenceSource,
      allEvidenceSynthetic: record.evidence.every(item => item.provenance === 'SYNTHETIC'),
      evidenceCount: assessment.evidenceValidation.evidenceCount,
    });
  }
  return results;
}

/**
 * Expected-behaviour checks, defined before execution:
 *  S1 missing indicator(s) -> NOT_ASSESSABLE, null score, tier NOT_ASSESSABLE, exact missing names
 *  S2 critical finding     -> escalation required, score identical to the same profile without the finding
 *  S3 no critical finding  -> escalation not required
 *  S4 boundary profiles    -> exact tier and |score - target| <= 1e-9
 *  S5 zero-value indicator -> ASSESSABLE with value 0 (distinct from NOT_ASSESSABLE)
 *  S6 provenance           -> every evidence record SYNTHETIC; every assessable score labelled SYNTHETIC
 *  S7 determinism          -> same seed gives byte-identical results; a different seed gives different profiles
 */
async function runScenarioChecks(results, seed = SCENARIO_SEED) {
  const checks = [];
  const add = (id, description, applicable) => {
    const failures = applicable.filter(item => !item.pass).map(item => item.pharmacyId);
    checks.push({ id, description, profilesChecked: applicable.length, passed: applicable.length - failures.length, failures, pass: applicable.length > 0 && failures.length === 0 });
  };

  add('S1', 'Missing indicator -> NOT_ASSESSABLE, score null, no renormalisation',
    results.filter(row => row.expectedMissing.length > 0).map(row => ({
      pharmacyId: row.pharmacyId,
      pass: row.status === 'NOT_ASSESSABLE' && row.score === null && row.tier === 'NOT_ASSESSABLE' &&
        JSON.stringify(row.missingIndicators) === JSON.stringify(row.expectedMissing),
    })));

  const byId = new Map(generateProfiles(seed).map(spec => [spec.pharmacyId, spec]));
  const criticalRows = results.filter(row => row.hasCriticalFinding);
  const criticalChecks = [];
  for (const row of criticalRows) {
    const spec = byId.get(row.pharmacyId);
    const { assessment } = await evaluateSpec({ ...spec, criticalFindings: [] });
    criticalChecks.push({
      pharmacyId: row.pharmacyId,
      pass: row.criticalEscalationRequired === true && assessment.score === row.score && assessment.tier === row.tier,
    });
  }
  add('S2', 'Critical finding -> escalation required regardless of score; score unchanged', criticalChecks);

  add('S3', 'No critical finding -> escalation not required',
    results.filter(row => !row.hasCriticalFinding).map(row => ({ pharmacyId: row.pharmacyId, pass: row.criticalEscalationRequired === false })));

  add('S4', 'Boundary profiles (80/60/40) -> exact score and tier',
    results.filter(row => row.boundary).map(row => ({
      pharmacyId: row.pharmacyId,
      pass: row.score !== null && Math.abs(row.score - row.boundary.target) <= 1e-9 && row.tier === row.boundary.tier,
    })));

  add('S5', 'Zero-value indicator is ASSESSABLE and distinct from NOT_ASSESSABLE',
    results.filter(row => row.archetype === 'zero-delivery').map(row => ({
      pharmacyId: row.pharmacyId,
      pass: row.values.delivery === 0 && row.status === 'ASSESSABLE' && row.score !== null,
    })));

  add('S6', 'All evidence SYNTHETIC; assessable scores labelled SYNTHETIC',
    results.map(row => ({
      pharmacyId: row.pharmacyId,
      pass: row.allEvidenceSynthetic && (row.status !== 'ASSESSABLE' || row.evidenceSource === 'SYNTHETIC'),
    })));

  const rerun = await evaluateScenarios(seed);
  const otherSeed = generateProfiles(seed + 1);
  add('S7', 'Determinism: same seed -> identical results; different seed -> different profiles', [
    { pharmacyId: `seed ${seed} rerun`, pass: JSON.stringify(rerun) === JSON.stringify(results) },
    { pharmacyId: `seed ${seed + 1} differs`, pass: JSON.stringify(otherSeed) !== JSON.stringify(generateProfiles(seed)) },
  ]);

  return checks;
}

module.exports = { SCENARIO_SEED, ARCHETYPES, BOUNDARY_PROFILES, generateProfiles, evaluateScenarios, runScenarioChecks };
