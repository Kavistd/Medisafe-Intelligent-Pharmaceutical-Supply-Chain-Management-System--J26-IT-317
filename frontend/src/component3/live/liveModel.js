/**
 * Pure view-model helpers for the live workspaces. The role and allowed actions come
 * only from the server's session response; the UI never chooses or overrides a role.
 * Hiding actions is a convenience; the API enforces every permission.
 * NOT_ASSESSABLE is always shown as "Not assessable", never as 0.
 */
export const INDICATORS = Object.freeze([
  Object.freeze({ key: 'delivery', label: 'Delivery reliability', letter: 'D', weight: 0.35 }),
  Object.freeze({ key: 'recall', label: 'Recall response', letter: 'R', weight: 0.30 }),
  Object.freeze({ key: 'complaint', label: 'Complaint handling', letter: 'C', weight: 0.20 }),
  Object.freeze({ key: 'inspection', label: 'Inspection', letter: 'I', weight: 0.15 }),
]);

export const TIER_LABELS = Object.freeze({
  HIGHLY_TRUSTED: 'Highly trusted',
  TRUSTED: 'Trusted',
  UNDER_REVIEW: 'Under review',
  ESCALATION_ALERT: 'Escalation alert',
  NOT_ASSESSABLE: 'Not assessable',
});

const REASON_TEXT = Object.freeze({
  NOT_ARRIVED_BY_EVALUATION_TIME: 'Not yet arrived',
  CONFIRMATION_WINDOW_NOT_YET_ELAPSED: 'Confirmation window still open',
  CONFIRMED_AFTER_WINDOW: 'Confirmed after the 24-hour window',
  NOT_CONFIRMED_WINDOW_ELAPSED: 'Not confirmed within the 24-hour window',
  DISTRIBUTOR_LATE_NOT_A_PHARMACY_FAILURE: 'Distributor arrived late (not counted against the pharmacy)',
  RECALL_ISSUED_AFTER_EVALUATION_TIME: 'Recall issued after the evaluation time',
  NOT_YET_DUE: 'Not yet due',
  COMPLETED_AFTER_DUE: 'Completed after the due time',
  NOT_COMPLETED_PAST_DUE: 'Not completed and past due',
  NOT_SCREENED: 'Not yet screened',
  UNSUBSTANTIATED: 'Unsubstantiated (never counted)',
  NOT_SCREENED_BY_EVALUATION_TIME: 'Screened after the evaluation time',
  RESOLUTION_NOT_YET_DUE: 'Resolution not yet due',
  RESOLVED_AFTER_DUE: 'Resolved after the due date',
  NOT_RESOLVED_PAST_DUE: 'Not resolved and past due',
  DRAFT_INSPECTION: 'Draft inspection (not counted)',
  FINALISED_AFTER_EVALUATION_TIME: 'Finalised after the evaluation time',
  SUPERSEDED_BY_LATER_FINAL_INSPECTION: 'Superseded by a later final inspection',
  NOT_APPLICABLE: 'Not applicable (excluded)',
});

const ROLE_WORKSPACES = Object.freeze({ REGULATOR: 'regulator', PHARMACY_USER: 'pharmacy', DISTRIBUTOR: 'distributor' });

/** Workspace for the server-resolved session; null (fail closed) for anything unexpected. */
export function workspaceForSession(session) {
  if (!session || typeof session !== 'object' || session.status !== 'ACTIVE') return null;
  return ROLE_WORKSPACES[session.role] || null;
}

export function canDo(session, action) {
  return Boolean(session && Array.isArray(session.allowedActions) && session.allowedActions.includes(action));
}

/** Keep only the UI actions the session's allowedActions list contains. */
export function visibleActions(session, actions) {
  return (Array.isArray(actions) ? actions : []).filter(item => item && canDo(session, item.action));
}

export function reasonText(code) {
  return REASON_TEXT[code] || 'Excluded';
}

const isAssessable = (status, value) => status === 'ASSESSABLE' && typeof value === 'number' && Number.isFinite(value);
const count = value => (Number.isInteger(value) ? String(value) : Number(value).toFixed(1));

