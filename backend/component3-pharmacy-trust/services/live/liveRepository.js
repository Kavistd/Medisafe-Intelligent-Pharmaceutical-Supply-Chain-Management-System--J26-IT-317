'use strict';

/**
 * Read-only data access for the Component 3 live schema (c3). The pg Pool is
 * injected. Every read runs in one REPEATABLE READ, READ ONLY transaction with
 * parameterised, schema-qualified queries; nothing here writes. Authorization
 * decisions (who may call which function) belong to the calling service; this
 * module only resolves what a principal's ACTIVE c3.user_roles row allows.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQL = Object.freeze({
  policy: `
    SELECT version, parameter_status, weight_delivery, weight_recall, weight_complaint, weight_inspection,
           tier_highly_trusted_min, tier_trusted_min, tier_under_review_min,
           delivery_confirm_window_hours, complaint_resolution_target_days,
           inspection_points_compliant, inspection_points_partial, inspection_points_non_compliant
    FROM c3.policy WHERE version = $1`,
  pharmacyByCode: `
    SELECT id, pharmacy_code, display_name, status, evidence_class
    FROM c3.pharmacies WHERE pharmacy_code = $1`,
  activePharmacies: `
    SELECT id, pharmacy_code, display_name, status, evidence_class
    FROM c3.pharmacies WHERE status = 'ACTIVE' ORDER BY pharmacy_code`,
  pharmacyById: `
    SELECT id, pharmacy_code, display_name, status, evidence_class
    FROM c3.pharmacies WHERE id = $1 AND status = 'ACTIVE'`,
  activeRole: `
    SELECT role, pharmacy_id, distributor_id
    FROM c3.user_roles WHERE user_id = $1 AND status = 'ACTIVE'`,
  deliveries: `
    SELECT id, delivery_ref, pharmacy_id, distributor_id, dispatched_at, expected_by, arrived_at, confirm_due_at,
           status, confirmation_status, confirmed_at, evidence_class
    FROM c3.deliveries WHERE pharmacy_id = ANY($1::uuid[]) ORDER BY delivery_ref`,
  recallActions: `
    SELECT a.id, a.recall_id, r.recall_ref, r.issued_at, a.pharmacy_id, a.action_type, a.due_at, a.status,
           a.completed_at, a.evidence_class
    FROM c3.recall_actions AS a JOIN c3.recalls AS r ON r.id = a.recall_id
    WHERE a.pharmacy_id = ANY($1::uuid[]) ORDER BY r.recall_ref, a.action_type`,
  complaints: `
    SELECT id, complaint_ref, pharmacy_id, status, logged_at, screened_at, resolution_due_at, resolved_at, evidence_class
    FROM c3.complaints WHERE pharmacy_id = ANY($1::uuid[]) ORDER BY complaint_ref`,
  inspections: `
    SELECT id, inspection_ref, pharmacy_id, inspected_at, status, finalised_at, evidence_class
    FROM c3.inspections WHERE pharmacy_id = ANY($1::uuid[]) ORDER BY inspection_ref`,
  inspectionItems: `
    SELECT i.id, i.inspection_id, s.pharmacy_id, i.criterion_code, i.result, i.critical, i.evidence_class
    FROM c3.inspection_items AS i JOIN c3.inspections AS s ON s.id = i.inspection_id
    WHERE s.pharmacy_id = ANY($1::uuid[]) ORDER BY s.inspection_ref, i.criterion_code`,
  criticalFindings: `
    SELECT id, inspection_id, inspection_item_id, pharmacy_id, criterion_code, raised_at, evidence_class
    FROM c3.critical_findings WHERE pharmacy_id = ANY($1::uuid[]) ORDER BY raised_at, id`,
});

function rowsOf(result, label) {
  if (!result || !Array.isArray(result.rows)) throw new Error(`c3 ${label} query returned an invalid result.`);
  return result.rows;
}

function createLiveRepository({ pool } = {}) {
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

  async function eventRows(client, pharmacyIds) {
    const [deliveries, recallActions, complaints, inspections, inspectionItems, criticalFindings] = [
      rowsOf(await client.query(SQL.deliveries, [pharmacyIds]), 'deliveries'),
      rowsOf(await client.query(SQL.recallActions, [pharmacyIds]), 'recall actions'),
      rowsOf(await client.query(SQL.complaints, [pharmacyIds]), 'complaints'),
      rowsOf(await client.query(SQL.inspections, [pharmacyIds]), 'inspections'),
      rowsOf(await client.query(SQL.inspectionItems, [pharmacyIds]), 'inspection items'),
      rowsOf(await client.query(SQL.criticalFindings, [pharmacyIds]), 'critical findings'),
    ];
    return { deliveries, recallActions, complaints, inspections, inspectionItems, criticalFindings };
  }

  function bundleFor(pharmacy, rows) {
    const mine = list => list.filter(row => row.pharmacy_id === pharmacy.id);
    return {
      pharmacy,
      deliveries: mine(rows.deliveries),
      recallActions: mine(rows.recallActions),
      complaints: mine(rows.complaints),
      inspections: mine(rows.inspections),
      inspectionItems: mine(rows.inspectionItems),
      criticalFindings: mine(rows.criticalFindings),
    };
  }

  /** c3.policy row for a version (default v1), or null. */
  function readPolicyRow(version = 'v1') {
    return readOnly(async client => rowsOf(await client.query(SQL.policy, [version]), 'policy')[0] || null);
  }

  /** All rows needed to assess one pharmacy, from one consistent snapshot; null if unknown. */
  function readPharmacyBundle(pharmacyCode) {
    if (typeof pharmacyCode !== 'string' || pharmacyCode.length === 0 || pharmacyCode.length > 128) {
      throw new Error('pharmacyCode must be a non-empty string of at most 128 characters.');
    }
    return readOnly(async client => {
      const pharmacy = rowsOf(await client.query(SQL.pharmacyByCode, [pharmacyCode]), 'pharmacy')[0];
      if (!pharmacy) return null;
      return bundleFor(pharmacy, await eventRows(client, [pharmacy.id]));
    });
  }

  /**
   * Pharmacies a principal may see, from their ACTIVE c3.user_roles row:
   * REGULATOR -> all active pharmacies; PHARMACY_USER -> own pharmacy only;
   * DISTRIBUTOR or no active role -> none (no access to trust scores).
   */
  function listVisiblePharmacies(userId) {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new Error('userId must be a UUID.');
    return readOnly(async client => {
      const role = rowsOf(await client.query(SQL.activeRole, [userId]), 'user role')[0] || null;
      if (!role) return { role: null, pharmacies: [] };
      if (role.role === 'REGULATOR') {
        return { role: role.role, pharmacies: rowsOf(await client.query(SQL.activePharmacies, []), 'pharmacies') };
      }
      if (role.role === 'PHARMACY_USER') {
        return { role: role.role, pharmacies: rowsOf(await client.query(SQL.pharmacyById, [role.pharmacy_id]), 'pharmacy') };
      }
      return { role: role.role, pharmacies: [] };
    });
  }

  /** Bundles for every active pharmacy from one snapshot (regulator overview; caller enforces REGULATOR). */
  function listPharmacySummaries() {
    return readOnly(async client => {
      const pharmacies = rowsOf(await client.query(SQL.activePharmacies, []), 'pharmacies');
      if (pharmacies.length === 0) return [];
      const rows = await eventRows(client, pharmacies.map(pharmacy => pharmacy.id));
      return pharmacies.map(pharmacy => bundleFor(pharmacy, rows));
    });
  }

  return Object.freeze({ readPolicyRow, readPharmacyBundle, listVisiblePharmacies, listPharmacySummaries });
}

module.exports = { SQL, createLiveRepository };
