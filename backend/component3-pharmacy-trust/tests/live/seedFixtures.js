'use strict';

/**
 * In-memory c3 rows built by parsing the "-- @data" blocks of
 * migrations/live/002_c3_live_seed.sql (SIMULATED data). Columns that the database
 * derives are filled exactly as the 001 triggers do: deliveries.confirm_due_at =
 * arrived_at + 24 h, complaints.resolution_due_at = screened_at + 30 days, and one
 * critical_findings row per critical NON_COMPLIANT item of each FINAL inspection.
 * (The applied database showed 0 mismatches for both derived deadlines.)
 * Ids are deterministic stand-ins for the database UUIDs.
 */
const fs = require('node:fs');
const path = require('node:path');

const SEED_PATH = path.join(__dirname, '..', '..', 'migrations', 'live', '002_c3_live_seed.sql');
const seedSql = fs.readFileSync(SEED_PATH, 'utf8');
const ANCHOR_MS = Date.parse('2026-08-01T00:00:00Z');
const STABLE_NOW = new Date('2026-10-01T00:00:00Z');
const at = hours => (hours === null ? null : new Date(ANCHOR_MS + hours * 3600 * 1000));

function splitTopLevel(text) {
  const parts = [];
  let inQuote = false;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") inQuote = !inQuote;
    if (!inQuote && ch === ',') { parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseValue(token) {
  if (/^NULL$/i.test(token)) return null;
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true';
  const quoted = /^'([\s\S]*)'$/.exec(token);
  if (quoted) return quoted[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  throw new Error(`Unparseable seed value: ${token}`);
}

function dataBlock(name, columns) {
  const match = new RegExp(`-- @data ${name} begin\\r?\\n([\\s\\S]*?)\\r?\\n-- @data ${name} end`).exec(seedSql);
  if (!match) throw new Error(`Seed data block ${name} is missing.`);
  return match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const tuple = /^\(([\s\S]*)\),?$/.exec(line);
    if (!tuple) throw new Error(`Malformed seed tuple: ${line}`);
    const values = splitTopLevel(tuple[1]).map(parseValue);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function finalisedHours() {
  const block = /UPDATE c3\.inspections[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v\(inspection_ref, finalised_h\)/.exec(seedSql);
  if (!block) throw new Error('Seed finalisation block is missing.');
  return Object.fromEntries([...block[1].matchAll(/\('([^']+)', (\d+)\)/g)].map(m => [m[1], Number(m[2])]));
}

const pharmacyId = code => `pharmacy:${code}`;

function buildSeedRows() {
  const SEEDED = 'SEEDED_SIMULATED';
  const pharmacies = ['C3-PH-A', 'C3-PH-B', 'C3-PH-C'].map(code => ({
    id: pharmacyId(code), pharmacy_code: code, display_name: `Simulated ${code}`, status: 'ACTIVE', evidence_class: SEEDED,
  }));

  const deliveries = dataBlock('deliveries', ['ref', 'pharmacy', 'dispatched_h', 'expected_h', 'arrived_h', 'confirmation', 'confirmed_h', 'note'])
    .map(v => ({
      id: v.ref, delivery_ref: v.ref, pharmacy_id: pharmacyId(v.pharmacy), distributor_id: 'distributor:C3-DS-01',
      dispatched_at: at(v.dispatched_h), expected_by: at(v.expected_h), arrived_at: at(v.arrived_h),
      confirm_due_at: v.arrived_h === null ? null : at(v.arrived_h + 24),
      status: v.confirmed_h !== null ? 'CONFIRMED' : v.arrived_h !== null ? 'ARRIVED' : 'DISPATCHED',
      confirmation_status: v.confirmation, confirmed_at: at(v.confirmed_h), evidence_class: SEEDED,
    }));

  const recalls = Object.fromEntries(dataBlock('recalls', ['ref', 'batch', 'reason', 'issued_h']).map(r => [r.ref, r]));
  const recallActions = dataBlock('recall_actions', ['recall', 'pharmacy', 'action', 'due_h', 'completed_h'])
    .map(v => ({
      id: `${v.recall}:${v.pharmacy}:${v.action}`, recall_id: `recall:${v.recall}`, recall_ref: v.recall,
      issued_at: at(recalls[v.recall].issued_h), pharmacy_id: pharmacyId(v.pharmacy), action_type: v.action,
      due_at: at(v.due_h), status: v.completed_h === null ? 'OPEN' : 'COMPLETED', completed_at: at(v.completed_h), evidence_class: SEEDED,
    }));

  const complaints = dataBlock('complaints', ['ref', 'pharmacy', 'logged_h', 'screening', 'screened_h', 'resolved_h'])
    .map(v => {
      const status = v.screening === null ? 'LOGGED' : v.screening === 'UNSUBSTANTIATED' ? 'UNSUBSTANTIATED'
        : v.resolved_h !== null ? 'RESOLVED' : 'SUBSTANTIATED';
      return {
        id: v.ref, complaint_ref: v.ref, pharmacy_id: pharmacyId(v.pharmacy), status,
        logged_at: at(v.logged_h), screened_at: at(v.screened_h),
        resolution_due_at: ['SUBSTANTIATED', 'RESOLVED'].includes(status) ? at(v.screened_h + 30 * 24) : null,
        resolved_at: at(v.resolved_h), evidence_class: SEEDED,
      };
    });

  const finalised = finalisedHours();
  const inspections = dataBlock('inspections', ['ref', 'pharmacy', 'inspected_h', 'finalised_h'])
    .map(v => ({
      id: v.ref, inspection_ref: v.ref, pharmacy_id: pharmacyId(v.pharmacy), inspected_at: at(v.inspected_h),
      status: finalised[v.ref] !== undefined ? 'FINAL' : 'DRAFT', finalised_at: at(finalised[v.ref] ?? null), evidence_class: SEEDED,
    }));
  const pharmacyOfInspection = Object.fromEntries(inspections.map(row => [row.id, row.pharmacy_id]));
  const inspectionItems = dataBlock('inspection_items', ['inspection', 'criterion', 'result', 'critical'])
    .map(v => ({
      id: `${v.inspection}:${v.criterion}`, inspection_id: v.inspection, pharmacy_id: pharmacyOfInspection[v.inspection],
      criterion_code: v.criterion, result: v.result, critical: v.critical, evidence_class: SEEDED,
    }));
  const criticalFindings = inspectionItems
    .filter(item => item.result === 'NON_COMPLIANT' && item.critical)
    .map(item => ({ item, inspection: inspections.find(row => row.id === item.inspection_id) }))
    .filter(({ inspection }) => inspection.status === 'FINAL')
    .map(({ item, inspection }) => ({
      id: `finding:${item.id}`, inspection_id: inspection.id, inspection_item_id: item.id, pharmacy_id: inspection.pharmacy_id,
      criterion_code: item.criterion_code, raised_at: inspection.finalised_at, evidence_class: inspection.evidence_class,
    }));

  return { pharmacies, deliveries, recallActions, complaints, inspections, inspectionItems, criticalFindings };
}

/** Bundle for one pharmacy in the shape returned by liveRepository.readPharmacyBundle. */
function seedBundle(code, rows = buildSeedRows()) {
  const pharmacy = rows.pharmacies.find(row => row.pharmacy_code === code);
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

module.exports = { ANCHOR_MS, STABLE_NOW, at, buildSeedRows, seedBundle };
