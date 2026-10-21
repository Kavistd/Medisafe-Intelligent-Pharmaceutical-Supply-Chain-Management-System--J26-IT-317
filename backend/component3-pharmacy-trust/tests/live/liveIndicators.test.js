'use strict';

// Unit tests of the pure live indicator rules on small hand-built c3 rows (simulated).
const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_V1 } = require('../../services/live/policy');
const {
  computeDelivery, computeRecall, computeComplaints, computeInspection,
} = require('../../services/live/liveIndicators');

const T0 = Date.parse('2026-08-01T00:00:00Z');
const h = hours => new Date(T0 + hours * 3600 * 1000);
const SEEDED = 'SEEDED_SIMULATED';

function delivery(id, { expected, arrived, confirmed = null }) {
  return {
    id, pharmacy_id: 'P', dispatched_at: h(0), expected_by: h(expected), arrived_at: arrived === null ? null : h(arrived),
    confirm_due_at: arrived === null ? null : h(arrived + 24), confirmed_at: confirmed === null ? null : h(confirmed),
    evidence_class: SEEDED,
  };
}

test('delivery: distributor-late but pharmacy-on-time is a success, noted but not a pharmacy failure', () => {
  const result = computeDelivery([delivery('D1', { expected: 10, arrived: 30, confirmed: 40 })], POLICY_V1, h(200));
  assert.equal(result.status, 'ASSESSABLE');
  assert.deepEqual([result.numerator, result.denominator], [1, 1]);
  assert.deepEqual(result.notes, [{ id: 'D1', note: 'DISTRIBUTOR_LATE_NOT_A_PHARMACY_FAILURE' }]);
});

test('delivery: window boundary, late confirmation, unconfirmed after window, unconfirmed within window, not arrived', () => {
  const rows = [
    delivery('D1', { expected: 30, arrived: 20, confirmed: 44 }),
    delivery('D2', { expected: 30, arrived: 20, confirmed: 45 }),
    delivery('D3', { expected: 30, arrived: 20 }),
    delivery('D4', { expected: 120, arrived: 90 }),
    delivery('D5', { expected: 150, arrived: null }),
  ];
  const result = computeDelivery(rows, POLICY_V1, h(100));
  assert.deepEqual(result.successIds, ['D1']);
  assert.deepEqual(result.failures, [
    { id: 'D2', reason: 'CONFIRMED_AFTER_WINDOW' },
    { id: 'D3', reason: 'NOT_CONFIRMED_WINDOW_ELAPSED' },
  ]);
  assert.deepEqual(result.excluded, [
    { id: 'D4', reason: 'CONFIRMATION_WINDOW_NOT_YET_ELAPSED' },
    { id: 'D5', reason: 'NOT_ARRIVED_BY_EVALUATION_TIME' },
  ]);
  assert.deepEqual([result.numerator, result.denominator], [1, 3]);
});

test('delivery: the stored confirm_due_at is required, never re-derived', () => {
  const row = { ...delivery('D1', { expected: 30, arrived: 20, confirmed: 30 }), confirm_due_at: null };
  assert.throws(() => computeDelivery([row], POLICY_V1, h(100)), /confirm_due_at is required/);
});

test('recall: late completion is a failure, not-yet-due is excluded, a zero denominator is NOT_ASSESSABLE', () => {
  const action = (id, due, completed, issued = 0) => ({
    id, issued_at: h(issued), due_at: h(due), completed_at: completed === null ? null : h(completed), evidence_class: SEEDED,
  });
  const result = computeRecall([action('R1', 24, 20), action('R2', 24, 30), action('R3', 24, null), action('R4', 500, null), action('R5', 900, null, 800)], POLICY_V1, h(100));
  assert.deepEqual(result.successIds, ['R1']);
  assert.deepEqual(result.failures, [{ id: 'R2', reason: 'COMPLETED_AFTER_DUE' }, { id: 'R3', reason: 'NOT_COMPLETED_PAST_DUE' }]);
  assert.deepEqual(result.excluded, [{ id: 'R4', reason: 'NOT_YET_DUE' }, { id: 'R5', reason: 'RECALL_ISSUED_AFTER_EVALUATION_TIME' }]);

  const empty = computeRecall([], POLICY_V1, h(100));
  assert.equal(empty.status, 'NOT_ASSESSABLE');
  assert.deepEqual([empty.numerator, empty.denominator], [0, 0]);
  assert.match(empty.reason, /never scored as 0 or 100/);
});

