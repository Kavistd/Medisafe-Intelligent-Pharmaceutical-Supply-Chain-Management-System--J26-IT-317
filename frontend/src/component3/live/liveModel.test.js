import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDICATORS, calculationView, canDo, distributorDeliveryRows, indicatorView, reasonText, regulatorRow,
  scoreText, tierText, visibleActions, workspaceForSession,
} from './liveModel.js';

// Calculation route payloads in the shape returned by the live API (simulated values).
const detail = (numerator, denominator, extra = {}) => ({
  status: denominator > 0 ? 'ASSESSABLE' : 'NOT_ASSESSABLE', numerator, denominator, formula: 'F', excluded: [], failures: [], notes: [], evidenceIds: [], ...extra,
});
const breakdown = value => (value === null
  ? { status: 'NOT_ASSESSABLE', value: null, weight: 0.3, weightedContribution: null }
  : { status: 'ASSESSABLE', value, weight: 0.35, weightedContribution: value * 0.35 });
const ASSESSABLE = {
  pharmacyId: 'C3-PH-A', status: 'ASSESSABLE', score: 217 / 3, tier: 'TRUSTED', missingIndicators: [], criticalEscalationRequired: false,
  breakdown: { delivery: breakdown(70), recall: breakdown(75), complaint: breakdown(200 / 3), inspection: breakdown(80) },
  calculation: {
    delivery: detail(7, 10, { excluded: [{ id: 'd11', reason: 'NOT_ARRIVED_BY_EVALUATION_TIME' }], failures: [{ id: 'd9', reason: 'NOT_CONFIRMED_WINDOW_ELAPSED' }] }),
    recall: detail(9, 12), complaint: detail(4, 6), inspection: detail(16, 20, { items: { notApplicable: [{ id: 'x' }, { id: 'y' }] } }),
  },
};
const NOT_ASSESSABLE = {
  ...ASSESSABLE, pharmacyId: 'C3-PH-C', status: 'NOT_ASSESSABLE', score: null, tier: 'NOT_ASSESSABLE', missingIndicators: [{ name: 'recall' }],
  breakdown: { ...ASSESSABLE.breakdown, recall: breakdown(null) },
  calculation: { ...ASSESSABLE.calculation, recall: detail(0, 0) },
};

test('the workspace is chosen only from the server-resolved session', () => {
  assert.equal(workspaceForSession({ role: 'REGULATOR', status: 'ACTIVE' }), 'regulator');
  assert.equal(workspaceForSession({ role: 'PHARMACY_USER', status: 'ACTIVE' }), 'pharmacy');
  assert.equal(workspaceForSession({ role: 'DISTRIBUTOR', status: 'ACTIVE' }), 'distributor');
  for (const session of [null, undefined, {}, { role: 'REGULATOR', status: 'SUSPENDED' }, { role: null, status: 'NO_ROLE' }, { role: 'ADMIN', status: 'ACTIVE' }]) {
    assert.equal(workspaceForSession(session), null, JSON.stringify(session));
  }
});

test('actions are shown only when the session allows them', () => {
  const session = { role: 'PHARMACY_USER', status: 'ACTIVE', allowedActions: ['delivery.confirm', 'session.read'] };
  assert.equal(canDo(session, 'delivery.confirm'), true);
  assert.equal(canDo(session, 'recall.issue'), false);
  assert.equal(canDo({ allowedActions: 'recall.issue' }, 'recall.issue'), false);
  assert.equal(canDo(null, 'session.read'), false);
  const tabs = [{ id: 'a', action: 'delivery.confirm' }, { id: 'b', action: 'recall.issue' }, null];
  assert.deepEqual(visibleActions(session, tabs).map(item => item.id), ['a']);
  assert.deepEqual(visibleActions({ allowedActions: [] }, tabs), []);
});

