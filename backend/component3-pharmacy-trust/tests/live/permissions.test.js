'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, ACTIONS, roleAllows, can, allowedActions } = require('../../services/live/permissions');

// The authorization matrix of docs/component3/LIVE_DESIGN.md (decision 5), written out independently.
const R = 'REGULATOR';
const P = 'PHARMACY_USER';
const D = 'DISTRIBUTOR';
const EXPECTED = {
  'session.read': [R, P, D],
  'assessment.read': [R, P],
  'evidence.read': [R, P],
  'criticalFindings.read': [R, P],
  'calculation.read': [R, P],
  'overview.read': [R],
  'auditLog.read': [R],
  'criteria.read': [R],
  'directory.read': [R, D],
  'workspace.regulator': [R],
  'workspace.pharmacy': [P],
  'workspace.distributor': [D],
  'delivery.create': [D],
  'delivery.markArrived': [D],
  'delivery.confirm': [P],
  'recallAction.complete': [P],
  'complaint.resolve': [P],
  'recall.issue': [R],
  'complaint.log': [R],
  'complaint.screen': [R],
  'inspection.record': [R],
  'inspection.finalize': [R],
  'snapshot.finalize': [R],
};

const principal = (role, extra = {}) => ({ userId: 'u', role, status: 'ACTIVE', pharmacyId: null, pharmacyCode: null, distributorId: null, ...extra });

test('the matrix covers exactly the designed actions', () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), Object.keys(EXPECTED).sort());
  assert.deepEqual([...ROLES].sort(), [D, P, R]);
});

test('every role x every action: allowed exactly where the design allows it', () => {
  let checks = 0;
  for (const [action, roles] of Object.entries(EXPECTED)) {
    for (const role of ROLES) {
      assert.equal(roleAllows(role, action), roles.includes(role), `${role} ${action}`);
      checks += 1;
    }
  }
  assert.equal(checks, Object.keys(EXPECTED).length * 3);
});

test('a distributor can never read trust scores, evidence or findings', () => {
  for (const action of ['assessment.read', 'evidence.read', 'criticalFindings.read', 'calculation.read', 'overview.read']) {
    assert.equal(can(principal(D, { distributorId: 'd1' }), action, { pharmacyCode: 'C3-PH-A' }), false, action);
  }
});

test('pharmacy users are limited to their own pharmacy', () => {
  const user = principal(P, { pharmacyId: 'pA', pharmacyCode: 'C3-PH-A' });
  assert.equal(can(user, 'assessment.read', { pharmacyCode: 'C3-PH-A' }), true);
  assert.equal(can(user, 'assessment.read', { pharmacyCode: 'C3-PH-B' }), false);
  assert.equal(can(user, 'delivery.confirm', { pharmacyId: 'pA' }), true);
  assert.equal(can(user, 'delivery.confirm', { pharmacyId: 'pB' }), false);
  assert.equal(can(user, 'delivery.confirm', {}), false, 'scoped actions deny without a scope');
});

test('distributors are limited to their own deliveries', () => {
  const user = principal(D, { distributorId: 'd1' });
  assert.equal(can(user, 'delivery.markArrived', { distributorId: 'd1' }), true);
  assert.equal(can(user, 'delivery.markArrived', { distributorId: 'd2' }), false);
  assert.equal(can(user, 'delivery.markArrived', {}), false);
  assert.equal(can(user, 'delivery.create'), true);
});

test('regulators are not pharmacy-scoped', () => {
  const regulator = principal(R);
  assert.equal(can(regulator, 'assessment.read', { pharmacyCode: 'C3-PH-B' }), true);
  assert.equal(can(regulator, 'snapshot.finalize'), true);
  assert.equal(can(regulator, 'delivery.confirm', { pharmacyId: 'pA' }), false);
});

test('deny by default: suspended, missing, unknown role or unknown action', () => {
  assert.equal(can(principal(R, { status: 'SUSPENDED' }), 'overview.read'), false);
  assert.equal(can(null, 'session.read'), false);
  assert.equal(can(principal('ADMIN'), 'session.read'), false);
  assert.equal(can(principal(R), 'records.delete'), false);
  assert.deepEqual(allowedActions(principal(R, { status: 'SUSPENDED' })), []);
  assert.ok(allowedActions(principal(P)).includes('delivery.confirm'));
  assert.ok(!allowedActions(principal(P)).includes('recall.issue'));
});