test('complaints: unsubstantiated and unscreened never count; resolution_due_at is used as stored', () => {
  const complaint = (id, status, { screened = null, due = null, resolved = null } = {}) => ({
    id, status, logged_at: h(0), screened_at: screened === null ? null : h(screened),
    resolution_due_at: due === null ? null : h(due), resolved_at: resolved === null ? null : h(resolved), evidence_class: SEEDED,
  });
  const result = computeComplaints([
    complaint('C1', 'RESOLVED', { screened: 10, due: 50, resolved: 40 }),
    complaint('C2', 'RESOLVED', { screened: 10, due: 50, resolved: 60 }),
    complaint('C3', 'SUBSTANTIATED', { screened: 10, due: 50 }),
    complaint('C4', 'SUBSTANTIATED', { screened: 10, due: 500 }),
    complaint('C5', 'UNSUBSTANTIATED', { screened: 10 }),
    complaint('C6', 'LOGGED'),
  ], POLICY_V1, h(100));
  assert.deepEqual([result.numerator, result.denominator], [1, 3]);
  assert.deepEqual(result.excluded, [
    { id: 'C4', reason: 'RESOLUTION_NOT_YET_DUE' },
    { id: 'C5', reason: 'UNSUBSTANTIATED' },
    { id: 'C6', reason: 'NOT_SCREENED' },
  ]);
});

test('inspection: latest FINAL only, drafts ignored, N/A excluded, findings only from the latest FINAL', () => {
  const inspections = [
    { id: 'I-OLD', inspection_ref: 'I-OLD', status: 'FINAL', inspected_at: h(10), finalised_at: h(12), evidence_class: SEEDED },
    { id: 'I-NEW', inspection_ref: 'I-NEW', status: 'FINAL', inspected_at: h(50), finalised_at: h(60), evidence_class: SEEDED },
    { id: 'I-DRAFT', inspection_ref: 'I-DRAFT', status: 'DRAFT', inspected_at: h(90), finalised_at: null, evidence_class: SEEDED },
  ];
  const item = (inspection, code, result) => ({ id: `${inspection}:${code}`, inspection_id: inspection, criterion_code: code, result, evidence_class: SEEDED });
  const items = [
    item('I-OLD', 'A', 'NON_COMPLIANT'),
    item('I-NEW', 'A', 'COMPLIANT'), item('I-NEW', 'B', 'PARTIAL'), item('I-NEW', 'C', 'NON_COMPLIANT'), item('I-NEW', 'D', 'NOT_APPLICABLE'),
    item('I-DRAFT', 'A', 'NON_COMPLIANT'),
  ];
  const findings = [
    { id: 'F-OLD', inspection_id: 'I-OLD', criterion_code: 'A', raised_at: h(12), evidence_class: SEEDED },
    { id: 'F-NEW', inspection_id: 'I-NEW', criterion_code: 'C', raised_at: h(60), evidence_class: SEEDED },
  ];
  const result = computeInspection({ inspections, items, criticalFindings: findings }, POLICY_V1, h(100));
  assert.equal(result.inspectionId, 'I-NEW');
  assert.deepEqual([result.numerator, result.denominator], [1.5, 3]);
  assert.deepEqual(result.items.notApplicable, [{ id: 'I-NEW:D', reason: 'NOT_APPLICABLE' }]);
  assert.deepEqual(result.excluded, [
    { id: 'I-DRAFT', reason: 'DRAFT_INSPECTION' },
    { id: 'I-OLD', reason: 'SUPERSEDED_BY_LATER_FINAL_INSPECTION' },
  ]);
  assert.deepEqual(result.criticalFindings.map(finding => finding.id), ['F-NEW']);
  assert.deepEqual(result.evidenceIds, ['I-NEW']);

  const none = computeInspection({ inspections: [inspections[2]], items, criticalFindings: [] }, POLICY_V1, h(100));
  assert.equal(none.status, 'NOT_ASSESSABLE');
  assert.deepEqual(none.evidenceIds, []);
  assert.deepEqual(none.criticalFindings, []);
});

test('evaluation time must be injected and valid; ISO strings are accepted', () => {
  assert.throws(() => computeRecall([], POLICY_V1), /now \(evaluation time\) is required/);
  assert.throws(() => computeRecall([], POLICY_V1, 'not-a-date'), /valid timestamp/);
  assert.equal(computeRecall([], POLICY_V1, '2026-10-01T00:00:00Z').status, 'NOT_ASSESSABLE');
});

test('unknown evidence classes are rejected', () => {
  const row = { ...delivery('D1', { expected: 30, arrived: 20, confirmed: 30 }), evidence_class: 'REAL' };
  assert.throws(() => computeDelivery([row], POLICY_V1, h(100)), /unknown evidence_class/);
});