test('NOT_ASSESSABLE is never rendered as 0, while a real 0 stays a number', () => {
  assert.equal(scoreText('NOT_ASSESSABLE', null), 'Not assessable');
  assert.equal(scoreText('NOT_ASSESSABLE', 0), 'Not assessable');
  assert.equal(scoreText('ASSESSABLE', null), 'Not assessable');
  assert.equal(scoreText('ASSESSABLE', 0), '0.0');
  assert.equal(tierText('NOT_ASSESSABLE', 'NOT_ASSESSABLE'), 'Not assessable');
  assert.equal(tierText('ASSESSABLE', 'UNDER_REVIEW'), 'Under review');

  const view = calculationView(NOT_ASSESSABLE);
  assert.equal(view.scoreText, 'Not assessable');
  assert.equal(view.tierText, 'Not assessable');
  assert.deepEqual(view.missing, ['Recall response']);
  const recall = view.indicators.find(item => item.key === 'recall');
  assert.equal(recall.fractionText, 'No eligible records');
  assert.equal(recall.valueText, 'Not assessable');
  assert.equal(recall.contributionText, '—');
  assert.doesNotMatch(JSON.stringify(view), /"0(\.0)?%?"/);
  const row = regulatorRow({ pharmacyId: 'C3-PH-C', status: 'NOT_ASSESSABLE', score: null, tier: 'NOT_ASSESSABLE', criticalEscalationRequired: false }, NOT_ASSESSABLE);
  assert.equal(row.scoreText, 'Not assessable');
  assert.equal(row.indicators.find(item => item.letter === 'R').text, 'Not assessable');
});

test('the calculation view shows fractions, weights 0.35/0.30/0.20/0.15 and excluded reasons', () => {
  assert.deepEqual(INDICATORS.map(item => item.weight), [0.35, 0.30, 0.20, 0.15]);
  const view = calculationView(ASSESSABLE);
  assert.equal(view.scoreText, '72.3');
  assert.equal(view.tierText, 'Trusted');
  assert.deepEqual(view.indicators.map(item => [item.letter, item.weightText, item.fractionText, item.valueText]), [
    ['D', '0.35', '7/10', '70.0%'], ['R', '0.30', '9/12', '75.0%'], ['C', '0.20', '4/6', '66.7%'], ['I', '0.15', '16/20', '80.0%'],
  ]);
  const delivery = indicatorView(ASSESSABLE, 'delivery');
  assert.deepEqual(delivery.excluded, [{ id: 'd11', reason: 'Not yet arrived' }]);
  assert.deepEqual(delivery.failures, [{ id: 'd9', reason: 'Not confirmed within the 24-hour window' }]);
  assert.equal(indicatorView(ASSESSABLE, 'inspection').notApplicable, 2);
  assert.equal(reasonText('UNSUBSTANTIATED'), 'Unsubstantiated (never counted)');
  assert.equal(reasonText('SOMETHING_NEW'), 'Excluded');
  const row = regulatorRow({ pharmacyId: 'C3-PH-A', status: 'ASSESSABLE', score: 217 / 3, tier: 'TRUSTED', criticalEscalationRequired: true }, ASSESSABLE);
  assert.deepEqual(row.indicators.map(item => item.text), ['7/10', '9/12', '4/6', '16/20']);
  assert.equal(row.criticalEscalationRequired, true);
  assert.deepEqual(regulatorRow({ pharmacyId: 'X', status: 'ASSESSABLE', score: 50, tier: 'UNDER_REVIEW' }, null).indicators.map(item => item.text),
    ['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable']);
});

test('the distributor view model contains no score or assessment fields', () => {
  const rows = distributorDeliveryRows([{
    id: 'd1', delivery_ref: 'C3-DL-1', pharmacy_code: 'C3-PH-A', status: 'DISPATCHED', dispatched_at: 't', expected_by: 't',
    arrived_at: null, confirmation_status: null, confirmed_at: null,
    score: 72.3, tier: 'TRUSTED', breakdown: {}, assessment: {}, criticalEscalationRequired: true, trust: 'x',
  }]);
  assert.equal(rows.length, 1);
  for (const key of Object.keys(rows[0])) assert.doesNotMatch(key, /score|tier|assessment|breakdown|escalation|trust/i, key);
  assert.equal(rows[0].canMarkArrived, true);
  assert.equal(distributorDeliveryRows([{ status: 'ARRIVED' }])[0].canMarkArrived, false);
  assert.deepEqual(distributorDeliveryRows(null), []);
});
