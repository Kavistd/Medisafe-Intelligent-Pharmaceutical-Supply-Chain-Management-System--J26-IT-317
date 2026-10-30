'use strict';

// Static checks of the Component 3 LIVE migration and seed (no database connection).
// Seed data is SIMULATED; expected values follow docs/component3/LIVE_DESIGN.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WEIGHTS, calculateTrustScore, classifyTier } = require('../services/trustScore');
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
  toTrustScoreInput,
} = require('../services/indicatorScoring');

const LIVE_DIR = path.join(__dirname, '..', 'migrations', 'live');
const schemaSql = fs.readFileSync(path.join(LIVE_DIR, '001_c3_live_schema.sql'), 'utf8');
const seedSql = fs.readFileSync(path.join(LIVE_DIR, '002_c3_live_seed.sql'), 'utf8');

// Every seeded deadline falls before 2026-10-01T00:00Z = anchor (2026-08-01T00:00Z) + 1464 h.
const STABLE_AS_OF_H = 1464;
const EVENT_TABLES = ['deliveries', 'recalls', 'recall_actions', 'complaints', 'inspections', 'inspection_items', 'critical_findings'];
const OTHER_SCHEMAS = /\b(public|auth|storage|extensions|graphql|graphql_public|realtime|vault|pgsodium|net|cron|supabase_functions|supabase_migrations|pg_catalog|information_schema|pharmacy_trust)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/gi;

