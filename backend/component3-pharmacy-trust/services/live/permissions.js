'use strict';

/**
 * Authorization matrix for the Component 3 live system (docs/component3/LIVE_DESIGN.md,
 * decision 5). Pure and deny-by-default: an action is allowed only for an ACTIVE
 * principal whose role is listed, and, where the action is scoped, only for the
 * principal's own pharmacy (PHARMACY_USER) or own distributor (DISTRIBUTOR).
 * REGULATOR actions are not scoped. The UI may hide actions; this table enforces them.
 */
const ROLES = Object.freeze(['REGULATOR', 'PHARMACY_USER', 'DISTRIBUTOR']);

const ACTIONS = Object.freeze({
  'session.read': { roles: ['REGULATOR', 'PHARMACY_USER', 'DISTRIBUTOR'], scope: 'none' },
  'assessment.read': { roles: ['REGULATOR', 'PHARMACY_USER'], scope: 'pharmacy' },
  'evidence.read': { roles: ['REGULATOR', 'PHARMACY_USER'], scope: 'pharmacy' },
  'criticalFindings.read': { roles: ['REGULATOR', 'PHARMACY_USER'], scope: 'pharmacy' },
  'calculation.read': { roles: ['REGULATOR', 'PHARMACY_USER'], scope: 'pharmacy' },
  'overview.read': { roles: ['REGULATOR'], scope: 'none' },
  'auditLog.read': { roles: ['REGULATOR'], scope: 'none' },
  'criteria.read': { roles: ['REGULATOR'], scope: 'none' },
  'directory.read': { roles: ['REGULATOR', 'DISTRIBUTOR'], scope: 'none' },
  'workspace.regulator': { roles: ['REGULATOR'], scope: 'none' },
  'workspace.pharmacy': { roles: ['PHARMACY_USER'], scope: 'own' },
  'workspace.distributor': { roles: ['DISTRIBUTOR'], scope: 'own' },
  'delivery.create': { roles: ['DISTRIBUTOR'], scope: 'own' },
  'delivery.markArrived': { roles: ['DISTRIBUTOR'], scope: 'distributor' },
  'delivery.confirm': { roles: ['PHARMACY_USER'], scope: 'pharmacy' },
  'recallAction.complete': { roles: ['PHARMACY_USER'], scope: 'pharmacy' },
  'complaint.resolve': { roles: ['PHARMACY_USER'], scope: 'pharmacy' },
  'recall.issue': { roles: ['REGULATOR'], scope: 'none' },
  'complaint.log': { roles: ['REGULATOR'], scope: 'none' },
  'complaint.screen': { roles: ['REGULATOR'], scope: 'none' },
  'inspection.record': { roles: ['REGULATOR'], scope: 'none' },
  'inspection.finalize': { roles: ['REGULATOR'], scope: 'none' },
  'snapshot.finalize': { roles: ['REGULATOR'], scope: 'none' },
});

/** Role-level check only (no record scope): may this role attempt the action at all? */
function roleAllows(role, action) {
  const meta = ACTIONS[action];
  return Boolean(meta && meta.roles.includes(role));
}

function isActive(principal) {
  return Boolean(principal && principal.status === 'ACTIVE' && ROLES.includes(principal.role));
}

/** Full check. scope: { pharmacyId?, pharmacyCode?, distributorId? } describing the target record. */
function can(principal, action, scope = {}) {
  const meta = ACTIONS[action];
  if (!meta || !isActive(principal) || !meta.roles.includes(principal.role)) return false;
  if (principal.role === 'REGULATOR' || meta.scope === 'none' || meta.scope === 'own') return true;
  if (meta.scope === 'pharmacy') {
    if (principal.role !== 'PHARMACY_USER') return false;
    const byId = typeof scope.pharmacyId === 'string' && scope.pharmacyId === principal.pharmacyId;
    const byCode = typeof scope.pharmacyCode === 'string' && scope.pharmacyCode === principal.pharmacyCode;
    return byId || byCode;
  }
  if (meta.scope === 'distributor') {
    return principal.role === 'DISTRIBUTOR' && typeof scope.distributorId === 'string' && scope.distributorId === principal.distributorId;
  }
  return false;
}

/** Actions the principal's role may attempt (scope still applies per record). */
function allowedActions(principal) {
  if (!isActive(principal)) return [];
  return Object.keys(ACTIONS).filter(action => roleAllows(principal.role, action)).sort();
}

module.exports = { ROLES, ACTIONS, roleAllows, can, allowedActions, isActive };
