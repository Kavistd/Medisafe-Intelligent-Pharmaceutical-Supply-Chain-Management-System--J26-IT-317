'use strict';

// Live assessments over the rows of migrations/live/002_c3_live_seed.sql (SIMULATED data),
// evaluated at or after 2026-10-01T00:00:00Z unless stated otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTrustScore } = require('../../services/trustScore');
const { POLICY_V1, policyFromRow } = require('../../services/live/policy');
const { buildLiveAssessment, summarizeLiveAssessments } = require('../../services/live/liveAssessment');
const { STABLE_NOW, at, buildSeedRows, seedBundle } = require('./seedFixtures');

const assess = (code, now = STABLE_NOW) => buildLiveAssessment(seedBundle(code), { now });
const counts = (assessment, name) => [assessment.calculation[name].numerator, assessment.calculation[name].denominator];

test('Pharmacy C3-PH-A reproduces the worked example: 7/10, 9/12, 4/6, 16/20 -> 217/3, TRUSTED', () => {
  const a = assess('C3-PH-A');
  assert.deepEqual(counts(a, 'delivery'), [7, 10]);
  assert.deepEqual(counts(a, 'recall'), [9, 12]);
  assert.deepEqual(counts(a, 'complaint'), [4, 6]);
  assert.deepEqual(counts(a, 'inspection'), [16, 20]);
  assert.equal(a.calculation.inspection.inspectionRef, 'C3-IN-A02');
  assert.equal(a.breakdown.delivery.value, 70);
  assert.equal(a.breakdown.recall.value, 75);
  assert.ok(Math.abs(a.breakdown.complaint.value - 200 / 3) <= 1e-12);
  assert.equal(a.breakdown.inspection.value, 80);
  assert.equal(a.status, 'ASSESSABLE');
  assert.ok(Math.abs(a.score - 217 / 3) <= 1e-9);
  assert.equal(a.tier, 'TRUSTED');
  assert.equal(a.criticalEscalationRequired, false);
  assert.deepEqual(a.criticalEscalation.findings, []);
  // The DRAFT inspection with a critical item is ignored; the older FINAL is superseded.
  assert.deepEqual(a.calculation.inspection.excluded, [
    { id: 'C3-IN-A01', reason: 'SUPERSEDED_BY_LATER_FINAL_INSPECTION' },
    { id: 'C3-IN-A03', reason: 'DRAFT_INSPECTION' },
  ]);
});

test('Pharmacy C3-PH-A exclusions follow the design rules', () => {
  const a = assess('C3-PH-A');
  assert.ok(a.calculation.delivery.excluded.some(item => item.id === 'C3-DL-A11' && item.reason === 'NOT_ARRIVED_BY_EVALUATION_TIME'));
  assert.ok(a.calculation.delivery.successIds.includes('C3-DL-A03'), 'distributor-late, pharmacy on time -> success');
  assert.ok(a.calculation.delivery.notes.some(item => item.id === 'C3-DL-A03'));
  assert.ok(a.calculation.delivery.successIds.includes('C3-DL-A07'), 'confirmation at exactly 24 h is on time');
  assert.ok(a.calculation.delivery.failures.some(item => item.id === 'C3-DL-A09' && item.reason === 'NOT_CONFIRMED_WINDOW_ELAPSED'));
  assert.ok(a.calculation.recall.failures.some(item => item.reason === 'COMPLETED_AFTER_DUE'));
  for (const id of ['C3-CP-A07', 'C3-CP-A08']) {
    assert.ok(a.calculation.complaint.excluded.some(item => item.id === id && item.reason === 'UNSUBSTANTIATED'));
  }
  assert.ok(a.calculation.complaint.excluded.some(item => item.id === 'C3-CP-A09' && item.reason === 'NOT_SCREENED'));
  assert.equal(a.calculation.inspection.items.notApplicable.length, 2);
});