export function scoreText(status, score) {
  return isAssessable(status, score) ? score.toFixed(1) : 'Not assessable';
}

export function tierText(status, tier) {
  return status === 'ASSESSABLE' && TIER_LABELS[tier] && tier !== 'NOT_ASSESSABLE' ? TIER_LABELS[tier] : 'Not assessable';
}

/** One indicator row for the "how this score was calculated" panel. */
export function indicatorView(calculationData, key) {
  const meta = INDICATORS.find(item => item.key === key);
  const detail = calculationData?.calculation?.[key] || null;
  const breakdown = calculationData?.breakdown?.[key] || null;
  if (!meta) throw new Error(`Unknown indicator ${key}.`);
  if (!detail) {
    return { ...meta, weightText: meta.weight.toFixed(2), status: 'UNAVAILABLE', assessable: false, fractionText: 'Unavailable', valueText: 'Unavailable', formula: '', excluded: [], failures: [], notes: [] };
  }
  const assessable = detail.status === 'ASSESSABLE' && detail.denominator > 0 && isAssessable(breakdown?.status, breakdown?.value);
  return {
    ...meta,
    weightText: meta.weight.toFixed(2),
    status: detail.status,
    assessable,
    numerator: detail.numerator,
    denominator: detail.denominator,
    fractionText: detail.denominator > 0 ? `${count(detail.numerator)}/${count(detail.denominator)}` : 'No eligible records',
    valueText: assessable ? `${breakdown.value.toFixed(1)}%` : 'Not assessable',
    contributionText: assessable && typeof breakdown.weightedContribution === 'number' ? breakdown.weightedContribution.toFixed(2) : '—',
    formula: detail.formula || '',
    excluded: (detail.excluded || []).map(item => ({ id: item.id, reason: reasonText(item.reason) })),
    failures: (detail.failures || []).map(item => ({ id: item.id, reason: reasonText(item.reason) })),
    notes: (detail.notes || []).map(item => ({ id: item.id, reason: reasonText(item.note) })),
    notApplicable: (detail.items?.notApplicable || []).length,
  };
}

export function calculationView(calculationData) {
  return {
    pharmacyId: calculationData?.pharmacyId || '',
    asOf: calculationData?.asOf || null,
    scoreText: scoreText(calculationData?.status, calculationData?.score),
    tierText: tierText(calculationData?.status, calculationData?.tier),
    status: calculationData?.status === 'ASSESSABLE' ? 'ASSESSABLE' : 'NOT_ASSESSABLE',
    criticalEscalationRequired: calculationData?.criticalEscalationRequired === true,
    missing: (calculationData?.missingIndicators || []).map(item => INDICATORS.find(meta => meta.key === item.name)?.label || item.name),
    indicators: INDICATORS.map(meta => indicatorView(calculationData, meta.key)),
    policyLabel: calculationData?.policyLabel || 'proposed research parameters, not NMRA values',
  };
}

/** Regulator overview row: summary plus per-indicator fractions when the calculation loaded. */
export function regulatorRow(summary, calculationData) {
  const indicators = INDICATORS.map(meta => {
    if (!calculationData) return { letter: meta.letter, text: 'Unavailable' };
    const view = indicatorView(calculationData, meta.key);
    return { letter: meta.letter, text: view.assessable ? view.fractionText : 'Not assessable' };
  });
  return {
    pharmacyId: summary.pharmacyId,
    scoreText: scoreText(summary.status, summary.score),
    tierText: tierText(summary.status, summary.tier),
    criticalEscalationRequired: summary.criticalEscalationRequired === true,
    indicators,
  };
}

const DISTRIBUTOR_FIELDS = Object.freeze(['id', 'delivery_ref', 'pharmacy_code', 'status', 'dispatched_at', 'expected_by', 'arrived_at', 'confirmation_status', 'confirmed_at']);

/** Distributor rows: an explicit allow-list, so no score, tier or assessment field can appear. */
export function distributorDeliveryRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => Object.fromEntries(DISTRIBUTOR_FIELDS.map(key => [key, row?.[key] ?? null])))
    .map(row => ({ ...row, canMarkArrived: row.status === 'DISPATCHED' }));
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}
