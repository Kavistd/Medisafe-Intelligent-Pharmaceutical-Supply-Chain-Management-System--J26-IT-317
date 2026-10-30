'use strict';

/**
 * Write access for the Component 3 live schema (contract: migrations/live/001_c3_live_schema.sql).
 * - Every write runs in ONE transaction that first sets c3.actor_role and c3.actor_user_id
 *   (transaction-local, from the verified principal) so the audit triggers can attribute it.
 * - evidence_class is NOT derived by the database: c3.enforce_evidence_class() only VALIDATES
 *   that it matches the actor. It is therefore computed here from the verified role
 *   (role users -> PROTOTYPE_ENTRY) and never taken from the client.
 * - Columns the database derives are never sent: deliveries.confirm_due_at,
 *   complaints.resolution_due_at and c3.critical_findings (raised on inspection finalisation).
 * - Each UPDATE changes only the columns the forward-only guard permits for that step.
 */
const { ProcessError, translatePgError } = require('./liveErrors');

const ACTOR_ROLES = new Set(['REGULATOR', 'PHARMACY_USER', 'DISTRIBUTOR']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_USER_EVIDENCE_CLASS = 'PROTOTYPE_ENTRY';

const SQL = Object.freeze({
  setActor: "SELECT set_config('c3.actor_role', $1, true), set_config('c3.actor_user_id', $2, true)",
  pharmacyByCode: "SELECT id, pharmacy_code FROM c3.pharmacies WHERE pharmacy_code = $1 AND status = 'ACTIVE'",
  pharmaciesByCodes: "SELECT id, pharmacy_code FROM c3.pharmacies WHERE pharmacy_code = ANY($1::text[]) AND status = 'ACTIVE' ORDER BY pharmacy_code",
  insertDelivery: "INSERT INTO c3.deliveries (delivery_ref, distributor_id, pharmacy_id, policy_version, dispatched_at, expected_by, status, created_by, evidence_class) VALUES ($1, $2, $3, $4, $5, $6, 'DISPATCHED', $7, $8) RETURNING id, delivery_ref, status, dispatched_at, expected_by",
  lockDelivery: 'SELECT id, pharmacy_id, distributor_id, status, dispatched_at, arrived_at FROM c3.deliveries WHERE id = $1 FOR UPDATE',
  markArrived: "UPDATE c3.deliveries SET status = 'ARRIVED', arrived_at = $2, arrived_marked_by = $3 WHERE id = $1 AND status = 'DISPATCHED' RETURNING id, status, arrived_at, confirm_due_at",
  confirmDelivery: "UPDATE c3.deliveries SET status = 'CONFIRMED', confirmation_status = $2, confirmation_note = $3, confirmed_at = $4, confirmed_by = $5 WHERE id = $1 AND status = 'ARRIVED' RETURNING id, status, confirmation_status, confirmed_at, confirm_due_at",
  lockRecallAction: 'SELECT a.id, a.pharmacy_id, a.status, a.due_at, r.issued_at FROM c3.recall_actions AS a JOIN c3.recalls AS r ON r.id = a.recall_id WHERE a.id = $1 FOR UPDATE OF a',
  completeRecallAction: "UPDATE c3.recall_actions SET status = 'COMPLETED', completed_at = $2, completion_note = $3, completed_by = $4 WHERE id = $1 AND status = 'OPEN' RETURNING id, status, completed_at, due_at",
  insertRecall: "INSERT INTO c3.recalls (recall_ref, batch_reference, reason, issued_at, issued_by, status, evidence_class) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING id, recall_ref, issued_at",
  insertRecallAction: "INSERT INTO c3.recall_actions (recall_id, pharmacy_id, action_type, due_at, status, evidence_class) VALUES ($1, $2, $3, $4, 'OPEN', $5) RETURNING id, pharmacy_id, action_type, due_at",
  insertComplaint: "INSERT INTO c3.complaints (complaint_ref, pharmacy_id, policy_version, summary, logged_at, logged_by, status, evidence_class) VALUES ($1, $2, $3, $4, $5, $6, 'LOGGED', $7) RETURNING id, complaint_ref, status, logged_at",
  lockComplaint: 'SELECT id, pharmacy_id, status, logged_at, screened_at FROM c3.complaints WHERE id = $1 FOR UPDATE',
  screenComplaint: "UPDATE c3.complaints SET status = $2, screened_at = $3, screened_by = $4 WHERE id = $1 AND status = 'LOGGED' RETURNING id, status, screened_at, resolution_due_at",
  resolveComplaint: "UPDATE c3.complaints SET status = 'RESOLVED', resolved_at = $2, resolution_note = $3, resolved_by = $4 WHERE id = $1 AND status = 'SUBSTANTIATED' RETURNING id, status, resolved_at, resolution_due_at",
  criteriaByCodes: 'SELECT code FROM c3.inspection_criteria WHERE code = ANY($1::text[])',
  insertInspection: "INSERT INTO c3.inspections (inspection_ref, pharmacy_id, policy_version, inspected_at, recorded_by, status, evidence_class) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING id, inspection_ref, status, inspected_at",
  insertInspectionItem: 'INSERT INTO c3.inspection_items (inspection_id, criterion_code, result, critical, note, evidence_class) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, criterion_code, result, critical',
  lockInspection: 'SELECT id, pharmacy_id, status, inspected_at FROM c3.inspections WHERE id = $1 FOR UPDATE',
  finalizeInspection: "UPDATE c3.inspections SET status = 'FINAL', finalised_at = $2, finalised_by = $3 WHERE id = $1 AND status = 'DRAFT' RETURNING id, status, finalised_at",
  findingsForInspection: 'SELECT id, criterion_code, raised_at FROM c3.critical_findings WHERE inspection_id = $1 ORDER BY criterion_code',
  insertSnapshot: 'INSERT INTO c3.assessment_snapshots (pharmacy_id, policy_version, as_of, status, score, tier, breakdown, evidence_refs, evidence_classes, critical_escalation_required, sha256, computed_by, created_by, finalised_at, finalised_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::text[], $10, $11, $12, $13, $14, $13) RETURNING id, sha256, status, score, tier, as_of, finalised_at, blockchain_verification',
});

const one = result => (result && Array.isArray(result.rows) ? result.rows[0] || null : null);
const time = value => (value instanceof Date ? value.getTime() : Date.parse(value));

function createLiveWriteRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('A pg Pool with connect() is required.');

  /** One transaction; the verified actor is set before any write. */
  async function withActor(actor, work) {
    if (!actor || !ACTOR_ROLES.has(actor.role) || typeof actor.userId !== 'string' || !UUID.test(actor.userId)) {
      throw new ProcessError(403, 'FORBIDDEN', 'A verified role is required to change records.');
    }
    const client = await pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      await client.query(SQL.setActor, [actor.role, actor.userId]);
      const value = await work(client, ROLE_USER_EVIDENCE_CLASS);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      if (started) {
        try { await client.query('ROLLBACK'); } catch { /* keep the original error */ }
      }
      throw translatePgError(error);
    } finally {
      if (typeof client.release === 'function') client.release();
    }
  }

  async function lockInScope(client, sql, id, authorize, notFoundCode) {
    const row = one(await client.query(sql, [id]));
    if (!row || !authorize(row)) throw new ProcessError(404, notFoundCode, 'No such record is available to you.');
    return row;
  }

  function notBefore(now, earlier, message) {
    if (earlier !== null && earlier !== undefined && time(now) < time(earlier)) throw new ProcessError(422, 'TIMESTAMP_ORDER', message);
  }

  async function pharmacyOrFail(client, code) {
    const pharmacy = one(await client.query(SQL.pharmacyByCode, [code]));
    if (!pharmacy) throw new ProcessError(404, 'PHARMACY_NOT_FOUND', 'No active pharmacy has this code.');
    return pharmacy;
  }

  return Object.freeze({
    withActor,

    createDelivery: (actor, { deliveryRef, pharmacyCode, expectedBy, now, policyVersion }) => withActor(actor, async (client, evidenceClass) => {
      const pharmacy = await pharmacyOrFail(client, pharmacyCode);
      const row = one(await client.query(SQL.insertDelivery,
        [deliveryRef, actor.distributorId, pharmacy.id, policyVersion, now, expectedBy, actor.userId, evidenceClass]));
      return { ...row, pharmacy_code: pharmacy.pharmacy_code };
    }),

    markArrived: (actor, { deliveryId, now, authorize }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockDelivery, deliveryId, authorize, 'DELIVERY_NOT_FOUND');
      if (row.status !== 'DISPATCHED') throw new ProcessError(409, 'ALREADY_ARRIVED', 'This delivery has already been marked as arrived.');
      notBefore(now, row.dispatched_at, 'Arrival cannot precede dispatch.');
      const updated = one(await client.query(SQL.markArrived, [deliveryId, now, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_ARRIVED', 'This delivery has already been marked as arrived.');
      return updated;
    }),

    confirmDelivery: (actor, { deliveryId, confirmationStatus, note, now, authorize }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockDelivery, deliveryId, authorize, 'DELIVERY_NOT_FOUND');
      if (row.status === 'DISPATCHED') throw new ProcessError(409, 'NOT_ARRIVED', 'A delivery can be confirmed only after it has arrived.');
      if (row.status !== 'ARRIVED') throw new ProcessError(409, 'ALREADY_CONFIRMED', 'This delivery has already been confirmed.');
      notBefore(now, row.arrived_at, 'Confirmation cannot precede arrival.');
      const updated = one(await client.query(SQL.confirmDelivery, [deliveryId, confirmationStatus, note, now, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_CONFIRMED', 'This delivery has already been confirmed.');
      return updated;
    }),

    completeRecallAction: (actor, { actionId, note, now, authorize }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockRecallAction, actionId, authorize, 'RECALL_ACTION_NOT_FOUND');
      if (row.status !== 'OPEN') throw new ProcessError(409, 'ALREADY_COMPLETED', 'This recall action has already been completed.');
      notBefore(now, row.issued_at, 'Completion cannot precede the recall.');
      const updated = one(await client.query(SQL.completeRecallAction, [actionId, now, note, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_COMPLETED', 'This recall action has already been completed.');
      return updated;
    }),

    issueRecall: (actor, { recallRef, batchReference, reason, pharmacyCodes, actions, now }) => withActor(actor, async (client, evidenceClass) => {
      const pharmacies = (await client.query(SQL.pharmaciesByCodes, [pharmacyCodes])).rows;
      const missing = pharmacyCodes.filter(code => !pharmacies.some(row => row.pharmacy_code === code));
      if (missing.length) throw new ProcessError(422, 'UNKNOWN_PHARMACY', `Unknown or inactive pharmacy codes: ${missing.join(', ')}.`);
      const recall = one(await client.query(SQL.insertRecall, [recallRef, batchReference, reason, now, actor.userId, evidenceClass]));
      const created = [];
      for (const pharmacy of pharmacies) {
        for (const action of actions) {
          const row = one(await client.query(SQL.insertRecallAction, [recall.id, pharmacy.id, action.actionType, action.dueAt, evidenceClass]));
          created.push({ ...row, pharmacy_code: pharmacy.pharmacy_code });
        }
      }
      return { recall, actions: created };
    }),

    logComplaint: (actor, { complaintRef, pharmacyCode, summary, now, policyVersion }) => withActor(actor, async (client, evidenceClass) => {
      const pharmacy = await pharmacyOrFail(client, pharmacyCode);
      const row = one(await client.query(SQL.insertComplaint, [complaintRef, pharmacy.id, policyVersion, summary, now, actor.userId, evidenceClass]));
      return { ...row, pharmacy_code: pharmacy.pharmacy_code };
    }),

    screenComplaint: (actor, { complaintId, outcome, now }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockComplaint, complaintId, () => true, 'COMPLAINT_NOT_FOUND');
      if (row.status !== 'LOGGED') throw new ProcessError(409, 'ALREADY_SCREENED', 'This complaint has already been screened.');
      notBefore(now, row.logged_at, 'Screening cannot precede logging.');
      const updated = one(await client.query(SQL.screenComplaint, [complaintId, outcome, now, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_SCREENED', 'This complaint has already been screened.');
      return updated;
    }),

    resolveComplaint: (actor, { complaintId, note, now, authorize }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockComplaint, complaintId, authorize, 'COMPLAINT_NOT_FOUND');
      if (row.status === 'RESOLVED') throw new ProcessError(409, 'ALREADY_RESOLVED', 'This complaint has already been resolved.');
      if (row.status !== 'SUBSTANTIATED') throw new ProcessError(409, 'NOT_RESOLVABLE', 'Only substantiated complaints can be resolved.');
      notBefore(now, row.screened_at, 'Resolution cannot precede screening.');
      const updated = one(await client.query(SQL.resolveComplaint, [complaintId, now, note, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_RESOLVED', 'This complaint has already been resolved.');
      return updated;
    }),

    recordInspection: (actor, { inspectionRef, pharmacyCode, inspectedAt, items, policyVersion }) => withActor(actor, async (client, evidenceClass) => {
      const pharmacy = await pharmacyOrFail(client, pharmacyCode);
      const codes = items.map(item => item.criterionCode);
      const known = new Set((await client.query(SQL.criteriaByCodes, [codes])).rows.map(row => row.code));
      const unknown = codes.filter(code => !known.has(code));
      if (unknown.length) throw new ProcessError(422, 'UNKNOWN_CRITERION', `Unknown inspection criteria: ${unknown.join(', ')}.`);
      const inspection = one(await client.query(SQL.insertInspection, [inspectionRef, pharmacy.id, policyVersion, inspectedAt, actor.userId, evidenceClass]));
      const createdItems = [];
      for (const item of items) {
        createdItems.push(one(await client.query(SQL.insertInspectionItem,
          [inspection.id, item.criterionCode, item.result, item.critical, item.note, evidenceClass])));
      }
      return { ...inspection, pharmacy_code: pharmacy.pharmacy_code, items: createdItems };
    }),

    finalizeInspection: (actor, { inspectionId, now }) => withActor(actor, async client => {
      const row = await lockInScope(client, SQL.lockInspection, inspectionId, () => true, 'INSPECTION_NOT_FOUND');
      if (row.status !== 'DRAFT') throw new ProcessError(409, 'ALREADY_FINAL', 'This inspection has already been finalised.');
      notBefore(now, row.inspected_at, 'Finalisation cannot precede the inspection.');
      const updated = one(await client.query(SQL.finalizeInspection, [inspectionId, now, actor.userId]));
      if (!updated) throw new ProcessError(409, 'ALREADY_FINAL', 'This inspection has already been finalised.');
      const findings = (await client.query(SQL.findingsForInspection, [inspectionId])).rows;
      return { ...updated, criticalFindings: findings };
    }),

    insertSnapshot: (actor, values) => withActor(actor, async client => one(await client.query(SQL.insertSnapshot, [
      values.pharmacyId, values.policyVersion, values.asOf, values.status, values.score, values.tier,
      JSON.stringify(values.breakdown), JSON.stringify(values.evidenceRefs), values.evidenceClasses,
      values.criticalEscalationRequired, values.sha256, values.computedBy, actor.userId, values.now,
    ]))),
  });
}

module.exports = { SQL, ROLE_USER_EVIDENCE_CLASS, createLiveWriteRepository };