/** Remove "--" comments outside single-quoted strings. */
function stripComments(sql) {
  return sql.split(/\r?\n/).map(line => {
    let inQuote = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "'") inQuote = !inQuote;
      else if (!inQuote && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

const schemaCode = stripComments(schemaSql);
const seedCode = stripComments(seedSql);

/** Split on commas that are outside quotes and parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      if (inQuote && text[i + 1] === "'") { current += "''"; i += 1; continue; }
      inQuote = !inQuote;
    } else if (!inQuote && ch === '(') depth += 1;
    else if (!inQuote && ch === ')') depth -= 1;
    if (!inQuote && depth === 0 && ch === ',') { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map(part => part.trim());
}

function parseValue(token) {
  if (/^NULL$/i.test(token)) return null;
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true';
  const quoted = /^'([\s\S]*)'$/.exec(token);
  if (quoted) return quoted[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  throw new Error(`Unparseable SQL value: ${token}`);
}

/** Rows between "-- @data <name> begin" and "-- @data <name> end", mapped to the given column names. */
function dataBlock(name, columns) {
  const match = new RegExp(`-- @data ${name} begin\\r?\\n([\\s\\S]*?)\\r?\\n-- @data ${name} end`).exec(seedSql);
  assert.ok(match, `seed data block ${name} is missing`);
  return match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const tuple = /^\(([\s\S]*)\),?$/.exec(line);
    assert.ok(tuple, `malformed tuple in ${name}: ${line}`);
    const values = splitTopLevel(tuple[1]).map(parseValue);
    assert.equal(values.length, columns.length, `wrong arity in ${name}: ${line}`);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function policyV1() {
  const match = /INSERT INTO c3\.policy \(([\s\S]*?)\) VALUES \(([\s\S]*?)\);/.exec(schemaCode);
  assert.ok(match, 'policy v1 insert is missing');
  const columns = splitTopLevel(match[1]);
  const values = splitTopLevel(match[2]).map(parseValue);
  assert.equal(columns.length, values.length);
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

const createdTables = [...schemaCode.matchAll(/CREATE TABLE c3\.([a-z_]+)/g)].map(match => match[1]);

test('migration runs as one transaction and creates a fresh c3 schema', () => {
  const statements = schemaCode.trim();
  assert.match(statements, /^BEGIN;/);
  assert.match(statements, /COMMIT;$/);
  assert.equal((schemaCode.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((schemaCode.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((schemaCode.match(/CREATE SCHEMA/gi) || []).length, 1);
  assert.match(schemaCode, /CREATE SCHEMA c3;/);
  assert.doesNotMatch(schemaCode, /CREATE\s+[^;(]*IF\s+NOT\s+EXISTS/i);
});

test('every created object lives in schema c3', () => {
  const creates = [...schemaCode.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?(?:OR\s+REPLACE\s+)?([A-Z]+(?:\s+(?:TRIGGER|VIEW|TABLE))?)\b([^;]*)/gi)];
  assert.ok(creates.length > 40);
  for (const [, rawKind, rest] of creates) {
    const kind = rawKind.toUpperCase().replace(/\s+/g, ' ');
    if (kind === 'SCHEMA') assert.match(rest, /^\s*c3\s*$/, 'only schema c3 may be created');
    else if (['TABLE', 'FUNCTION'].includes(kind)) assert.match(rest, /^\s*c3\.[a-z_]+/, `${kind} outside c3: ${rest.slice(0, 60)}`);
    else if (['INDEX', 'TRIGGER'].includes(kind)) assert.match(rest, /\sON\s+c3\.[a-z_]+/, `${kind} not on a c3 table: ${rest.slice(0, 80)}`);
    else assert.fail(`unexpected CREATE ${kind}`);
  }
  assert.deepEqual(createdTables.sort(), [
    'assessment_snapshots', 'audit_log', 'complaints', 'critical_findings', 'deliveries', 'distributors',
    'inspection_criteria', 'inspection_items', 'inspections', 'pharmacies', 'policy', 'recall_actions',
    'recalls', 'user_roles',
  ]);
});

test('no roles, extensions, default privileges, publications, policies, grants or drops', () => {
  for (const [label, code] of [['migration', schemaCode], ['seed', seedCode]]) {
    assert.doesNotMatch(code, /ALTER\s+DEFAULT\s+PRIVILEGES/i, label);
    assert.doesNotMatch(code, /CREATE\s+EXTENSION/i, label);
    assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP)\s+ROLE\b/i, label);
    assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP)\s+PUBLICATION\b/i, label);
    assert.doesNotMatch(code, /CREATE\s+POLICY/i, label);
    assert.doesNotMatch(code, /\bGRANT\b/i, label);
    assert.doesNotMatch(code, /\bDROP\b/i, label);
    assert.doesNotMatch(code, /ALTER\s+SYSTEM/i, label);
    assert.doesNotMatch(code, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i, label);
  }
  for (const [, target] of schemaCode.matchAll(/\bALTER\s+([^;]*)/gi)) {
    assert.match(target, /^TABLE c3\.[a-z_]+ ENABLE ROW LEVEL SECURITY$/, `unexpected ALTER ${target}`);
  }
  assert.doesNotMatch(seedCode, /\b(CREATE|ALTER|REVOKE)\b/i, 'the seed must not change schema or privileges');
});

test('nothing outside c3 is touched except the single foreign key to auth.users(id)', () => {
  const schemaRefs = [...schemaCode.matchAll(OTHER_SCHEMAS)].map(match => `${match[1]}.${match[2]}`.toLowerCase());
  assert.deepEqual(schemaRefs, ['auth.users']);
  assert.equal((schemaCode.match(/REFERENCES auth\.users\(id\)/g) || []).length, 1);
  assert.match(schemaCode, /user_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.deepEqual([...seedCode.matchAll(OTHER_SCHEMAS)].map(match => match[0]), []);
});

test('every c3 table has RLS enabled, with no policies and privileges revoked on c3 only', () => {
  for (const table of createdTables) {
    assert.match(schemaCode, new RegExp(`ALTER TABLE c3\\.${table} ENABLE ROW LEVEL SECURITY;`), `RLS missing on c3.${table}`);
  }
  for (const scope of ['ON SCHEMA c3', 'ON ALL TABLES IN SCHEMA c3', 'ON ALL SEQUENCES IN SCHEMA c3', 'ON ALL FUNCTIONS IN SCHEMA c3']) {
    assert.ok(schemaCode.includes(`REVOKE ALL ${scope} FROM PUBLIC, anon, authenticated;`), `missing REVOKE ${scope}`);
  }
  for (const [, target] of schemaCode.matchAll(/\bREVOKE\s+([^;]*)/gi)) {
    assert.match(target, /\b(ON SCHEMA c3|IN SCHEMA c3)\b/, `REVOKE outside c3: ${target}`);
  }
  const roleStatements = schemaCode.split(';').filter(statement => /\b(anon|authenticated)\b/.test(statement));
  assert.equal(roleStatements.length, 4);
  for (const statement of roleStatements) {
    assert.match(statement.trim(), /^REVOKE ALL /, `anon/authenticated may appear only as REVOKE targets: ${statement.trim().slice(0, 60)}`);
  }
});

test('audit log is append-only and every event table is audited and forward-only', () => {
  assert.match(schemaCode, /CREATE TRIGGER \w+ BEFORE UPDATE OR DELETE ON c3\.audit_log FOR EACH ROW EXECUTE FUNCTION c3\.reject_mutation\(\);/);
  assert.match(schemaCode, /CREATE TRIGGER \w+ BEFORE TRUNCATE ON c3\.audit_log FOR EACH STATEMENT EXECUTE FUNCTION c3\.reject_mutation\(\);/);
  for (const table of EVENT_TABLES) {
    assert.match(schemaCode, new RegExp(`CREATE TRIGGER c3_90_audit AFTER INSERT[^;]* ON c3\\.${table} FOR EACH ROW EXECUTE FUNCTION c3\\.write_audit\\(\\);`), `audit trigger missing on ${table}`);
    assert.match(schemaCode, new RegExp(`CREATE TRIGGER c3_95_no_(delete|update_delete) BEFORE (UPDATE OR )?DELETE ON c3\\.${table} `), `delete guard missing on ${table}`);
    assert.match(schemaCode, new RegExp(`CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3\\.${table} `), `truncate guard missing on ${table}`);
  }
  for (const table of ['deliveries', 'recalls', 'recall_actions', 'complaints', 'inspections', 'inspection_items']) {
    assert.match(schemaCode, new RegExp(`CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3\\.${table} `), `evidence-class check missing on ${table}`);
  }
  assert.match(schemaCode, /RAISE EXCEPTION 'c3 writes require the c3\.actor_role setting; no unattributed writes are allowed'/);
});

test('timestamp ordering and status consistency are enforced', () => {
  for (const constraint of [
    'c3_deliveries_expected_after_dispatch', 'c3_deliveries_arrival_after_dispatch', 'c3_deliveries_confirm_after_arrival',
    'c3_deliveries_status_consistency', 'c3_deliveries_note_when_not_accepted', 'c3_recalls_closed_after_issue',
    'c3_complaints_screen_after_log', 'c3_complaints_resolve_after_screen', 'c3_complaints_status_consistency',
    'c3_inspections_final_after_inspection', 'c3_snapshots_score_iff_assessable', 'c3_snapshots_tier_iff_assessable',
  ]) {
    assert.match(schemaCode, new RegExp(`CONSTRAINT ${constraint} CHECK`), constraint);
  }
  assert.match(schemaCode, /completed_at must not precede the recall issued_at/);
  assert.match(schemaCode, /blockchain_verification text NOT NULL DEFAULT 'NOT_PERFORMED' CHECK \(blockchain_verification = 'NOT_PERFORMED'\)/);
  assert.match(schemaCode, /CONSTRAINT c3_user_roles_pharmacy_scope CHECK \(\(role = 'PHARMACY_USER'\) = \(pharmacy_id IS NOT NULL\)\)/);
  assert.match(schemaCode, /CONSTRAINT c3_user_roles_distributor_scope CHECK \(\(role = 'DISTRIBUTOR'\) = \(distributor_id IS NOT NULL\)\)/);
});

test('policy v1 holds the proposed research parameters used by the scoring core', () => {
  const policy = policyV1();
  assert.equal(policy.version, 'v1');
  assert.equal(policy.parameter_status, 'PROPOSED_RESEARCH_PARAMETERS');
  assert.deepEqual({
    delivery: policy.weight_delivery, recall: policy.weight_recall,
    complaint: policy.weight_complaint, inspection: policy.weight_inspection,
  }, { ...WEIGHTS });
  assert.equal(classifyTier(policy.tier_highly_trusted_min), 'HIGHLY_TRUSTED');
  assert.equal(classifyTier(policy.tier_highly_trusted_min - 0.001), 'TRUSTED');
  assert.equal(classifyTier(policy.tier_trusted_min), 'TRUSTED');
  assert.equal(classifyTier(policy.tier_trusted_min - 0.001), 'UNDER_REVIEW');
  assert.equal(classifyTier(policy.tier_under_review_min), 'UNDER_REVIEW');
  assert.equal(classifyTier(policy.tier_under_review_min - 0.001), 'ESCALATION_ALERT');
  assert.equal(policy.delivery_confirm_window_hours, 24);
  assert.equal(policy.complaint_resolution_target_days, 30);
  assert.deepEqual([policy.inspection_points_compliant, policy.inspection_points_partial, policy.inspection_points_non_compliant], [1, 0.5, 0]);
});

const criteriaCodes = (() => {
  const block = /INSERT INTO c3\.inspection_criteria[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v\(code/.exec(schemaCode);
  return [...block[1].matchAll(/\('([A-Z0-9_]+)', \d+, '/g)].map(match => match[1]);
})();

test('prototype inspection checklist is marked unverified', () => {
  assert.equal(criteriaCodes.length, 22);
  assert.equal(new Set(criteriaCodes).size, 22);
  assert.match(schemaCode, /mapping_status text NOT NULL CHECK \(mapping_status = 'UNVERIFIED'\)/);
  assert.match(schemaCode, /'Prototype checklist; clause mapping to GL-013\/GL-014\/GL-033 still to be verified\.'/);
});

test('seed is a template whose event rows are all SEEDED_SIMULATED', () => {
  assert.doesNotMatch(seedSql, /PROTOTYPE_ENTRY/);
  assert.match(seedCode, /set_config\('c3\.actor_role', 'SEED', true\)/);
  for (const placeholder of ['<<REGULATOR_AUTH_USER_UUID>>', '<<PHARMACY_A_AUTH_USER_UUID>>', '<<PHARMACY_B_AUTH_USER_UUID>>', '<<DISTRIBUTOR_AUTH_USER_UUID>>']) {
    assert.equal((seedCode.match(new RegExp(placeholder, 'g')) || []).length, 1, placeholder);
  }
  assert.match(seedCode, /Seed template not filled in/);
  const inserts = [...seedCode.matchAll(/INSERT INTO c3\.([a-z_]+)[\s\S]*?;/g)];
  const withEvidence = inserts.filter(([, table]) => table !== 'user_roles');
  assert.equal(withEvidence.length, 8);
  for (const [statement, table] of withEvidence) {
    assert.ok(statement.includes("'SEEDED_SIMULATED'"), `${table} insert is not labelled SEEDED_SIMULATED`);
    assert.doesNotMatch(statement.replace(/'SEEDED_SIMULATED'/g, ''), /evidence_class\s*=|'[A-Z_]*ENTRY'/);
  }
  const items = dataBlock('inspection_items', ['inspection', 'criterion', 'result', 'critical']);
  for (const item of items) assert.ok(criteriaCodes.includes(item.criterion), `unknown criterion ${item.criterion}`);
});

// ---- Recompute the indicators from the seed rows, using the documented v1 eligibility rules ----

const deliveries = dataBlock('deliveries', ['ref', 'pharmacy', 'dispatched_h', 'expected_h', 'arrived_h', 'confirmation', 'confirmed_h', 'note']);
const recallActions = dataBlock('recall_actions', ['recall', 'pharmacy', 'action', 'due_h', 'completed_h']);
const recalls = dataBlock('recalls', ['ref', 'batch', 'reason', 'issued_h']);
const complaints = dataBlock('complaints', ['ref', 'pharmacy', 'logged_h', 'screening', 'screened_h', 'resolved_h']);
const inspections = dataBlock('inspections', ['ref', 'pharmacy', 'inspected_h', 'finalised_h']);
const inspectionItems = dataBlock('inspection_items', ['inspection', 'criterion', 'result', 'critical']);
const POLICY = { id: 'c3-live-policy-v1', approved: true };

function counts(pharmacy, asOf, policy) {
  const windowH = policy.delivery_confirm_window_hours;
  const d = deliveries.filter(row => row.pharmacy === pharmacy && row.arrived_h !== null && row.arrived_h <= asOf &&
    ((row.confirmed_h !== null && row.confirmed_h <= asOf) || row.arrived_h + windowH <= asOf));
  const dOk = d.filter(row => row.confirmed_h !== null && row.confirmed_h <= row.arrived_h + windowH);

  const r = recallActions.filter(row => row.pharmacy === pharmacy &&
    ((row.completed_h !== null && row.completed_h <= asOf) || row.due_h <= asOf));
  const rOk = r.filter(row => row.completed_h !== null && row.completed_h <= row.due_h);

  const dueH = row => row.screened_h + policy.complaint_resolution_target_days * 24;
  const c = complaints.filter(row => row.pharmacy === pharmacy && row.screening === 'SUBSTANTIATED' && row.screened_h <= asOf &&
    ((row.resolved_h !== null && row.resolved_h <= asOf) || dueH(row) <= asOf));
  const cOk = c.filter(row => row.resolved_h !== null && row.resolved_h <= dueH(row));

  const latest = inspections
    .filter(row => row.pharmacy === pharmacy && row.finalised_h !== null && row.finalised_h <= asOf)
    .sort((a, b) => b.inspected_h - a.inspected_h)[0] || null;
  const items = latest ? inspectionItems.filter(item => item.inspection === latest.ref) : [];
  const applicable = items.filter(item => item.result !== 'NOT_APPLICABLE');
  const points = { COMPLIANT: policy.inspection_points_compliant, PARTIAL: policy.inspection_points_partial, NON_COMPLIANT: policy.inspection_points_non_compliant };
  return {
    d, dOk, r, rOk, c, cOk, latest,
    pointsAchieved: applicable.reduce((sum, item) => sum + points[item.result], 0),
    pointsApplicable: applicable.length * policy.inspection_points_compliant,
    critical: items.filter(item => item.result === 'NON_COMPLIANT' && item.critical),
  };
}

function assess(pharmacy, asOf = STABLE_AS_OF_H) {
  const policy = policyV1();
  const k = counts(pharmacy, asOf, policy);
  const assessments = {
    delivery: assessDeliveryReliability({ onTimeCount: k.dOk.length, eligibleCommitmentCount: k.d.length, evidenceIds: k.d.map(row => row.ref), source: 'SYNTHETIC', policy: POLICY }),
    recall: assessRecallResponse({ timelyCompleteNoticeCount: k.rOk.length, eligibleNoticeCount: k.r.length, evidenceIds: k.r.map(row => `${row.recall}:${row.action}`), source: 'SYNTHETIC', policy: POLICY }),
    complaint: assessComplaintHandling({ compliantComplaintCount: k.cOk.length, eligibleComplaintCount: k.c.length, evidenceIds: k.c.map(row => row.ref), source: 'SYNTHETIC', policy: POLICY }),
    inspection: assessInspectionPerformance({ pointsAchieved: k.pointsAchieved, pointsApplicable: k.pointsApplicable, evidenceIds: k.latest && k.pointsApplicable > 0 ? [k.latest.ref] : [], source: 'SYNTHETIC', policy: POLICY }),
  };
  const findings = k.critical.map(item => ({ id: `${item.inspection}:${item.criterion}`, description: `Critical non-compliance: ${item.criterion}` }));
  const result = calculateTrustScore(toTrustScoreInput(assessments, findings));
  return { k, assessments, result, tier: classifyTier(result.score) };
}

test('every recall action falls within its recall and every deadline matures before the stable instant', () => {
  const issued = Object.fromEntries(recalls.map(row => [row.ref, row.issued_h]));
  for (const row of recallActions) {
    assert.ok(row.due_h >= issued[row.recall]);
    assert.ok(row.completed_h === null || row.completed_h >= issued[row.recall]);
    assert.ok(row.due_h < STABLE_AS_OF_H);
  }
  for (const row of deliveries) if (row.arrived_h !== null) assert.ok(row.arrived_h + 24 < STABLE_AS_OF_H);
  for (const row of complaints) if (row.screening === 'SUBSTANTIATED') assert.ok(row.screened_h + 720 < STABLE_AS_OF_H);
});

test('Pharmacy A reproduces the worked example D=70, R=75, C=66.67, I=80', () => {
  const { k, result, tier } = assess('C3-PH-A');
  assert.deepEqual([k.dOk.length, k.d.length], [7, 10]);
  assert.deepEqual([k.rOk.length, k.r.length], [9, 12]);
  assert.deepEqual([k.cOk.length, k.c.length], [4, 6]);
  assert.deepEqual([k.pointsAchieved, k.pointsApplicable], [16, 20]);
  assert.equal(k.latest.ref, 'C3-IN-A02');
  assert.equal(result.status, 'ASSESSABLE');
  assert.equal(result.breakdown.delivery.value, 70);
  assert.equal(result.breakdown.recall.value, 75);
  assert.ok(Math.abs(result.breakdown.complaint.value - 200 / 3) <= 1e-9);
  assert.equal(result.breakdown.inspection.value, 80);
  assert.ok(Math.abs(result.score - 217 / 3) <= 1e-9);
  assert.equal(tier, 'TRUSTED');
  assert.equal(result.criticalEscalation.required, false);
  // The specification's 72.334 uses C rounded to 66.67 before weighting.
  const rounded = calculateTrustScore({
    delivery: { status: 'ASSESSABLE', value: 70, evidenceCount: 10, source: 'SYNTHETIC' },
    recall: { status: 'ASSESSABLE', value: 75, evidenceCount: 12, source: 'SYNTHETIC' },
    complaint: { status: 'ASSESSABLE', value: 66.67, evidenceCount: 6, source: 'SYNTHETIC' },
    inspection: { status: 'ASSESSABLE', value: 80, evidenceCount: 1, source: 'SYNTHETIC' },
  });
  assert.ok(Math.abs(rounded.score - 72.334) <= 1e-9);
});

test('exclusions behave as designed for Pharmacy A', () => {
  const { k } = assess('C3-PH-A');
  assert.ok(!k.d.some(row => row.ref === 'C3-DL-A11'), 'an undelivered consignment is never eligible');
  assert.ok(k.dOk.some(row => row.ref === 'C3-DL-A03'), 'distributor lateness is not a pharmacy failure');
  assert.ok(k.dOk.some(row => row.ref === 'C3-DL-A07'), 'confirmation at exactly 24 h is on time');
  assert.ok(!k.c.some(row => ['C3-CP-A07', 'C3-CP-A08', 'C3-CP-A09'].includes(row.ref)), 'unsubstantiated/unscreened complaints never count');
  assert.equal(k.critical.length, 0, 'a critical item on a DRAFT inspection raises nothing');
});

test('Pharmacy B is weak and escalates a critical finding separately from its score', () => {
  const { k, result, tier } = assess('C3-PH-B');
  assert.deepEqual([k.dOk.length, k.d.length, k.rOk.length, k.r.length, k.cOk.length, k.c.length], [4, 8, 3, 8, 1, 3]);
  assert.deepEqual([k.pointsAchieved, k.pointsApplicable], [6, 12]);
  assert.equal(result.status, 'ASSESSABLE');
  assert.ok(Math.abs(result.score - (0.35 * 50 + 0.30 * 37.5 + 0.20 * 100 / 3 + 0.15 * 50)) <= 1e-9);
  assert.equal(tier, 'UNDER_REVIEW');
  assert.equal(result.criticalEscalation.required, true);
  assert.deepEqual(k.critical.map(item => item.criterion), ['CONTROLLED_MEDICINES_LOCKED']);
});

test('Pharmacy C has no recall evidence and is NOT_ASSESSABLE, never 100', () => {
  const { k, result, tier } = assess('C3-PH-C');
  assert.equal(k.r.length, 0);
  assert.equal(result.breakdown.recall.status, 'NOT_ASSESSABLE');
  assert.equal(result.breakdown.recall.value, null);
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
  assert.equal(tier, 'NOT_ASSESSABLE');
  assert.deepEqual(result.missingIndicators.map(item => item.name), ['recall']);
});

test('results are identical for any evaluation time at or after the stable instant', () => {
  for (const pharmacy of ['C3-PH-A', 'C3-PH-B', 'C3-PH-C']) {
    assert.deepEqual(assess(pharmacy, STABLE_AS_OF_H).result, assess(pharmacy, STABLE_AS_OF_H + 100000).result, pharmacy);
  }
});
