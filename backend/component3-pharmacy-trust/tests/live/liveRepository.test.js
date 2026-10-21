'use strict';

// Read-only repository behaviour against a fake pg pool (no database connection).
const test = require('node:test');
const assert = require('node:assert/strict');
const { SQL, createLiveRepository } = require('../../services/live/liveRepository');
const { buildSeedRows } = require('./seedFixtures');

const REGULATOR = '11111111-1111-4111-8111-111111111111';
const PHARMACY_USER = '22222222-2222-4222-8222-222222222222';
const DISTRIBUTOR = '33333333-3333-4333-8333-333333333333';
const NOBODY = '44444444-4444-4444-8444-444444444444';

function fakePool({ failOn } = {}) {
  const rows = buildSeedRows();
  const roles = {
    [REGULATOR]: { role: 'REGULATOR', pharmacy_id: null, distributor_id: null },
    [PHARMACY_USER]: { role: 'PHARMACY_USER', pharmacy_id: 'pharmacy:C3-PH-B', distributor_id: null },
    [DISTRIBUTOR]: { role: 'DISTRIBUTOR', pharmacy_id: null, distributor_id: 'distributor:C3-DS-01' },
  };
  const inIds = (list, ids) => list.filter(row => ids.includes(row.pharmacy_id));
  const calls = [];
  let released = 0;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (failOn && sql === failOn) throw new Error('simulated read failure');
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      switch (sql) {
        case SQL.pharmacyByCode: return { rows: rows.pharmacies.filter(row => row.pharmacy_code === params[0]) };
        case SQL.pharmacyById: return { rows: rows.pharmacies.filter(row => row.id === params[0]) };
        case SQL.activePharmacies: return { rows: rows.pharmacies };
        case SQL.activeRole: return { rows: roles[params[0]] ? [roles[params[0]]] : [] };
        case SQL.policy: return { rows: params[0] === 'v1' ? [{ version: 'v1' }] : [] };
        case SQL.deliveries: return { rows: inIds(rows.deliveries, params[0]) };
        case SQL.recallActions: return { rows: inIds(rows.recallActions, params[0]) };
        case SQL.complaints: return { rows: inIds(rows.complaints, params[0]) };
        case SQL.inspections: return { rows: inIds(rows.inspections, params[0]) };
        case SQL.inspectionItems: return { rows: inIds(rows.inspectionItems, params[0]) };
        case SQL.criticalFindings: return { rows: inIds(rows.criticalFindings, params[0]) };
        default: throw new Error(`unexpected SQL: ${sql}`);
      }
    },
    release() { released += 1; },
  };
  return { pool: { connect: async () => client }, calls, released: () => released };
}

test('every statement is read-only, schema-qualified and parameterised', () => {
  for (const [name, sql] of Object.entries(SQL)) {
    assert.match(sql, /\bFROM c3\.[a-z_]+/, name);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|MERGE)\b/i, name);
    assert.doesNotMatch(sql, /\$\{/, `${name} must not interpolate values`);
    for (const [, target] of sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)/g)) {
      assert.match(target, /^c3\.[a-z_]+$/, `${name} reads ${target}, which is outside c3`);
    }
  }
});

test('reads one pharmacy bundle in a single REPEATABLE READ READ ONLY transaction', async () => {
  const fake = fakePool();
  const bundle = await createLiveRepository({ pool: fake.pool }).readPharmacyBundle('C3-PH-A');
  assert.equal(fake.calls[0].sql, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(fake.calls.at(-1).sql, 'COMMIT');
  assert.equal(fake.released(), 1);
  assert.deepEqual(fake.calls[1].params, ['C3-PH-A']);
  assert.ok(fake.calls.slice(2, -1).every(call => JSON.stringify(call.params) === JSON.stringify([['pharmacy:C3-PH-A']])));
  assert.equal(bundle.pharmacy.pharmacy_code, 'C3-PH-A');
  assert.equal(bundle.deliveries.length, 11);
  assert.equal(bundle.recallActions.length, 12);
  assert.equal(bundle.complaints.length, 9);
  assert.equal(bundle.inspections.length, 3);
  assert.ok(bundle.deliveries.every(row => row.pharmacy_id === 'pharmacy:C3-PH-A'));
});

test('unknown pharmacy returns null and invalid codes are rejected before querying', async () => {
  const fake = fakePool();
  const repo = createLiveRepository({ pool: fake.pool });
  assert.equal(await repo.readPharmacyBundle('C3-PH-UNKNOWN'), null);
  assert.equal(fake.calls.at(-1).sql, 'COMMIT');
  assert.throws(() => repo.readPharmacyBundle(''), /pharmacyCode/);
  assert.throws(() => repo.readPharmacyBundle('x'.repeat(129)), /pharmacyCode/);
});

test('visibility follows the ACTIVE c3.user_roles row', async () => {
  const fake = fakePool();
  const repo = createLiveRepository({ pool: fake.pool });
  const regulator = await repo.listVisiblePharmacies(REGULATOR);
  assert.equal(regulator.role, 'REGULATOR');
  assert.deepEqual(regulator.pharmacies.map(row => row.pharmacy_code), ['C3-PH-A', 'C3-PH-B', 'C3-PH-C']);
  const pharmacy = await repo.listVisiblePharmacies(PHARMACY_USER);
  assert.deepEqual([pharmacy.role, pharmacy.pharmacies.map(row => row.pharmacy_code)], ['PHARMACY_USER', ['C3-PH-B']]);
  const distributor = await repo.listVisiblePharmacies(DISTRIBUTOR);
  assert.deepEqual(distributor, { role: 'DISTRIBUTOR', pharmacies: [] });
  const nobody = await repo.listVisiblePharmacies(NOBODY);
  assert.deepEqual(nobody, { role: null, pharmacies: [] });
  assert.throws(() => repo.listVisiblePharmacies('not-a-uuid'), /UUID/);
});

test('regulator overview reads every pharmacy from one snapshot', async () => {
  const fake = fakePool();
  const bundles = await createLiveRepository({ pool: fake.pool }).listPharmacySummaries();
  assert.deepEqual(bundles.map(bundle => bundle.pharmacy.pharmacy_code), ['C3-PH-A', 'C3-PH-B', 'C3-PH-C']);
  assert.equal(fake.calls.filter(call => /^BEGIN/.test(call.sql)).length, 1);
  assert.equal(bundles[2].recallActions.length, 0);
  assert.equal(bundles[1].criticalFindings.length, 1);
});

test('a failed read rolls back, releases the client and rethrows', async () => {
  const fake = fakePool({ failOn: SQL.complaints });
  await assert.rejects(createLiveRepository({ pool: fake.pool }).readPharmacyBundle('C3-PH-A'), /simulated read failure/);
  assert.equal(fake.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(fake.released(), 1);
});

test('a pool with connect() is required', () => {
  assert.throws(() => createLiveRepository({}), /connect/);
});
