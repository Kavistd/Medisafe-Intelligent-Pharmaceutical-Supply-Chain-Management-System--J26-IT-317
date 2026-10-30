'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalDemoServer, DEMO_TOKEN, DEMO_IDS, DEMO_LABEL, HOST, DEFAULT_PORT, parsePort } = require('../run-local');

async function withServer(run) {
  const server = createLocalDemoServer();
  await new Promise(resolve => server.listen(0, HOST, resolve));
  const address = server.address();
  const base = `http://${HOST}:${address.port}`;
  try { await run(base, address); } finally { await new Promise(resolve => server.close(resolve)); }
}

function get(base, path, token = DEMO_TOKEN) {
  return fetch(`${base}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

const route = pharmacyId => `/api/v1/pharmacies/${pharmacyId}/trust-assessment`;

test('local entry point defaults to loopback and validates its configured port', () => {
  assert.equal(HOST, '127.0.0.1');
  assert.equal(DEFAULT_PORT, 5003);
  assert.equal(parsePort(undefined), 5003);
  assert.equal(parsePort('5123'), 5123);
  for (const value of ['0', '-1', '65536', '1e3', 'abc']) assert.throws(() => parsePort(value), /COMPONENT3_PORT/);
});

test('demo server listens only on loopback', async () => {
  await withServer(async (_base, address) => {
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.family, 'IPv4');
  });
});

test('unauthenticated and invalid demo credentials receive 401', async () => {
  await withServer(async base => {
    assert.equal((await get(base, route(DEMO_IDS.assessable), null)).status, 401);
    assert.equal((await get(base, route(DEMO_IDS.assessable), 'wrong-demo-token')).status, 401);
  });
});

test('demo authorization rejects pharmacy IDs outside its explicit demo namespace', async () => {
  await withServer(async base => {
    const response = await get(base, '/api/v1/pharmacies/PHARMACY-REAL-001/trust-assessment');
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error, 'FORBIDDEN');
  });
});

test('unknown demo pharmacy IDs return 404 after demo authorization', async () => {
  await withServer(async base => {
    const response = await get(base, '/api/v1/pharmacies/C3-DEMO-UNKNOWN/trust-assessment');
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error, 'PHARMACY_NOT_FOUND');
  });
});

test('insufficient synthetic evidence returns NOT_ASSESSABLE and null score', async () => {
  await withServer(async base => {
    const response = await get(base, route(DEMO_IDS.insufficient));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'NOT_ASSESSABLE');
    assert.equal(body.data.score, null);
    assert.equal(body.data.evidenceSource, 'SYNTHETIC');
    assert.equal(body.data.demoLabel, DEMO_LABEL);
  });
});

test('all demo routes label synthetic fixtures and explicitly disclaim chain verification', async () => {
  await withServer(async base => {
    for (const suffix of ['', '/evidence', '/critical-findings']) {
      const response = await get(base, `${route(DEMO_IDS.assessable)}${suffix}`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.demoLabel, DEMO_LABEL);
      assert.equal(body.data.blockchainVerification, 'NOT_PERFORMED');
      assert.match(JSON.stringify(body), /SYNTHETIC/i);
      assert.doesNotMatch(JSON.stringify(body), /represents real pharmacy performance|verified on-chain/i);
    }
  });
});

test('synthetic demo score is labelled and critical findings remain separate', async () => {
  await withServer(async base => {
    const summary = await (await get(base, route(DEMO_IDS.assessable))).json();
    assert.equal(summary.data.status, 'ASSESSABLE');
    assert.equal(summary.data.score, 80.5);
    assert.equal(summary.data.evidenceSource, 'SYNTHETIC');
    assert.equal(summary.data.criticalEscalationRequired, true);
    assert.equal(Object.hasOwn(summary.data, 'criticalEscalation'), false);

    const findings = await (await get(base, `${route(DEMO_IDS.assessable)}/critical-findings`)).json();
    assert.equal(findings.data.required, true);
    assert.equal(findings.data.findings[0].id, 'SYNTHETIC-DEMO-CRITICAL-001');
    assert.equal(Object.hasOwn(findings.data, 'score'), false);
  });
});
