import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAuthorizedPharmacies, fetchComponent3Dashboard, DEMO_BEARER_TOKEN } from './api.js';

const payload = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

test('live dashboard requests all real GET resources with bearer and wallet headers', async () => {
  const calls = [];
  const result = await fetchComponent3Dashboard({
    pharmacyCode: 'PH-001',
    accessToken: 'session-access-token',
    walletToken: 'component4-session-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return payload({ route: url });
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.some(call => call.url.endsWith('/PH-001/trust-assessment')));
  assert.ok(calls.some(call => call.url.endsWith('/PH-001/trust-assessment/evidence')));
  assert.ok(calls.some(call => call.url.endsWith('/PH-001/trust-assessment/critical-findings')));
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer session-access-token');
    assert.equal(options.headers['X-Component4-Wallet-Token'], 'component4-session-token');
  }
  assert.equal(result.assessment.route.endsWith('/trust-assessment'), true);
});

test('demo mode is explicit and sends only the public synthetic demo credential', async () => {
  const calls = [];
  await fetchComponent3Dashboard({
    mode: 'demo', pharmacyCode: 'C3-DEMO-PHARMACY-001',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return payload({}); },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ url }) => url.startsWith('/c3-demo-api/')));
  assert.ok(calls.every(({ options }) => options.headers.Authorization === `Bearer ${DEMO_BEARER_TOKEN}`));
  assert.ok(calls.every(({ options }) => !options.headers['X-Component4-Wallet-Token']));
});

test('live mode requires a token and propagates authorization and API failures', async () => {
  await assert.rejects(fetchComponent3Dashboard({ pharmacyCode: 'PH-001' }), /Supabase access token/);
  await assert.rejects(fetchComponent3Dashboard({
    pharmacyCode: 'PH-001', accessToken: 'token',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ success: false, message: 'Forbidden' }) }),
  }), /Forbidden/);
  await assert.rejects(fetchComponent3Dashboard({
    pharmacyCode: 'PH-001', accessToken: 'token',
    fetchImpl: async () => ({ ok: false, status: 302, redirected: true, json: async () => ({}) }),
  }), /redirected/);
});

test('API errors preserve unauthorized, not-found, and server-error status for dashboard states', async () => {
  for (const [status, message] of [
    [401, /Authentication is required or has expired/],
    [403, /Access is denied/],
    [404, /No assessment was found/],
    [503, /service returned an error/],
  ]) {
    await assert.rejects(fetchComponent3Dashboard({
      mode: 'demo',
      pharmacyCode: 'C3-DEMO-PHARMACY-001',
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({ success: false }),
      }),
    }), error => error.status === status && message.test(error.message));
  }
});

test('authorized pharmacy directory uses verified-session headers and validates backend permissions', async () => {
  let request;
  const directory = await fetchAuthorizedPharmacies({
    accessToken: 'supabase-session', walletToken: 'wallet-session',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return payload({ pharmacies: [{ pharmacyCode: 'PH-001', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] }], requiresWalletVerification: false });
    },
  });
  assert.equal(request.url, '/c3-api/api/v1/session/pharmacies');
  assert.equal(request.options.headers.Authorization, 'Bearer supabase-session');
  assert.equal(request.options.headers['X-Component4-Wallet-Token'], 'wallet-session');
  assert.deepEqual(directory.pharmacies[0].permissions, ['ASSESSMENT_READ']);
  await assert.rejects(fetchAuthorizedPharmacies({
    accessToken: 'supabase-session',
    fetchImpl: async () => payload({ pharmacies: [{ pharmacyCode: 'OTHER', accessTypes: ['PHARMACY'], permissions: ['ROOT'] }], requiresWalletVerification: false }),
  }), /invalid authorized-pharmacy entry/);
});

test('authorized pharmacy directory propagates unauthenticated and unavailable responses', async () => {
  await assert.rejects(fetchAuthorizedPharmacies({ accessToken: 'token', fetchImpl: async () => ({
    ok: false, status: 401, json: async () => ({ success: false, message: 'Authentication is required.' }),
  }) }), error => error.status === 401);
  await assert.rejects(fetchAuthorizedPharmacies({ accessToken: 'token', fetchImpl: async () => ({
    ok: false, status: 503, json: async () => ({ success: false, message: 'Unavailable.' }),
  }) }), error => error.status === 503);
});

test('directory reports the live proxy empty text response with status and startup guidance', async () => {
  await assert.rejects(fetchAuthorizedPharmacies({
    accessToken: 'session-token',
    fetchImpl: async url => {
      assert.equal(url, '/c3-api/api/v1/session/pharmacies');
      return { ok: false, status: 500, headers: { get: () => 'text/plain' }, text: async () => '' };
    },
  }), error => error.status === 500 && /non-JSON response/.test(error.message) &&
    /127\.0\.0\.1:5005/.test(error.message) && /authorization migration/.test(error.message));
});

test('directory preserves safe authorization-schema error details from JSON backend responses', async () => {
  await assert.rejects(fetchAuthorizedPharmacies({
    accessToken: 'session-token',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        success: false,
        error: 'AUTHORIZATION_SCHEMA_NOT_READY',
        message: 'Apply the reviewed Component 3 authorization migration.',
      }),
    }),
  }), error => error.status === 503 && error.code === 'AUTHORIZATION_SCHEMA_NOT_READY' &&
    /Apply the reviewed/.test(error.message));
});
