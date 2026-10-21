'use strict';

/**
 * In-memory stand-in for the c3 schema (no database). It answers only the exact SQL
 * constants exported by the live modules and emulates the migration's rules that the
 * backend relies on (migrations/live/001_c3_live_schema.sql):
 *   - writes require a transaction whose actor was set first (else P0001, like write_audit);
 *   - evidence_class must equal the actor's class (enforce_evidence_class);
 *   - forward-only UPDATEs only match rows in the expected state;
 *   - derived columns: confirm_due_at, resolution_due_at, critical findings on finalisation;
 *   - unique references (23505), CHECK rules (23514), audit rows, ROLLBACK restores state.
 * Seed rows come from tests/live/seedFixtures.js (parsed from 002_c3_live_seed.sql), with
 * ids mapped to deterministic UUIDs.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SQL: READ } = require('../../services/live/liveRepository');
const { SQL: WRITE } = require('../../services/live/liveWriteRepository');
const { SQL: WS } = require('../../services/live/liveWorkspaceRepository');
const { SQL: AUTH } = require('../../services/live/liveAuth');
const { buildSeedRows } = require('./seedFixtures');

const HOUR = 3600 * 1000;
const uuidFor = key => {
  const h = crypto.createHash('sha256').update(String(key)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const USERS = Object.freeze({
  regulator: uuidFor('user:regulator'),
  pharmacyA: uuidFor('user:pharmacy-a'),
  pharmacyB: uuidFor('user:pharmacy-b'),
  distributor: uuidFor('user:distributor'),
  suspended: uuidFor('user:suspended'),
  noRole: uuidFor('user:no-role'),
});

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', 'live', '001_c3_live_schema.sql'), 'utf8');
const CRITERIA = [...MIGRATION.matchAll(/\('([A-Z0-9_]+)', (\d+), '([^']+)'\)/g)]
  .map(m => ({ code: m[1], display_order: Number(m[2]), title: m[3], mapping_status: 'UNVERIFIED', mapping_note: 'Prototype checklist.' }));

function pgError(code, message) {
  return Object.assign(new Error(message), { code });
}

function buildStore() {
  const seed = buildSeedRows();
  const id = value => (value === null || value === undefined ? value : uuidFor(value));
  const remap = (rows, keys) => rows.map(row => {
    const copy = { ...row };
    for (const key of keys) if (key in copy) copy[key] = id(copy[key]);
    return copy;
  });
  const distributorId = id('distributor:C3-DS-01');
  const recallActions = remap(seed.recallActions, ['id', 'recall_id', 'pharmacy_id']);
  const recalls = [...new Map(recallActions.map(row => [row.recall_id, {
    id: row.recall_id, recall_ref: row.recall_ref, batch_reference: `SIM-${row.recall_ref}`, reason: 'Simulated recall.',
    issued_at: row.issued_at, status: 'ACTIVE', evidence_class: 'SEEDED_SIMULATED',
  }])).values()];
  const pharmacyA = id('pharmacy:C3-PH-A');
  const pharmacyB = id('pharmacy:C3-PH-B');
  const grantedAt = new Date('2026-08-01T00:00:00Z');
  return {
    policy: [{
      version: 'v1', parameter_status: 'PROPOSED_RESEARCH_PARAMETERS',
      weight_delivery: '0.3500', weight_recall: '0.3000', weight_complaint: '0.2000', weight_inspection: '0.1500',
      tier_highly_trusted_min: '80.000', tier_trusted_min: '60.000', tier_under_review_min: '40.000',
      delivery_confirm_window_hours: 24, complaint_resolution_target_days: 30,
      inspection_points_compliant: '1.00', inspection_points_partial: '0.50', inspection_points_non_compliant: '0.00',
    }],
    criteria: CRITERIA,
    pharmacies: remap(seed.pharmacies, ['id']),
    distributors: [{ id: distributorId, distributor_code: 'C3-DS-01', status: 'ACTIVE' }],
    user_roles: [
      { user_id: USERS.regulator, role: 'REGULATOR', status: 'ACTIVE', pharmacy_id: null, distributor_id: null, granted_at: grantedAt },
      { user_id: USERS.pharmacyA, role: 'PHARMACY_USER', status: 'ACTIVE', pharmacy_id: pharmacyA, distributor_id: null, granted_at: grantedAt },
      { user_id: USERS.pharmacyB, role: 'PHARMACY_USER', status: 'ACTIVE', pharmacy_id: pharmacyB, distributor_id: null, granted_at: grantedAt },
      { user_id: USERS.distributor, role: 'DISTRIBUTOR', status: 'ACTIVE', pharmacy_id: null, distributor_id: distributorId, granted_at: grantedAt },
      { user_id: USERS.suspended, role: 'PHARMACY_USER', status: 'SUSPENDED', pharmacy_id: pharmacyA, distributor_id: null, granted_at: grantedAt },
    ],
    deliveries: remap(seed.deliveries, ['id', 'pharmacy_id']).map(row => ({ ...row, distributor_id: distributorId })),
    recalls,
    recall_actions: recallActions.map(({ recall_ref: _ref, issued_at: _issued, ...row }) => row),
    complaints: remap(seed.complaints, ['id', 'pharmacy_id']).map(row => ({ ...row, summary: 'Simulated complaint.' })),
    inspections: remap(seed.inspections, ['id', 'pharmacy_id']),
    inspection_items: remap(seed.inspectionItems, ['id', 'inspection_id', 'pharmacy_id']),
    critical_findings: remap(seed.criticalFindings, ['id', 'inspection_id', 'inspection_item_id', 'pharmacy_id']),
    assessment_snapshots: [],
    audit_log: [],
  };
}

function createFakeC3Pool() {
  let store = buildStore();
  const log = [];
  let released = 0;
  let auditSeq = 0;
  const S = () => store;
  const ms = value => (value instanceof Date ? value.getTime() : Date.parse(value));
  const date = value => (value === null || value === undefined ? null : new Date(ms(value)));
  const pharmacy = pid => S().pharmacies.find(row => row.id === pid);

  function requireWrite(tx) {
    if (!tx) throw pgError('25P01', 'write outside a transaction');
    if (tx.readOnly) throw pgError('25006', 'cannot execute a write in a read-only transaction');
    if (!tx.actor || !tx.actor.role) throw pgError('P0001', 'c3 writes require the c3.actor_role setting; no unattributed writes are allowed');
  }
  function checkEvidence(tx, value, table) {
    const expected = tx.actor.role === 'SEED' ? 'SEEDED_SIMULATED' : 'PROTOTYPE_ENTRY';
    if (value !== expected) throw pgError('P0001', `c3.${table} evidence_class must be ${expected} for actor role ${tx.actor.role}`);
  }
  function audit(tx, table, action, row) {
    auditSeq += 1;
    S().audit_log.push({
      id: auditSeq, occurred_at: new Date(0), actor_user_id: tx.actor.userId || null, actor_role: tx.actor.role,
      action, target_table: table, target_id: row.id, details: { status: row.status ?? null },
    });
  }
  function unique(table, key, value) {
    if (S()[table].some(row => row[key] === value)) throw pgError('23505', `duplicate key value violates unique constraint on ${table}.${key}`);
  }
  const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
  const rows = list => ({ rows: list });
  const inIds = (list, ids) => list.filter(row => ids.includes(row.pharmacy_id));

  const HANDLERS = new Map([
    // ---- reads ----
    [READ.policy, ({ params }) => rows(S().policy.filter(row => row.version === params[0]))],
    [READ.pharmacyByCode, ({ params }) => rows(S().pharmacies.filter(row => row.pharmacy_code === params[0]))],
    [READ.activePharmacies, () => rows(S().pharmacies.filter(row => row.status === 'ACTIVE').sort((a, b) => a.pharmacy_code.localeCompare(b.pharmacy_code)))],
    [READ.pharmacyById, ({ params }) => rows(S().pharmacies.filter(row => row.id === params[0] && row.status === 'ACTIVE'))],
    [READ.activeRole, ({ params }) => rows(S().user_roles.filter(row => row.user_id === params[0] && row.status === 'ACTIVE')
      .map(row => pick(row, ['role', 'pharmacy_id', 'distributor_id'])))],
    [READ.deliveries, ({ params }) => rows(inIds(S().deliveries, params[0]))],
    [READ.recallActions, ({ params }) => rows(inIds(S().recall_actions, params[0]).map(row => {
      const recall = S().recalls.find(r => r.id === row.recall_id);
      return { ...row, recall_ref: recall.recall_ref, issued_at: recall.issued_at };
    }))],
    [READ.complaints, ({ params }) => rows(inIds(S().complaints, params[0]))],
    [READ.inspections, ({ params }) => rows(inIds(S().inspections, params[0]))],
    [READ.inspectionItems, ({ params }) => rows(S().inspection_items
      .map(item => ({ ...item, pharmacy_id: S().inspections.find(s => s.id === item.inspection_id).pharmacy_id }))
      .filter(item => params[0].includes(item.pharmacy_id)))],
    [READ.criticalFindings, ({ params }) => rows(inIds(S().critical_findings, params[0]))],
    [AUTH.roleForUser, ({ params }) => rows(S().user_roles.filter(row => row.user_id === params[0])
      .sort((a, b) => (b.status === 'ACTIVE') - (a.status === 'ACTIVE') || ms(b.granted_at) - ms(a.granted_at))
      .slice(0, 1)
      .map(row => ({
        ...pick(row, ['role', 'status', 'pharmacy_id', 'distributor_id']),
        pharmacy_code: pharmacy(row.pharmacy_id)?.pharmacy_code ?? null,
        distributor_code: S().distributors.find(d => d.id === row.distributor_id)?.distributor_code ?? null,
      })))],

    // ---- workspaces ----
    [WS.pharmacyDeliveriesToConfirm, ({ params }) => rows(S().deliveries.filter(row => row.pharmacy_id === params[0] && row.status === 'ARRIVED'))],
    [WS.pharmacyOpenRecallActions, ({ params }) => rows(S().recall_actions.filter(row => row.pharmacy_id === params[0] && row.status === 'OPEN'))],
    [WS.pharmacyComplaintsToResolve, ({ params }) => rows(S().complaints.filter(row => row.pharmacy_id === params[0] && row.status === 'SUBSTANTIATED'))],
    [WS.distributorDeliveries, ({ params }) => rows(S().deliveries.filter(row => row.distributor_id === params[0])
      .map(row => ({ ...row, pharmacy_code: pharmacy(row.pharmacy_id).pharmacy_code })))],
    [WS.openComplaints, () => rows(S().complaints.filter(row => ['LOGGED', 'SUBSTANTIATED'].includes(row.status)))],
    [WS.recalls, () => rows(S().recalls.map(row => ({ ...row, action_count: S().recall_actions.filter(a => a.recall_id === row.id).length })))],
    [WS.inspections, () => rows(S().inspections.map(row => ({ ...row, pharmacy_code: pharmacy(row.pharmacy_id).pharmacy_code })))],
    [WS.auditLog, ({ params }) => rows([...S().audit_log].reverse().slice(0, params[0]))],
    [WS.pharmacyDirectory, () => rows(S().pharmacies.filter(row => row.status === 'ACTIVE').map(row => pick(row, ['pharmacy_code', 'display_name'])))],
    [WS.criteria, () => rows(S().criteria)],

    // ---- writes ----
    [WRITE.setActor, ({ params, tx }) => {
      if (!tx) throw pgError('25P01', 'set_config outside a transaction');
      tx.actor = { role: params[0], userId: params[1] };
      return rows([{}]);
    }],
    [WRITE.pharmacyByCode, ({ params }) => rows(S().pharmacies.filter(row => row.pharmacy_code === params[0] && row.status === 'ACTIVE').map(row => pick(row, ['id', 'pharmacy_code'])))],
    [WRITE.pharmaciesByCodes, ({ params }) => rows(S().pharmacies.filter(row => params[0].includes(row.pharmacy_code) && row.status === 'ACTIVE')
      .map(row => pick(row, ['id', 'pharmacy_code'])).sort((a, b) => a.pharmacy_code.localeCompare(b.pharmacy_code)))],
    [WRITE.insertDelivery, ({ params, tx }) => {
      requireWrite(tx);
      const [ref, distributorId, pharmacyId, policyVersion, dispatchedAt, expectedBy, createdBy, evidenceClass] = params;
      checkEvidence(tx, evidenceClass, 'deliveries');
      if (!distributorId) throw pgError('23502', 'null value in column "distributor_id"');
      unique('deliveries', 'delivery_ref', ref);
      if (ms(expectedBy) < ms(dispatchedAt)) throw pgError('23514', 'c3_deliveries_expected_after_dispatch');
      const row = {
        id: crypto.randomUUID(), delivery_ref: ref, distributor_id: distributorId, pharmacy_id: pharmacyId, policy_version: policyVersion,
        dispatched_at: date(dispatchedAt), expected_by: date(expectedBy), arrived_at: null, confirm_due_at: null, status: 'DISPATCHED',
        confirmation_status: null, confirmed_at: null, confirmation_note: null, created_by: createdBy, evidence_class: evidenceClass,
      };
      S().deliveries.push(row);
      audit(tx, 'deliveries', 'INSERT', row);
      return rows([pick(row, ['id', 'delivery_ref', 'status', 'dispatched_at', 'expected_by'])]);
    }],
    [WRITE.lockDelivery, ({ params }) => rows(S().deliveries.filter(row => row.id === params[0])
      .map(row => pick(row, ['id', 'pharmacy_id', 'distributor_id', 'status', 'dispatched_at', 'arrived_at'])))],
    [WRITE.markArrived, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().deliveries.find(d => d.id === params[0] && d.status === 'DISPATCHED');
      if (!row) return rows([]);
      Object.assign(row, { status: 'ARRIVED', arrived_at: date(params[1]), arrived_marked_by: params[2] });
      row.confirm_due_at = new Date(ms(row.arrived_at) + S().policy[0].delivery_confirm_window_hours * HOUR); // derived by the database
      audit(tx, 'deliveries', 'UPDATE', row);
      return rows([pick(row, ['id', 'status', 'arrived_at', 'confirm_due_at'])]);
    }],
    [WRITE.confirmDelivery, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().deliveries.find(d => d.id === params[0] && d.status === 'ARRIVED');
      if (!row) return rows([]);
      if (params[1] !== 'ACCEPTED' && !(params[2] && params[2].trim())) throw pgError('23514', 'c3_deliveries_note_when_not_accepted');
      Object.assign(row, { status: 'CONFIRMED', confirmation_status: params[1], confirmation_note: params[2], confirmed_at: date(params[3]), confirmed_by: params[4] });
      audit(tx, 'deliveries', 'UPDATE', row);
      return rows([pick(row, ['id', 'status', 'confirmation_status', 'confirmed_at', 'confirm_due_at'])]);
    }],
    [WRITE.lockRecallAction, ({ params }) => rows(S().recall_actions.filter(row => row.id === params[0]).map(row => ({
      ...pick(row, ['id', 'pharmacy_id', 'status', 'due_at']), issued_at: S().recalls.find(r => r.id === row.recall_id).issued_at,
    })))],
    [WRITE.completeRecallAction, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().recall_actions.find(a => a.id === params[0] && a.status === 'OPEN');
      if (!row) return rows([]);
      Object.assign(row, { status: 'COMPLETED', completed_at: date(params[1]), completion_note: params[2], completed_by: params[3] });
      audit(tx, 'recall_actions', 'UPDATE', row);
      return rows([pick(row, ['id', 'status', 'completed_at', 'due_at'])]);
    }],
    [WRITE.insertRecall, ({ params, tx }) => {
      requireWrite(tx);
      checkEvidence(tx, params[5], 'recalls');
      unique('recalls', 'recall_ref', params[0]);
      const row = { id: crypto.randomUUID(), recall_ref: params[0], batch_reference: params[1], reason: params[2], issued_at: date(params[3]), issued_by: params[4], status: 'ACTIVE', evidence_class: params[5] };
      S().recalls.push(row);
      audit(tx, 'recalls', 'INSERT', row);
      return rows([pick(row, ['id', 'recall_ref', 'issued_at'])]);
    }],
    [WRITE.insertRecallAction, ({ params, tx }) => {
      requireWrite(tx);
      checkEvidence(tx, params[4], 'recall_actions');
      if (S().recall_actions.some(a => a.recall_id === params[0] && a.pharmacy_id === params[1] && a.action_type === params[2])) {
        throw pgError('23505', 'c3_recall_actions_one_per_type');
      }
      const row = { id: crypto.randomUUID(), recall_id: params[0], pharmacy_id: params[1], action_type: params[2], due_at: date(params[3]), status: 'OPEN', completed_at: null, evidence_class: params[4] };
      S().recall_actions.push(row);
      audit(tx, 'recall_actions', 'INSERT', row);
      return rows([pick(row, ['id', 'pharmacy_id', 'action_type', 'due_at'])]);
    }],
    [WRITE.insertComplaint, ({ params, tx }) => {
      requireWrite(tx);
      checkEvidence(tx, params[6], 'complaints');
      unique('complaints', 'complaint_ref', params[0]);
      const row = {
        id: crypto.randomUUID(), complaint_ref: params[0], pharmacy_id: params[1], policy_version: params[2], summary: params[3],
        logged_at: date(params[4]), logged_by: params[5], status: 'LOGGED', screened_at: null, resolution_due_at: null, resolved_at: null, evidence_class: params[6],
      };
      S().complaints.push(row);
      audit(tx, 'complaints', 'INSERT', row);
      return rows([pick(row, ['id', 'complaint_ref', 'status', 'logged_at'])]);
    }],
    [WRITE.lockComplaint, ({ params }) => rows(S().complaints.filter(row => row.id === params[0]).map(row => pick(row, ['id', 'pharmacy_id', 'status', 'logged_at', 'screened_at'])))],
    [WRITE.screenComplaint, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().complaints.find(c => c.id === params[0] && c.status === 'LOGGED');
      if (!row) return rows([]);
      Object.assign(row, { status: params[1], screened_at: date(params[2]), screened_by: params[3] });
      row.resolution_due_at = params[1] === 'SUBSTANTIATED'
        ? new Date(ms(row.screened_at) + S().policy[0].complaint_resolution_target_days * 24 * HOUR) : null; // derived by the database
      audit(tx, 'complaints', 'UPDATE', row);
      return rows([pick(row, ['id', 'status', 'screened_at', 'resolution_due_at'])]);
    }],
    [WRITE.resolveComplaint, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().complaints.find(c => c.id === params[0] && c.status === 'SUBSTANTIATED');
      if (!row) return rows([]);
      Object.assign(row, { status: 'RESOLVED', resolved_at: date(params[1]), resolution_note: params[2], resolved_by: params[3] });
      audit(tx, 'complaints', 'UPDATE', row);
      return rows([pick(row, ['id', 'status', 'resolved_at', 'resolution_due_at'])]);
    }],
    [WRITE.criteriaByCodes, ({ params }) => rows(S().criteria.filter(row => params[0].includes(row.code)).map(row => ({ code: row.code })))],
    [WRITE.insertInspection, ({ params, tx }) => {
      requireWrite(tx);
      checkEvidence(tx, params[5], 'inspections');
      unique('inspections', 'inspection_ref', params[0]);
      const row = { id: crypto.randomUUID(), inspection_ref: params[0], pharmacy_id: params[1], policy_version: params[2], inspected_at: date(params[3]), recorded_by: params[4], status: 'DRAFT', finalised_at: null, evidence_class: params[5] };
      S().inspections.push(row);
      audit(tx, 'inspections', 'INSERT', row);
      return rows([pick(row, ['id', 'inspection_ref', 'status', 'inspected_at'])]);
    }],
    [WRITE.insertInspectionItem, ({ params, tx }) => {
      requireWrite(tx);
      checkEvidence(tx, params[5], 'inspection_items');
      const parent = S().inspections.find(s => s.id === params[0]);
      if (!parent || parent.status !== 'DRAFT') throw pgError('P0001', 'c3.inspection_items can only be added to a DRAFT inspection');
      if (params[3] && params[2] !== 'NON_COMPLIANT') throw pgError('23514', 'c3_inspection_items_critical_only_when_non_compliant');
      const row = { id: crypto.randomUUID(), inspection_id: params[0], criterion_code: params[1], result: params[2], critical: params[3], note: params[4], evidence_class: params[5] };
      S().inspection_items.push(row);
      audit(tx, 'inspection_items', 'INSERT', row);
      return rows([pick(row, ['id', 'criterion_code', 'result', 'critical'])]);
    }],
    [WRITE.lockInspection, ({ params }) => rows(S().inspections.filter(row => row.id === params[0]).map(row => pick(row, ['id', 'pharmacy_id', 'status', 'inspected_at'])))],
    [WRITE.finalizeInspection, ({ params, tx }) => {
      requireWrite(tx);
      const row = S().inspections.find(s => s.id === params[0] && s.status === 'DRAFT');
      if (!row) return rows([]);
      if (!S().inspection_items.some(item => item.inspection_id === row.id)) throw pgError('P0001', 'c3.inspections cannot be finalised without inspection items');
      Object.assign(row, { status: 'FINAL', finalised_at: date(params[1]), finalised_by: params[2] });
      audit(tx, 'inspections', 'UPDATE', row);
      for (const item of S().inspection_items.filter(i => i.inspection_id === row.id && i.result === 'NON_COMPLIANT' && i.critical)) {
        const finding = { id: crypto.randomUUID(), inspection_id: row.id, inspection_item_id: item.id, pharmacy_id: row.pharmacy_id, criterion_code: item.criterion_code, raised_at: row.finalised_at, evidence_class: row.evidence_class };
        S().critical_findings.push(finding); // raised by the database trigger
        audit(tx, 'critical_findings', 'INSERT', finding);
      }
      return rows([pick(row, ['id', 'status', 'finalised_at'])]);
    }],
    [WRITE.findingsForInspection, ({ params }) => rows(S().critical_findings.filter(f => f.inspection_id === params[0]).map(f => pick(f, ['id', 'criterion_code', 'raised_at'])))],
    [WRITE.insertSnapshot, ({ params, tx }) => {
      requireWrite(tx);
      const [pharmacyId, policyVersion, asOf, status, score, tier, breakdown, evidenceRefs, evidenceClasses, critical, sha256, computedBy, createdBy, finalisedAt] = params;
      if (!/^0x[0-9a-f]{64}$/.test(sha256)) throw pgError('23514', 'sha256 check');
      if ((status === 'ASSESSABLE') !== (score !== null) || (status === 'ASSESSABLE') !== (tier !== null)) throw pgError('23514', 'c3_snapshots_score_iff_assessable');
      const row = {
        id: crypto.randomUUID(), pharmacy_id: pharmacyId, policy_version: policyVersion, as_of: date(asOf), status, score, tier,
        breakdown: JSON.parse(breakdown), evidence_refs: JSON.parse(evidenceRefs), evidence_classes: evidenceClasses,
        critical_escalation_required: critical, sha256, computed_by: computedBy, created_by: createdBy,
        finalised_at: date(finalisedAt), finalised_by: createdBy, blockchain_verification: 'NOT_PERFORMED',
      };
      S().assessment_snapshots.push(row);
      audit(tx, 'assessment_snapshots', 'INSERT', row);
      return rows([pick(row, ['id', 'sha256', 'status', 'score', 'tier', 'as_of', 'finalised_at', 'blockchain_verification'])]);
    }],
  ]);

  function makeClient() {
    let tx = null;
    return {
      async query(sql, params = []) {
        log.push({ sql, params, inTransaction: Boolean(tx), actor: tx && tx.actor ? { ...tx.actor } : null });
        if (sql.startsWith('BEGIN')) { tx = { snapshot: structuredClone(store), actor: null, readOnly: /READ ONLY/.test(sql) }; return rows([]); }
        if (sql === 'COMMIT') { tx = null; return rows([]); }
        if (sql === 'ROLLBACK') { if (tx) store = tx.snapshot; tx = null; return rows([]); }
        const handler = HANDLERS.get(sql);
        if (!handler) throw new Error(`fake c3 pool: unexpected SQL: ${sql.trim().slice(0, 80)}`);
        return handler({ params, tx });
      },
      release() { released += 1; },
    };
  }

  return {
    connect: async () => makeClient(),
    query: (sql, params) => makeClient().query(sql, params),
    end: async () => {},
    log,
    store: () => store,
    released: () => released,
    idOf: seedId => uuidFor(seedId),
  };
}

module.exports = { USERS, uuidFor, createFakeC3Pool };