test('Pharmacy C3-PH-B is UNDER_REVIEW with a critical escalation kept separate from the score', () => {
  const b = assess('C3-PH-B');
  assert.deepEqual([counts(b, 'delivery'), counts(b, 'recall'), counts(b, 'complaint'), counts(b, 'inspection')],
    [[4, 8], [3, 8], [1, 3], [6, 12]]);
  assert.ok(Math.abs(b.score - (0.35 * 50 + 0.30 * 37.5 + 0.20 * (100 / 3) + 0.15 * 50)) <= 1e-9);
  assert.ok(Math.abs(b.score - 42.917) < 0.001);
  assert.equal(b.tier, 'UNDER_REVIEW');
  assert.equal(b.criticalEscalationRequired, true);
  assert.equal(b.criticalEscalation.findings.length, 1);
  assert.equal(b.criticalEscalation.findings[0].criterionCode, 'CONTROLLED_MEDICINES_LOCKED');
  // The same score without the finding: escalation never changes the score.
  const without = buildLiveAssessment({ ...seedBundle('C3-PH-B'), criticalFindings: [] }, { now: STABLE_NOW });
  assert.equal(without.score, b.score);
  assert.equal(without.criticalEscalationRequired, false);
});

test('Pharmacy C3-PH-C has no eligible recall actions and is NOT_ASSESSABLE with a null score', () => {
  const c = assess('C3-PH-C');
  assert.deepEqual(counts(c, 'delivery'), [5, 5]);
  assert.deepEqual(counts(c, 'recall'), [0, 0]);
  assert.equal(c.calculation.recall.status, 'NOT_ASSESSABLE');
  assert.deepEqual(counts(c, 'complaint'), [2, 2]);
  assert.deepEqual(counts(c, 'inspection'), [10, 10]);
  assert.equal(c.breakdown.recall.status, 'NOT_ASSESSABLE');
  assert.equal(c.breakdown.recall.value, null);
  assert.equal(c.status, 'NOT_ASSESSABLE');
  assert.equal(c.score, null);
  assert.equal(c.tier, 'NOT_ASSESSABLE');
  assert.deepEqual(c.missingIndicators.map(item => item.name), ['recall']);
});

test('worked example with C rounded to 66.67 gives 72.334 through the existing core', () => {
  const ind = (value, evidenceCount) => ({ status: 'ASSESSABLE', value, evidenceCount, source: 'SYNTHETIC' });
  const result = calculateTrustScore({ delivery: ind(70, 10), recall: ind(75, 12), complaint: ind(66.67, 6), inspection: ind(80, 1) });
  assert.ok(Math.abs(result.score - 72.334) <= 1e-9);
});

test('a score of 0 stays ASSESSABLE and distinct from NOT_ASSESSABLE', () => {
  const S = 'SEEDED_SIMULATED';
  const bundle = {
    pharmacy: { id: 'P0', pharmacy_code: 'C3-ZERO' },
    deliveries: [{ id: 'd', pharmacy_id: 'P0', expected_by: at(10), arrived_at: at(5), confirm_due_at: at(29), confirmed_at: null, evidence_class: S }],
    recallActions: [{ id: 'r', pharmacy_id: 'P0', issued_at: at(0), due_at: at(5), completed_at: null, evidence_class: S }],
    complaints: [{ id: 'c', pharmacy_id: 'P0', status: 'SUBSTANTIATED', screened_at: at(1), resolution_due_at: at(10), resolved_at: null, evidence_class: S }],
    inspections: [{ id: 'i', inspection_ref: 'i', pharmacy_id: 'P0', status: 'FINAL', inspected_at: at(1), finalised_at: at(2), evidence_class: S }],
    inspectionItems: [{ id: 'i:x', inspection_id: 'i', criterion_code: 'LICENCE_DISPLAYED', result: 'NON_COMPLIANT', critical: false, evidence_class: S }],
    criticalFindings: [],
  };
  const zero = buildLiveAssessment(bundle, { now: STABLE_NOW });
  assert.equal(zero.status, 'ASSESSABLE');
  assert.equal(zero.score, 0);
  assert.equal(zero.tier, 'ESCALATION_ALERT');
  const empty = buildLiveAssessment({ pharmacy: bundle.pharmacy }, { now: STABLE_NOW });
  assert.equal(empty.status, 'NOT_ASSESSABLE');
  assert.equal(empty.score, null);
  assert.deepEqual(empty.missingIndicators.map(item => item.name), ['delivery', 'recall', 'complaint', 'inspection']);
});

