'use strict';

/**
 * Read-only role workspaces for the live runtime (REPEATABLE READ, READ ONLY,
 * parameterised, schema-qualified c3.*). Callers enforce permissions; scoped
 * functions take the scope id from the verified principal, never from the client.
 */
const SQL = Object.freeze({
  pharmacyDeliveriesToConfirm: `
    SELECT d.id, d.delivery_ref, ds.distributor_code, d.dispatched_at, d.expected_by, d.arrived_at, d.confirm_due_at
    FROM c3.deliveries AS d JOIN c3.distributors AS ds ON ds.id = d.distributor_id
    WHERE d.pharmacy_id = $1 AND d.status = 'ARRIVED' ORDER BY d.confirm_due_at, d.delivery_ref`,
  pharmacyOpenRecallActions: `
    SELECT a.id, r.recall_ref, r.batch_reference, r.reason, a.action_type, a.due_at
    FROM c3.recall_actions AS a JOIN c3.recalls AS r ON r.id = a.recall_id
    WHERE a.pharmacy_id = $1 AND a.status = 'OPEN' ORDER BY a.due_at, r.recall_ref, a.action_type`,
  pharmacyComplaintsToResolve: `
    SELECT id, complaint_ref, summary, screened_at, resolution_due_at
    FROM c3.complaints WHERE pharmacy_id = $1 AND status = 'SUBSTANTIATED' ORDER BY resolution_due_at, complaint_ref`,
  distributorDeliveries: `
    SELECT d.id, d.delivery_ref, p.pharmacy_code, d.status, d.dispatched_at, d.expected_by, d.arrived_at,
           d.confirmation_status, d.confirmed_at
    FROM c3.deliveries AS d JOIN c3.pharmacies AS p ON p.id = d.pharmacy_id
    WHERE d.distributor_id = $1 ORDER BY d.dispatched_at DESC, d.delivery_ref`,
  openComplaints: `
    SELECT c.id, c.complaint_ref, p.pharmacy_code, c.summary, c.status, c.logged_at, c.screened_at, c.resolution_due_at
    FROM c3.complaints AS c JOIN c3.pharmacies AS p ON p.id = c.pharmacy_id
    WHERE c.status IN ('LOGGED', 'SUBSTANTIATED') ORDER BY c.logged_at, c.complaint_ref`,
  recalls: `
    SELECT r.id, r.recall_ref, r.batch_reference, r.reason, r.issued_at, r.status,
           count(a.id)::int AS action_count,
           count(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed_count
    FROM c3.recalls AS r LEFT JOIN c3.recall_actions AS a ON a.recall_id = r.id
    GROUP BY r.id ORDER BY r.issued_at DESC, r.recall_ref`,
  inspections: `
    SELECT s.id, s.inspection_ref, p.pharmacy_code, s.inspected_at, s.status, s.finalised_at,
           count(i.id)::int AS item_count
    FROM c3.inspections AS s JOIN c3.pharmacies AS p ON p.id = s.pharmacy_id
    LEFT JOIN c3.inspection_items AS i ON i.inspection_id = s.id
    GROUP BY s.id, p.pharmacy_code ORDER BY s.inspected_at DESC, s.inspection_ref`,
  auditLog: `
    SELECT id, occurred_at, actor_user_id, actor_role, action, target_table, target_id, details
    FROM c3.audit_log ORDER BY id DESC LIMIT $1`,
  pharmacyDirectory: `
    SELECT pharmacy_code, display_name FROM c3.pharmacies WHERE status = 'ACTIVE' ORDER BY pharmacy_code`,
  criteria: `
    SELECT code, display_order, title, mapping_status, mapping_note FROM c3.inspection_criteria ORDER BY display_order`,
});

const rowsOf = result => (result && Array.isArray(result.rows) ? result.rows : []);

function createLiveWorkspaceRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('A pg Pool with connect() is required.');

  async function readOnly(work) {
    const client = await pool.connect();
    let started = false;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      started = true;
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      if (started) {
        try { await client.query('ROLLBACK'); } catch { /* keep the original error */ }
      }
      throw error;
    } finally {
      if (typeof client.release === 'function') client.release();
    }
  }

  const list = (sql, params = []) => readOnly(async client => rowsOf(await client.query(sql, params)));

  return Object.freeze({
    pharmacyTasks: pharmacyId => readOnly(async client => ({
      deliveriesToConfirm: rowsOf(await client.query(SQL.pharmacyDeliveriesToConfirm, [pharmacyId])),
      recallActionsDue: rowsOf(await client.query(SQL.pharmacyOpenRecallActions, [pharmacyId])),
      complaintsToResolve: rowsOf(await client.query(SQL.pharmacyComplaintsToResolve, [pharmacyId])),
    })),
    distributorDeliveries: distributorId => list(SQL.distributorDeliveries, [distributorId]),
    openComplaints: () => list(SQL.openComplaints),
    recalls: () => list(SQL.recalls),
    inspections: () => list(SQL.inspections),
    auditLog: limit => list(SQL.auditLog, [limit]),
    pharmacyDirectory: () => list(SQL.pharmacyDirectory),
    criteria: () => list(SQL.criteria),
  });
}

module.exports = { SQL, createLiveWorkspaceRepository };
