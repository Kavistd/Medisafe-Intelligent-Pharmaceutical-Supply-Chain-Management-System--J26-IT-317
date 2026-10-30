'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createComponent3Auth, validateComponent3AuthConfig,
  MEMBERSHIP_SQL, WALLET_ASSIGNMENT_SQL, REGULATORY_GRANT_SQL,
  PHARMACY_ACCESS_LIST_SQL, REGULATORY_ACCESS_LIST_SQL,
} = require('../services/component3Auth');

const ENV = { SUPABASE_URL: 'https://auth.example.test', SUPABASE_ANON_KEY: 'public-test-key' };
const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN = 'header.payload.signature';
const makeRequest = suffix => ({
  url: '/api/v1/pharmacies/PH-001/trust-assessment' + (suffix ? '/' + suffix : ''),
  headers: {},
});
function makePool(handler) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return handler(sql, params); } };
}
function member(role = 'OWNER', status = 'ACTIVE', orgStatus = 'ACTIVE') {
  return { pharmacy_id: 'db-pharmacy-id', member_role: role, membership_status: status, organization_status: orgStatus };
}
function makeAuth(options = {}) {
  return createComponent3Auth({
    pool: options.pool || makePool(() => ({ rows: [] })),
    env: ENV,
    fetchImpl: options.fetchImpl || (async () => ({
      ok: true, status: 200, json: async () => ({ id: USER_ID }),
    })),
    walletVerifier: options.walletVerifier || {
      verifyPharmacyWallet: async () => '0x1234567890123456789012345678901234567890',
    },
  });
}