test('an earlier evaluation time excludes records that are not yet eligible', () => {
  const early = assess('C3-PH-A', at(100));
  assert.deepEqual(counts(early, 'delivery'), [2, 2]);
  assert.ok(early.calculation.delivery.excluded.some(item => item.id === 'C3-DL-A03' && item.reason === 'NOT_ARRIVED_BY_EVALUATION_TIME'));
  assert.deepEqual(counts(early, 'recall'), [3, 3]);
  assert.ok(early.calculation.recall.excluded.some(item => item.id === 'C3-RC-001:C3-PH-A:CLOSE' && item.reason === 'NOT_YET_DUE'));
  assert.ok(early.calculation.recall.excluded.some(item => item.reason === 'RECALL_ISSUED_AFTER_EVALUATION_TIME'));
  assert.deepEqual(counts(early, 'complaint'), [0, 0]);
  assert.ok(early.calculation.complaint.excluded.some(item => item.id === 'C3-CP-A01' && item.reason === 'RESOLUTION_NOT_YET_DUE'));
  assert.ok(early.calculation.complaint.excluded.some(item => item.id === 'C3-CP-A03' && item.reason === 'NOT_SCREENED_BY_EVALUATION_TIME'));
  assert.equal(early.calculation.inspection.inspectionRef, 'C3-IN-A01');
  assert.deepEqual(counts(early, 'inspection'), [2, 4]);
  assert.ok(early.calculation.inspection.excluded.some(item => item.id === 'C3-IN-A02' && item.reason === 'FINALISED_AFTER_EVALUATION_TIME'));
  assert.equal(early.status, 'NOT_ASSESSABLE');
  assert.deepEqual(early.missingIndicators.map(item => item.name), ['complaint']);
});

test('results are identical for any evaluation time on or after 2026-10-01', () => {
  for (const code of ['C3-PH-A', 'C3-PH-B', 'C3-PH-C']) {
    const strip = assessment => ({ ...assessment, asOf: null });
    assert.deepEqual(strip(assess(code)), strip(assess(code, new Date('2027-06-01T00:00:00Z'))), code);
  }
});

test('deterministic and does not mutate its inputs', () => {
  const bundle = seedBundle('C3-PH-B');
  const snapshot = structuredClone(bundle);
  const first = buildLiveAssessment(bundle, { now: STABLE_NOW });
  const second = buildLiveAssessment(bundle, { now: STABLE_NOW });
  assert.deepEqual(first, second);
  assert.deepEqual(bundle, snapshot);
});

test('the result is recomputable from the returned evidence ids', () => {
  for (const code of ['C3-PH-A', 'C3-PH-B']) {
    const bundle = seedBundle(code);
    const result = buildLiveAssessment(bundle, { now: STABLE_NOW });
    const ids = { delivery: bundle.deliveries, recall: bundle.recallActions, complaint: bundle.complaints };
    for (const name of ['delivery', 'recall', 'complaint']) {
      const detail = result.calculation[name];
      const known = new Set(ids[name].map(row => row.id));
      assert.ok(detail.eligibleIds.every(id => known.has(id)), `${code} ${name}: unknown evidence id`);
      assert.ok(detail.successIds.every(id => detail.eligibleIds.includes(id)));
      assert.deepEqual(detail.evidenceIds, detail.eligibleIds);
      assert.equal(detail.successIds.length + detail.failures.length, detail.eligibleIds.length);
      assert.equal(detail.eligibleIds.length + detail.excluded.length, ids[name].length);
      assert.equal(result.breakdown[name].value, 100 * detail.successIds.length / detail.eligibleIds.length);
    }
    const inspection = result.calculation.inspection;
    assert.deepEqual(inspection.evidenceIds, [inspection.inspectionId]);
    assert.equal(inspection.items.applicable.reduce((sum, item) => sum + item.points, 0), inspection.numerator);
    assert.equal(inspection.items.applicable.length, inspection.denominator);
  }
});

