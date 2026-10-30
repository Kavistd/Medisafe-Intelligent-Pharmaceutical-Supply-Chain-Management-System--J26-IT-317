'use strict';

/**
 * Pure D/R/C/I calculations for the Component 3 live prototype
 * (docs/component3/LIVE_DESIGN.md, decision 4). Inputs are c3 rows (snake_case
 * columns as returned by pg), the policy and an injected evaluation time `now`;
 * the clock is never read here. Database-derived columns are used as stored:
 * deliveries.confirm_due_at, complaints.resolution_due_at and c3.critical_findings.
 * A zero denominator is NOT_ASSESSABLE, never 0 or 100.
 */
const EVIDENCE_CLASSES = new Set(['SEEDED_SIMULATED', 'PROTOTYPE_ENTRY']);

const FORMULAS = Object.freeze({
  delivery: 'D = 100 × deliveries confirmed by the pharmacy within the confirmation window ÷ arrived deliveries that are confirmed or past the window',
  recall: 'R = 100 × recall actions completed by their due time ÷ recall actions that are completed or past due',
  complaint: 'C = 100 × substantiated complaints resolved by their due date ÷ substantiated complaints that are resolved or past due',
  inspection: 'I = 100 × points achieved ÷ maximum applicable points on the latest FINAL inspection (COMPLIANT 1, PARTIAL 0.5, NON_COMPLIANT 0; NOT_APPLICABLE excluded)',
});