test('requires Supabase configuration and HTTPS outside loopback', () => {
  assert.throws(() => validateComponent3AuthConfig({}), /SUPABASE_URL and SUPABASE_ANON_KEY/);
  assert.throws(() => validateComponent3AuthConfig({
    SUPABASE_URL: 'http://auth.example.test', SUPABASE_ANON_KEY: 'x',
  }), /HTTPS/);
});
test('missing, malformed, and non-Bearer tokens are rejected before verification', async () => {
  let calls = 0;
  const auth = makeAuth({ fetchImpl: async () => { calls++; return { status: 401 }; } });
  for (const header of [undefined, 'Basic abc', 'Bearer malformed']) {
    assert.equal(await auth.authenticate({ headers: header ? { authorization: header } : {} }), null);
  }
  assert.equal(calls, 0);
});
test('Supabase Auth verifies bearer token and provides principal ID', async () => {
  let sent;
  const auth = makeAuth({ fetchImpl: async (url, options) => {
    sent = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: USER_ID }) };
  } });
  assert.deepEqual(await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }), { userId: USER_ID });
  assert.equal(sent.url, 'https://auth.example.test/auth/v1/user');
  assert.equal(sent.options.headers.apikey, ENV.SUPABASE_ANON_KEY);
  assert.equal(sent.options.headers.authorization, 'Bearer ' + TOKEN);
});
test('invalid and expired tokens are denied and verification errors fail closed', async () => {
  for (const status of [400, 401, 403]) {
    const auth = makeAuth({ fetchImpl: async () => ({ ok: false, status }) });
    assert.equal(await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }), null);
  }
  const down = makeAuth({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(down.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }));
  const unavailable = makeAuth({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(unavailable.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }));
});
test('malformed successful Auth responses and redirects fail closed', async () => {
  for (const json of [async () => null, async () => ({ id: 'not-a-user-id' })]) {
    const auth = makeAuth({ fetchImpl: async () => ({ ok: true, status: 200, json }) });
    assert.equal(await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }), null);
  }
  const malformedJson = makeAuth({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) });
  await assert.rejects(malformedJson.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }), /invalid response/);
  let optionsSeen;
  const redirected = makeAuth({ fetchImpl: async (_url, options) => {
    optionsSeen = options;
    return { ok: false, status: 302, headers: { get: () => 'https://other.invalid/' } };
  } });
  await assert.rejects(redirected.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } }), /redirected/);
  assert.equal(optionsSeen.redirect, 'manual');
});
test('inactive or removed membership, inactive organization, STAFF, and VIEWER are denied', async () => {
  for (const row of [member('OWNER', 'SUSPENDED'), member('OWNER', 'REMOVED'),
    member('OWNER', 'ACTIVE', 'SUSPENDED'), member('STAFF'), member('VIEWER')]) {
    const auth = makeAuth({ pool: makePool(sql => sql === MEMBERSHIP_SQL ? { rows: [row] } : { rows: [] }) });
    const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
    assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request: makeRequest() }), false);
  }
});
test('own-pharmacy member needs approved matching assignment and live wallet role', async () => {
  const pool = makePool(sql => sql === MEMBERSHIP_SQL ? { rows: [member()] } :
    sql === WALLET_ASSIGNMENT_SQL ? { rows: [{ wallet_address: '0x1234567890123456789012345678901234567890' }] } : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  const request = makeRequest(); request.headers['x-component4-wallet-token'] = 'signed-session';
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request }), true);
  assert.deepEqual(pool.calls.map(call => call.params), [['PH-001', USER_ID], ['db-pharmacy-id']]);
});
test('missing, duplicate, expired, revoked, and mismatched wallet assignments fail closed', async () => {
  const cases = [[], [{ wallet_address: '0x1234567890123456789012345678901234567890' },
    { wallet_address: '0x1234567890123456789012345678901234567890' }],
    [{ wallet_address: '0x0000000000000000000000000000000000000001' }]];
  for (const rows of cases) {
    const pool = makePool(sql => sql === MEMBERSHIP_SQL ? { rows: [member()] } : { rows });
    const auth = makeAuth({ pool });
    const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
    const request = makeRequest(); request.headers['x-component4-wallet-token'] = 'signed-session';
    assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request }), false);
  }
  assert.match(WALLET_ASSIGNMENT_SQL, /effective_at <= now\(\)/);
  assert.match(WALLET_ASSIGNMENT_SQL, /expires_at > now\(\)/);
  assert.match(WALLET_ASSIGNMENT_SQL, /revoked_at IS NULL/);
});
test('pharmacist cannot read critical findings and pharmacy membership is pharmacy-scoped', async () => {
  const auth = makeAuth({ pool: makePool(sql => sql === MEMBERSHIP_SQL
    ? { rows: [member('PHARMACIST')] } : { rows: [] }) });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  const request = makeRequest('critical-findings'); request.headers['x-component4-wallet-token'] = 'signed-session';
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request }), false);
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'OTHER', request: makeRequest() }), false);
});
test('regulatory access needs exact active grant, pharmacy, and permission', async () => {
  const pool = makePool(sql => sql === MEMBERSHIP_SQL ? { rows: [member('REGULATORY_REVIEWER')] }
    : sql === REGULATORY_GRANT_SQL ? { rows: [{ ok: 1 }] } : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request: makeRequest('evidence') }), true);
  assert.deepEqual(pool.calls[1].params, ['PH-001', USER_ID, 'EVIDENCE_READ']);
  assert.match(REGULATORY_GRANT_SQL, /o\.status = 'ACTIVE'/);
  assert.match(REGULATORY_GRANT_SQL, /om\.status = 'ACTIVE'/);
});
test('regulatory grantee need not belong to the pharmacy organization', async () => {
  const pool = makePool(sql => sql === MEMBERSHIP_SQL
    ? { rows: [{ pharmacy_id: 'db-pharmacy-id', member_role: null, membership_status: null, organization_status: null }] }
    : sql === REGULATORY_GRANT_SQL ? { rows: [{ ok: 1 }] } : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(await auth.authorizePharmacy({
    principal, pharmacyId: 'PH-001', request: makeRequest(),
  }), true);
});
test('technical admin has no implicit regulatory permissions', async () => {
  const pool = makePool(sql => sql === MEMBERSHIP_SQL ? { rows: [member('TECHNICAL_ADMIN')] } : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request: makeRequest() }), false);
  assert.equal(pool.calls.some(call => call.sql === REGULATORY_GRANT_SQL), true);
});
test('regulatory route requires the exact permission and a verified functional designation', async () => {
  assert.match(REGULATORY_GRANT_SQL, /component3_regulatory_designations/);
  assert.match(REGULATORY_GRANT_SQL, /verification_status = 'VERIFIED'/);
  assert.match(REGULATORY_GRANT_SQL, /verified_at IS NOT NULL/);
  assert.match(REGULATORY_GRANT_SQL, /g\.permission = \$3/);
  assert.match(REGULATORY_GRANT_SQL, /p\.pharmacy_code = \$1/);
  const pool = makePool(sql => sql === MEMBERSHIP_SQL
    ? { rows: [{ pharmacy_id: 'db-pharmacy-id', member_role: null, membership_status: null, organization_status: null }] }
    : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request: makeRequest() }), false);
});
test('authorized pharmacy discovery filters pharmacy assignments and exact regulatory grants', async () => {
  const pool = makePool((sql, params) => {
    if (sql === PHARMACY_ACCESS_LIST_SQL) return { rows: [
      { pharmacy_id: 'pharmacy-1', pharmacy_code: 'PH-001', member_role: 'OWNER' },
      { pharmacy_id: 'pharmacy-2', pharmacy_code: 'PH-002', member_role: 'PHARMACIST' },
    ] };
    if (sql === WALLET_ASSIGNMENT_SQL) return { rows: [{ wallet_address: params[0] === 'pharmacy-1'
      ? '0x1234567890123456789012345678901234567890'
      : '0x0000000000000000000000000000000000000001' }] };
    if (sql === REGULATORY_ACCESS_LIST_SQL) return { rows: [
      { pharmacy_code: 'PH-001', permission: 'ASSESSMENT_READ' },
      { pharmacy_code: 'REG-001', permission: 'ASSESSMENT_READ' },
      { pharmacy_code: 'REG-001', permission: 'EVIDENCE_READ' },
      { pharmacy_code: 'NOT-ALLOWED', permission: 'UNRECOGNIZED' },
    ] };
    return { rows: [] };
  });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  const access = await auth.listAuthorizedPharmacies({
    principal,
    request: { headers: { 'x-component4-wallet-token': 'signed-session' } },
  });
  assert.deepEqual(access, {
    pharmacies: [
      { pharmacyCode: 'PH-001', accessTypes: ['PHARMACY', 'REGULATORY'], permissions: ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'] },
      { pharmacyCode: 'REG-001', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ', 'EVIDENCE_READ'] },
    ],
    requiresWalletVerification: false,
  });
  assert.deepEqual(pool.calls[0].params, [USER_ID, ['OWNER', 'ADMIN', 'PHARMACIST']]);
  assert.deepEqual(pool.calls.at(-1).params, [USER_ID, ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ']]);
  assert.match(PHARMACY_ACCESS_LIST_SQL, /om\.status = 'ACTIVE'.*o\.status = 'ACTIVE'/s);
  assert.match(REGULATORY_ACCESS_LIST_SQL, /rd\.verification_status = 'VERIFIED'/);
  assert.match(REGULATORY_ACCESS_LIST_SQL, /g\.grant_status = 'ACTIVE'/);
});
test('pharmacy discovery does not expose memberships before wallet verification', async () => {
  const pool = makePool(sql => sql === PHARMACY_ACCESS_LIST_SQL
    ? { rows: [{ pharmacy_id: 'pharmacy-1', pharmacy_code: 'PH-001', member_role: 'OWNER' }] }
    : { rows: [] });
  const auth = makeAuth({ pool });
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  const access = await auth.listAuthorizedPharmacies({ principal, request: { headers: {} } });
  assert.deepEqual(access, { pharmacies: [], requiresWalletVerification: true });
  assert.equal(pool.calls.some(call => call.sql === WALLET_ASSIGNMENT_SQL), false);
});
test('authorization migration encodes lifecycle, uniqueness, and role protections', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_component3_authorization.sql'), 'utf8');
  assert.match(sql, /component3_runtime NOLOGIN/);
  assert.match(sql, /component3_provisioner NOLOGIN/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY c3_trigger_wallet_event_insert[\s\S]*pg_trigger_depth\(\) > 0/);
  assert.match(sql, /CREATE TRIGGER c3_no_audit_row_mutation BEFORE UPDATE OR DELETE/);
  assert.match(sql, /CREATE TRIGGER c3_no_audit_truncate BEFORE TRUNCATE/);
  assert.match(sql, /approved_at timestamptz/);
  assert.match(sql, /CHECK \(\(approved_by_profile_id IS NULL\) = \(approved_at IS NULL\)\)/);
  assert.match(sql, /CHECK \(\(approval_status = 'REVOKED'\) = \(revoked_at IS NOT NULL\)\)/);
  assert.match(sql, /CHECK \(\(grant_status = 'REVOKED'\) = \(revoked_at IS NOT NULL\)\)/);
  assert.match(sql, /Invalid Component 3 approval lifecycle transition/);
  assert.match(sql, /approved_by_profile_id <> requested_by_profile_id/);
  assert.match(sql, /approver_profile_id <> grantor_profile_id/);
  assert.match(sql, /hashtextextended\(lower\(NEW\.wallet_address\)/);
  assert.match(sql, /hashtextextended\(NEW\.pharmacy_id::text, 1\)/);
  assert.match(sql, /ORDER BY value LOOP\s+PERFORM pg_advisory_xact_lock\(lock_id\);/);
  assert.match(sql, /a\.approval_status = 'APPROVED' AND a\.revoked_at IS NULL/);
  assert.match(sql, /tstzrange\(a\.effective_at, a\.expires_at, '\[\)'\) && tstzrange\(NEW\.effective_at, NEW\.expires_at, '\[\)'\)/);
  assert.match(sql, /a\.pharmacy_id = NEW\.pharmacy_id OR lower\(a\.wallet_address\) = lower\(NEW\.wallet_address\)/);
  assert.match(sql, /Approved wallet assignment intervals overlap for this wallet or pharmacy/);
  assert.match(sql, /CREATE TRIGGER c3_wallet_active_unique BEFORE INSERT OR UPDATE OF[\s\S]*?EXECUTE FUNCTION pharmacy_trust\.component3_guard_wallet_uniqueness\(\)/);
});
test('forged principal, unsupported route, and database errors fail closed', async () => {
  const auth = makeAuth();
  assert.equal(await auth.authorizePharmacy({
    principal: { userId: USER_ID }, pharmacyId: 'PH-001', request: makeRequest(),
  }), false);
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(await auth.authorizePharmacy({ principal, pharmacyId: 'PH-001', request: { url: '/other', headers: {} } }), false);
  const broken = makeAuth({ pool: makePool(() => { throw new Error('database unavailable'); }) });
  const brokenPrincipal = await broken.authenticate({ headers: { authorization: 'Bearer ' + TOKEN } });
  await assert.rejects(broken.authorizePharmacy({ principal: brokenPrincipal, pharmacyId: 'PH-001', request: makeRequest() }), /database unavailable/);
});