test('provenance is labelled honestly and REAL is never used', () => {
  const a = assess('C3-PH-A');
  assert.equal(a.evidenceSource, 'SYNTHETIC');
  assert.deepEqual(a.provenance.evidenceClasses, ['SEEDED_SIMULATED']);
  assert.equal(a.provenance.label, 'Seeded simulated data');
  assert.equal(a.provenance.realWorldVerified, false);
  assert.equal(a.blockchainVerification, 'NOT_PERFORMED');
  assert.ok(a.limitations.includes('Decision support, not a regulatory determination.'));
  assert.equal(a.policyLabel, 'proposed research parameters, not NMRA values');
  assert.doesNotMatch(JSON.stringify(a), /"REAL"/);

  const bundle = seedBundle('C3-PH-A');
  const prototype = { ...bundle, deliveries: bundle.deliveries.map(row => ({ ...row, evidence_class: 'PROTOTYPE_ENTRY' })) };
  const mixed = buildLiveAssessment(prototype, { now: STABLE_NOW });
  assert.deepEqual(mixed.provenance.evidenceClasses, ['PROTOTYPE_ENTRY', 'SEEDED_SIMULATED']);
  assert.match(mixed.provenance.label, /^Mixed/);
  assert.equal(mixed.evidenceSource, 'SYNTHETIC');
  assert.equal(mixed.score, a.score);
});

test('evaluation time is required and the policy must match the scoring core', () => {
  assert.throws(() => buildLiveAssessment(seedBundle('C3-PH-A'), {}), /now \(evaluation time\) is required/);
  assert.throws(() => buildLiveAssessment(seedBundle('C3-PH-A'), {
    now: STABLE_NOW, policy: { ...POLICY_V1, weights: { delivery: 0.25, recall: 0.25, complaint: 0.25, inspection: 0.25 } },
  }), /differs from the scoring core/);
});

test('policy rows from pg (numeric as strings) load to the v1 defaults', () => {
  const row = {
    version: 'v1', parameter_status: 'PROPOSED_RESEARCH_PARAMETERS',
    weight_delivery: '0.3500', weight_recall: '0.3000', weight_complaint: '0.2000', weight_inspection: '0.1500',
    tier_highly_trusted_min: '80.000', tier_trusted_min: '60.000', tier_under_review_min: '40.000',
    delivery_confirm_window_hours: 24, complaint_resolution_target_days: 30,
    inspection_points_compliant: '1.00', inspection_points_partial: '0.50', inspection_points_non_compliant: '0.00',
  };
  assert.deepEqual(policyFromRow(row), POLICY_V1);
  assert.throws(() => policyFromRow({ ...row, parameter_status: 'APPROVED' }), /PROPOSED_RESEARCH_PARAMETERS/);
  assert.throws(() => policyFromRow({ ...row, weight_delivery: '0.4000', weight_recall: '0.2500' }), /differs from the scoring core/);
});

test('regulator overview summaries cover every seeded pharmacy', () => {
  const rows = buildSeedRows();
  const summaries = summarizeLiveAssessments(['C3-PH-C', 'C3-PH-A', 'C3-PH-B'].map(code => seedBundle(code, rows)), { now: STABLE_NOW });
  assert.deepEqual(summaries.map(item => [item.pharmacyId, item.status, item.tier, item.criticalEscalationRequired]), [
    ['C3-PH-A', 'ASSESSABLE', 'TRUSTED', false],
    ['C3-PH-B', 'ASSESSABLE', 'UNDER_REVIEW', true],
    ['C3-PH-C', 'NOT_ASSESSABLE', 'NOT_ASSESSABLE', false],
  ]);
  assert.equal(summaries[2].score, null);
  assert.deepEqual(summaries[2].missingIndicators, ['recall']);
});
