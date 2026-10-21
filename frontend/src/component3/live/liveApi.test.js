import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_API_BASE, createLiveClient, mapLiveError } from './liveApi.js';

const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) });
const fail = (status, error, message = 'Internal detail: relation c3.x at line 3\n    at Object.<anonymous> (server.js:1:1)') => ({
  ok: false, status, text: async () => JSON.stringify({ success: false, error, message }),
});

function clientWith(responder, token = 'access-token') {
  const calls = [];
  const client = createLiveClient({
    getAccessToken: async () => token,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responder(url, options); },
  });
  return { client, calls };
}

test('requests go through the /c3-api proxy with the session bearer token, JSON only', async () => {
  const { client, calls } = clientWith(() => ok({ role: 'REGULATOR' }));
  assert.deepEqual(await client.getSession(), { role: 'REGULATOR' });
  await client.confirmDelivery('d-1', { confirmationStatus: 'ACCEPTED' });
  assert.equal(LIVE_API_BASE, '/c3-api');
  assert.equal(calls[0].url, '/c3-api/api/v1/live/session');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access-token');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].url, '/c3-api/api/v1/live/deliveries/d-1/confirm');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { confirmationStatus: 'ACCEPTED' });
});

test('every live route maps to the documented method and path', async () => {
  const { client, calls } = clientWith(() => ok({}));
  const cases = [
    [() => client.getCalculation('C3 PH/A'), 'GET', '/api/v1/live/pharmacies/C3%20PH%2FA/calculation'],
    [() => client.getCriticalFindings('C3-PH-A'), 'GET', '/api/v1/pharmacies/C3-PH-A/trust-assessment/critical-findings'],
    [() => client.getPharmacyTasks(), 'GET', '/api/v1/live/pharmacy/tasks'],
    [() => client.getDistributorDeliveries(), 'GET', '/api/v1/live/distributor/deliveries'],
    [() => client.getRegulatorOverview(), 'GET', '/api/v1/live/regulator/overview'],
    [() => client.getRegulatorComplaints(), 'GET', '/api/v1/live/regulator/complaints'],
    [() => client.getRegulatorRecalls(), 'GET', '/api/v1/live/regulator/recalls'],
    [() => client.getRegulatorInspections(), 'GET', '/api/v1/live/regulator/inspections'],
    [() => client.getAuditLog(25), 'GET', '/api/v1/live/regulator/audit-log?limit=25'],
    [() => client.getPharmacyDirectory(), 'GET', '/api/v1/live/pharmacy-directory'],
    [() => client.getInspectionCriteria(), 'GET', '/api/v1/live/inspection-criteria'],
    [() => client.createDelivery({}), 'POST', '/api/v1/live/deliveries'],
    [() => client.markArrived('d1'), 'POST', '/api/v1/live/deliveries/d1/arrive'],
    [() => client.completeRecallAction('a1', {}), 'POST', '/api/v1/live/recall-actions/a1/complete'],
    [() => client.resolveComplaint('c1', {}), 'POST', '/api/v1/live/complaints/c1/resolve'],
    [() => client.issueRecall({}), 'POST', '/api/v1/live/recalls'],
    [() => client.logComplaint({}), 'POST', '/api/v1/live/complaints'],
    [() => client.screenComplaint('c1', {}), 'POST', '/api/v1/live/complaints/c1/screen'],
    [() => client.recordInspection({}), 'POST', '/api/v1/live/inspections'],
    [() => client.finalizeInspection('i1'), 'POST', '/api/v1/live/inspections/i1/finalize'],
    [() => client.finalizeSnapshot('C3-PH-A'), 'POST', '/api/v1/live/pharmacies/C3-PH-A/assessment-snapshots'],
  ];
  for (const [run] of cases) await run();
  assert.deepEqual(calls.map(call => [call.options.method, call.url.replace('/c3-api', '')]), cases.map(([, method, path]) => [method, path]));
});

test('errors map to safe user-facing messages and never show server text', async () => {
  const expected = {
    401: /session has expired/i, 403: /not permitted/i, 404: /not found/i,
    409: /already been completed/i, 422: /invalid/i, 503: /temporarily unavailable/i,
  };
  for (const [status, pattern] of Object.entries(expected)) {
    const { client } = clientWith(() => fail(Number(status), 'SOMETHING_UNKNOWN'));
    await assert.rejects(client.getSession(), error => {
      assert.equal(error.status, Number(status));
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /relation|line 3|server\.js|at Object/);
      return true;
    });
  }
  const { client } = clientWith(() => fail(409, 'ALREADY_CONFIRMED'));
  await assert.rejects(client.confirmDelivery('d', {}), /already been confirmed/);
  assert.match(mapLiveError(403, 'ROLE_SUSPENDED').message, /suspended/);
  assert.match(mapLiveError(500, null).message, /temporarily unavailable/);
});

test('network failures, redirects, non-JSON bodies and missing tokens fail safely', async () => {
  await assert.rejects(clientWith(() => { throw new Error('ECONNREFUSED 127.0.0.1:5005'); }).client.getSession(), error => error.status === 0 && /Cannot reach/.test(error.message));
  await assert.rejects(clientWith(() => ({ ok: false, status: 302, redirected: true, text: async () => '' })).client.getSession(), error => error.status === 503);
  await assert.rejects(clientWith(() => ({ ok: false, status: 500, text: async () => '<html>stack trace</html>' })).client.getSession(), error => !/stack/.test(error.message));
  const noToken = clientWith(() => ok({}), '');
  await assert.rejects(noToken.client.getSession(), error => error.status === 401);
  assert.equal(noToken.calls.length, 0);
  const failingToken = createLiveClient({ getAccessToken: async () => { throw new Error('refresh failed'); }, fetchImpl: async () => ok({}) });
  await assert.rejects(failingToken.getSession(), error => error.status === 401);
});