function toMs(value, label, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp.`);
  return ms;
}

function evaluationTime(now) {
  return toMs(now, 'now (evaluation time)', { required: true });
}

function idOf(row, label) {
  if (!row || typeof row !== 'object') throw new Error(`${label} rows must be objects.`);
  if (typeof row.id !== 'string' || row.id.length === 0) throw new Error(`${label} rows require a string id.`);
  return row.id;
}

function evidenceClassOf(row, label) {
  if (!EVIDENCE_CLASSES.has(row.evidence_class)) throw new Error(`${label} ${row.id} has an unknown evidence_class.`);
  return row.evidence_class;
}

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

function countResult(indicator, { eligible, successes, failures, excluded, notes = [], classes }) {
  const denominator = eligible.length;
  return {
    indicator,
    status: denominator > 0 ? 'ASSESSABLE' : 'NOT_ASSESSABLE',
    numerator: successes.length,
    denominator,
    formula: FORMULAS[indicator],
    eligibleIds: eligible.map(item => item.id),
    successIds: successes.map(item => item.id),
    failures,
    excluded,
    notes,
    evidenceIds: eligible.map(item => item.id),
    evidenceClasses: [...new Set(classes)].sort(),
    reason: denominator > 0 ? null : 'No eligible records at the evaluation time; the indicator is not assessable (never scored as 0 or 100).',
  };
}

/** D: pharmacy confirmation of arrived deliveries within the stored confirmation window. */
function computeDelivery(rows, policy, now) {
  const t = evaluationTime(now);
  const eligible = []; const successes = []; const failures = []; const excluded = []; const notes = []; const classes = [];
  for (const row of [...rows].sort(byId)) {
    const id = idOf(row, 'Delivery');
    const arrived = toMs(row.arrived_at, `Delivery ${id} arrived_at`);
    if (arrived === null || arrived > t) {
      excluded.push({ id, reason: 'NOT_ARRIVED_BY_EVALUATION_TIME' });
      continue;
    }
    const due = toMs(row.confirm_due_at, `Delivery ${id} confirm_due_at`, { required: true });
    const confirmedAt = toMs(row.confirmed_at, `Delivery ${id} confirmed_at`);
    const confirmed = confirmedAt !== null && confirmedAt <= t;
    if (!confirmed && due > t) {
      excluded.push({ id, reason: 'CONFIRMATION_WINDOW_NOT_YET_ELAPSED' });
      continue;
    }
    const expectedBy = toMs(row.expected_by, `Delivery ${id} expected_by`);
    if (expectedBy !== null && arrived > expectedBy) {
      notes.push({ id, note: 'DISTRIBUTOR_LATE_NOT_A_PHARMACY_FAILURE' });
    }
    eligible.push({ id });
    classes.push(evidenceClassOf(row, 'Delivery'));
    if (confirmed && confirmedAt <= due) successes.push({ id });
    else failures.push({ id, reason: confirmed ? 'CONFIRMED_AFTER_WINDOW' : 'NOT_CONFIRMED_WINDOW_ELAPSED' });
  }
  return countResult('delivery', { eligible, successes, failures, excluded, notes, classes });
}

/** R: each recall action is a success when completed by its due time. */
function computeRecall(rows, policy, now) {
  const t = evaluationTime(now);
  const eligible = []; const successes = []; const failures = []; const excluded = []; const classes = [];
  for (const row of [...rows].sort(byId)) {
    const id = idOf(row, 'Recall action');
    const issued = toMs(row.issued_at, `Recall action ${id} issued_at`);
    if (issued !== null && issued > t) {
      excluded.push({ id, reason: 'RECALL_ISSUED_AFTER_EVALUATION_TIME' });
      continue;
    }
    const due = toMs(row.due_at, `Recall action ${id} due_at`, { required: true });
    const completedAt = toMs(row.completed_at, `Recall action ${id} completed_at`);
    const completed = completedAt !== null && completedAt <= t;
    if (!completed && due > t) {
      excluded.push({ id, reason: 'NOT_YET_DUE' });
      continue;
    }
    eligible.push({ id });
    classes.push(evidenceClassOf(row, 'Recall action'));
    if (completed && completedAt <= due) successes.push({ id });
    else failures.push({ id, reason: completed ? 'COMPLETED_AFTER_DUE' : 'NOT_COMPLETED_PAST_DUE' });
  }
  return countResult('recall', { eligible, successes, failures, excluded, classes });
}

/** C: substantiated complaints resolved by the stored resolution_due_at. */
function computeComplaints(rows, policy, now) {
  const t = evaluationTime(now);
  const eligible = []; const successes = []; const failures = []; const excluded = []; const classes = [];
  for (const row of [...rows].sort(byId)) {
    const id = idOf(row, 'Complaint');
    if (row.status === 'LOGGED') { excluded.push({ id, reason: 'NOT_SCREENED' }); continue; }
    if (row.status === 'UNSUBSTANTIATED') { excluded.push({ id, reason: 'UNSUBSTANTIATED' }); continue; }
    if (row.status !== 'SUBSTANTIATED' && row.status !== 'RESOLVED') throw new Error(`Complaint ${id} has an unknown status.`);
    const screened = toMs(row.screened_at, `Complaint ${id} screened_at`, { required: true });
    if (screened > t) { excluded.push({ id, reason: 'NOT_SCREENED_BY_EVALUATION_TIME' }); continue; }
    const due = toMs(row.resolution_due_at, `Complaint ${id} resolution_due_at`, { required: true });
    const resolvedAt = toMs(row.resolved_at, `Complaint ${id} resolved_at`);
    const resolved = resolvedAt !== null && resolvedAt <= t;
    if (!resolved && due > t) { excluded.push({ id, reason: 'RESOLUTION_NOT_YET_DUE' }); continue; }
    eligible.push({ id });
    classes.push(evidenceClassOf(row, 'Complaint'));
    if (resolved && resolvedAt <= due) successes.push({ id });
    else failures.push({ id, reason: resolved ? 'RESOLVED_AFTER_DUE' : 'NOT_RESOLVED_PAST_DUE' });
  }
  return countResult('complaint', { eligible, successes, failures, excluded, classes });
}

/** I: points on the latest FINAL inspection; its stored critical findings escalate separately. */
function computeInspection({ inspections = [], items = [], criticalFindings = [] } = {}, policy, now) {
  const t = evaluationTime(now);
  const excluded = [];
  const finals = [];
  for (const row of [...inspections].sort(byId)) {
    const id = idOf(row, 'Inspection');
    if (row.status !== 'FINAL') { excluded.push({ id, reason: 'DRAFT_INSPECTION' }); continue; }
    const finalisedAt = toMs(row.finalised_at, `Inspection ${id} finalised_at`, { required: true });
    if (finalisedAt > t) { excluded.push({ id, reason: 'FINALISED_AFTER_EVALUATION_TIME' }); continue; }
    finals.push({ row, inspectedAt: toMs(row.inspected_at, `Inspection ${id} inspected_at`, { required: true }), finalisedAt });
  }
  finals.sort((a, b) => b.inspectedAt - a.inspectedAt || b.finalisedAt - a.finalisedAt || byId(a.row, b.row));
  const latest = finals[0]?.row || null;
  for (const older of finals.slice(1)) excluded.push({ id: older.row.id, reason: 'SUPERSEDED_BY_LATER_FINAL_INSPECTION' });
  excluded.sort(byId);

  const itemDetails = { applicable: [], notApplicable: [] };
  let pointsAchieved = 0;
  let applicableCount = 0;
  const classes = [];
  if (latest) {
    classes.push(evidenceClassOf(latest, 'Inspection'));
    for (const item of items.filter(entry => entry.inspection_id === latest.id).sort(byId)) {
      const itemId = idOf(item, 'Inspection item');
      if (item.result === 'NOT_APPLICABLE') { itemDetails.notApplicable.push({ id: itemId, reason: 'NOT_APPLICABLE' }); continue; }
      if (!Object.prototype.hasOwnProperty.call(policy.inspectionPoints, item.result)) throw new Error(`Inspection item ${itemId} has an unknown result.`);
      const points = policy.inspectionPoints[item.result];
      pointsAchieved += points;
      applicableCount += 1;
      itemDetails.applicable.push({ id: itemId, criterionCode: item.criterion_code, result: item.result, points });
      classes.push(evidenceClassOf(item, 'Inspection item'));
    }
  }
  const pointsApplicable = applicableCount * policy.inspectionPoints.COMPLIANT;
  const findings = latest
    ? criticalFindings.filter(finding => finding.inspection_id === latest.id).sort(byId).map(finding => ({
      id: idOf(finding, 'Critical finding'),
      inspectionItemId: finding.inspection_item_id ?? null,
      criterionCode: finding.criterion_code ?? null,
      raisedAt: finding.raised_at instanceof Date ? finding.raised_at.toISOString() : finding.raised_at ?? null,
      evidenceClass: evidenceClassOf(finding, 'Critical finding'),
    }))
    : [];
  const assessable = latest !== null && pointsApplicable > 0;
  return {
    indicator: 'inspection',
    status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE',
    numerator: pointsAchieved,
    denominator: pointsApplicable,
    formula: FORMULAS.inspection,
    inspectionId: latest?.id ?? null,
    inspectionRef: latest?.inspection_ref ?? null,
    items: itemDetails,
    excluded,
    evidenceIds: assessable ? [latest.id] : [],
    evidenceClasses: [...new Set(classes)].sort(),
    criticalFindings: findings,
    reason: assessable ? null
      : latest ? 'The latest FINAL inspection has no applicable items; the indicator is not assessable.'
        : 'No FINAL inspection at the evaluation time; the indicator is not assessable (never scored as 0 or 100).',
  };
}

/** All four indicators for one pharmacy bundle. */
function computeAllIndicators(bundle, policy, now) {
  return {
    delivery: computeDelivery(bundle.deliveries || [], policy, now),
    recall: computeRecall(bundle.recallActions || [], policy, now),
    complaint: computeComplaints(bundle.complaints || [], policy, now),
    inspection: computeInspection({
      inspections: bundle.inspections || [],
      items: bundle.inspectionItems || [],
      criticalFindings: bundle.criticalFindings || [],
    }, policy, now),
  };
}

module.exports = {
  FORMULAS,
  computeDelivery,
  computeRecall,
  computeComplaints,
  computeInspection,
  computeAllIndicators,
};
