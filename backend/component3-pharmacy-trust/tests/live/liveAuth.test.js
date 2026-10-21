'use strict';

// Token verification and principal resolution (fake fetch and fake pool; no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bearerToken, createSupabaseTokenVerifier, createLiveAuth } = require('../../services/live/liveAuth');
const { createLiveRepository } = require('../../services/live/liveRepository');
const { USERS, createFakeC3Pool } = require('./fakeC3Pool');

const ENV = { SUPABASE_URL: 'https://example.supabase.test', SUPABASE_ANON_KEY: 'public-anon-key-for-tests' };
const USER_ID = '7d0c3a52-5b6f-4c1e-9a8b-0c2d4e6f8a1b';

function response(status, body, extra = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, ...extra };
}

test('the verifier calls /auth/v1/user without redirects and returns the user id', async () => {
  const calls = [];
  const verify = createSupabaseTokenVerifier({ env: ENV, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { id: USER_ID.toUpperCase() }); } });
  assert.equal(await verify('a.b.c'), USER_ID);
  assert.equal(calls[0].url, 'https://example.supabase.test/auth/v1/user');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.authorization, 'Bearer a.b.c');
  assert.equal(calls[0].options.headers.apikey, ENV.SUPABASE_ANON_KEY);
  assert.ok(calls[0].options.signal);
});

test('rejected, malformed and expired tokens give null; outages throw (fail closed)', async () => {
  for (const status of [400, 401, 403]) {
    assert.equal(await createSupabaseTokenVerifier({ env: ENV, fetchImpl: async () => response(status, {}) })('a.b.c'), null);
  }
  assert.equal(await createSupabaseTokenVerifier({ env: ENV, fetchImpl: async () => response(200, { id: 'not-a-uuid' }) })('a.b.c'), null);
  await assert.rejects(createSupabaseTokenVerifier({ env: ENV, fetchImpl: async () => response(500, {}) })('a.b.c'), /returned an error/);
  await assert.rejects(createSupabaseTokenVerifier({ env: ENV, fetchImpl: async () => response(302, {}) })('a.b.c'), /redirected/);
  await assert.rejects(createSupabaseTokenVerifier({ env: ENV, fetchImpl: async () => { throw new Error('offline'); } })('a.b.c'), /unavailable/);
  assert.throws(() => createSupabaseTokenVerifier({ env: { SUPABASE_URL: 'http://example.test', SUPABASE_ANON_KEY: 'k' } }), /HTTPS/);
});

test('only well-formed bearer JWTs are considered', () => {
  assert.equal(bearerToken({ headers: { authorization: 'Bearer a.b.c' } }), 'a.b.c');
  for (const header of [undefined, 'Basic a.b.c', 'Bearer abc', 'Bearer a.b', `Bearer ${'a'.repeat(9000)}.b.c`]) {
    assert.equal(bearerToken({ headers: { authorization: header } }), null, String(header).slice(0, 20));
  }
});

function makeAuth(verifier) {
  const pool = createFakeC3Pool();
  return { pool, auth: createLiveAuth({ pool, readRepository: createLiveRepository({ pool }), tokenVerifier: verifier }) };
}

test('the role and scope come from c3.user_roles, never from the request', async () => {
  const { auth } = makeAuth(async () => USERS.pharmacyA);
  const principal = await auth.authenticate({ headers: { authorization: 'Bearer a.b.c', 'x-c3-role': 'REGULATOR' }, body: { role: 'REGULATOR' } });
  assert.equal(principal.role, 'PHARMACY_USER');
  assert.equal(principal.pharmacyCode, 'C3-PH-A');
  assert.equal(principal.status, 'ACTIVE');
  assert.ok(Object.isFrozen(principal));
});

test('suspended and role-less users authenticate but have no access', async () => {
  const suspended = await makeAuth(async () => USERS.suspended).auth.authenticate({ headers: { authorization: 'Bearer a.b.c' } });
  assert.equal(suspended.status, 'SUSPENDED');
  const none = await makeAuth(async () => USERS.noRole).auth.authenticate({ headers: { authorization: 'Bearer a.b.c' } });
  assert.deepEqual([none.role, none.status], [null, 'NO_ROLE']);
});

test('missing tokens never reach the verifier; forged principals are rejected', async () => {
  let called = 0;
  const { auth } = makeAuth(async () => { called += 1; return USERS.regulator; });
  assert.equal(await auth.authenticate({ headers: {} }), null);
  assert.equal(called, 0);
  const forged = { userId: USERS.regulator, role: 'REGULATOR', status: 'ACTIVE' };
  const request = { url: '/api/v1/pharmacies/C3-PH-A/trust-assessment', headers: {} };
  assert.equal(await auth.authorizePharmacy({ principal: forged, pharmacyId: 'C3-PH-A', request }), false);
  const real = await auth.authenticate({ headers: { authorization: 'Bearer a.b.c' } });
  assert.equal(await auth.authorizePharmacy({ principal: real, pharmacyId: 'C3-PH-A', request }), true);
});

test('session pharmacy lists keep the server.js shape', async () => {
  const regulator = makeAuth(async () => USERS.regulator).auth;
  const reg = await regulator.listAuthorizedPharmacies({ principal: await regulator.authenticate({ headers: { authorization: 'Bearer a.b.c' } }) });
  assert.deepEqual(reg.pharmacies.map(item => item.pharmacyCode), ['C3-PH-A', 'C3-PH-B', 'C3-PH-C']);
  assert.deepEqual(reg.pharmacies[0].accessTypes, ['REGULATORY']);
  assert.equal(reg.requiresWalletVerification, false);
  const distributor = makeAuth(async () => USERS.distributor).auth;
  const dist = await distributor.listAuthorizedPharmacies({ principal: await distributor.authenticate({ headers: { authorization: 'Bearer a.b.c' } }) });
  assert.deepEqual(dist.pharmacies, []);
});
