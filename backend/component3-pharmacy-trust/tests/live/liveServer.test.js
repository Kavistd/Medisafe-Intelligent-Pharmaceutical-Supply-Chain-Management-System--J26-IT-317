'use strict';

// Live API over the in-memory fake c3 database (seeded from 002_c3_live_seed.sql; SIMULATED data).
const test = require('node:test');
const assert = require('node:assert/strict');
const { roleAllows } = require('../../services/live/permissions');
const { SQL: WRITE } = require('../../services/live/liveWriteRepository');
const { TOKENS, USERS, createTestApp, call } = require('./liveTestApp');

const NOW = new Date('2026-10-02T00:00:00Z');
const inHours = hours => new Date(NOW.getTime() + hours * 3600 * 1000).toISOString();

function app() {
  const built = createTestApp({ now: NOW });
  const id = seedId => built.pool.idOf(seedId);
  const req = (token, method, url, body, extra) => call(built.handler, { token, method, url, body, ...extra });
  return { ...built, id, req };
}

test('unknown or expired tokens get 401; an auth outage gets 503 (fail closed)', async () => {
  const { req } = app();
  for (const url of ['/api/v1/live/session', '/api/v1/pharmacies/C3-PH-A/trust-assessment']) {
    assert.equal((await req(undefined, 'GET', url)).status, 401, url);
    assert.equal((await req(TOKENS.expired, 'GET', url)).status, 401, url);
    assert.equal((await req('not-a-jwt', 'GET', url)).status, 401, url);
    assert.equal((await req(TOKENS.serviceDown, 'GET', url)).status, 503, url);
  }
});

test('a suspended or role-less account is refused with 403', async () => {
  const { req } = app();
  const suspended = await req(TOKENS.suspended, 'GET', '/api/v1/live/session');
  assert.deepEqual([suspended.status, suspended.body.error], [403, 'ROLE_SUSPENDED']);
  assert.equal((await req(TOKENS.suspended, 'GET', '/api/v1/pharmacies/C3-PH-A/trust-assessment')).status, 403);
  assert.equal((await req(TOKENS.suspended, 'POST', '/api/v1/live/deliveries/00000000-0000-4000-8000-000000000000/confirm', { confirmationStatus: 'ACCEPTED' })).status, 403);
  const none = await req(TOKENS.noRole, 'GET', '/api/v1/live/session');
  assert.deepEqual([none.status, none.body.error], [403, 'NO_ACTIVE_ROLE']);
});

test('the session description comes from the database role, not from client headers', async () => {
  const { req } = app();
  const res = await req(TOKENS.pharmacyA, 'GET', '/api/v1/live/session', undefined, { headers: { 'x-c3-role': 'REGULATOR' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.role, 'PHARMACY_USER');
  assert.deepEqual(res.body.data.pharmacy, { code: 'C3-PH-A' });
  assert.deepEqual(res.body.data.accessiblePharmacies, ['C3-PH-A']);
  assert.ok(res.body.data.allowedActions.includes('delivery.confirm'));
  assert.ok(!res.body.data.allowedActions.includes('recall.issue'));
  const regulatorRoute = await req(TOKENS.pharmacyA, 'GET', '/api/v1/live/regulator/overview', undefined, { headers: { 'x-c3-role': 'REGULATOR' } });
  assert.deepEqual([regulatorRoute.status, regulatorRoute.body.error], [403, 'FORBIDDEN']);
});

const ROUTES = [
  ['GET', '/api/v1/live/session', 'session.read'],
  ['GET', '/api/v1/live/pharmacies/C3-PH-A/calculation', 'calculation.read'],
  ['GET', '/api/v1/live/pharmacy/tasks', 'workspace.pharmacy'],
  ['GET', '/api/v1/live/distributor/deliveries', 'workspace.distributor'],
  ['GET', '/api/v1/live/regulator/overview', 'overview.read'],
  ['GET', '/api/v1/live/regulator/complaints', 'workspace.regulator'],
  ['GET', '/api/v1/live/regulator/recalls', 'workspace.regulator'],
  ['GET', '/api/v1/live/regulator/inspections', 'workspace.regulator'],
  ['GET', '/api/v1/live/regulator/audit-log', 'auditLog.read'],
  ['GET', '/api/v1/live/pharmacy-directory', 'directory.read'],
  ['GET', '/api/v1/live/inspection-criteria', 'criteria.read'],
  ['POST', '/api/v1/live/deliveries', 'delivery.create'],
  ['POST', '/api/v1/live/deliveries/{C3-DL-A11}/arrive', 'delivery.markArrived'],
  ['POST', '/api/v1/live/deliveries/{C3-DL-A09}/confirm', 'delivery.confirm'],
  ['POST', '/api/v1/live/recall-actions/{C3-RC-003:C3-PH-A:CLOSE}/complete', 'recallAction.complete'],
  ['POST', '/api/v1/live/complaints/{C3-CP-A06}/resolve', 'complaint.resolve'],
  ['POST', '/api/v1/live/recalls', 'recall.issue'],
  ['POST', '/api/v1/live/complaints', 'complaint.log'],
  ['POST', '/api/v1/live/complaints/{C3-CP-A09}/screen', 'complaint.screen'],
  ['POST', '/api/v1/live/inspections', 'inspection.record'],
  ['POST', '/api/v1/live/inspections/{C3-IN-A03}/finalize', 'inspection.finalize'],
  ['POST', '/api/v1/live/pharmacies/C3-PH-A/assessment-snapshots', 'snapshot.finalize'],
];

test('every role x every route: the role gate matches the authorization matrix', async () => {
  const roles = [['REGULATOR', TOKENS.regulator], ['PHARMACY_USER', TOKENS.pharmacyA], ['DISTRIBUTOR', TOKENS.distributor]];
  let checks = 0;
  for (const [method, template, action] of ROUTES) {
    for (const [role, token] of roles) {
      const { req, id } = app();
      const url = template.replace(/\{([^}]+)\}/, (_m, seedId) => id(seedId));
      const res = await req(token, method, url, method === 'POST' ? {} : undefined);
      if (roleAllows(role, action)) {
        assert.notEqual(res.body?.error, 'FORBIDDEN', `${role} ${method} ${template}`);
        assert.ok(![401, 403].includes(res.status), `${role} ${method} ${template} -> ${res.status}`);
      } else {
        assert.deepEqual([res.status, res.body.error], [403, 'FORBIDDEN'], `${role} ${method} ${template}`);
      }
      checks += 1;
    }
  }
  assert.equal(checks, ROUTES.length * 3);
});

test('existing GET routes keep their response shapes, now backed by the live engine', async () => {
  const { req } = app();
  const assessment = await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-A/trust-assessment');
  assert.equal(assessment.status, 200);
  assert.deepEqual(Object.keys(assessment.body.data), ['pharmacyId', 'demoLabel', 'blockchainVerification', 'status', 'score', 'tier',
    'breakdown', 'missingIndicators', 'criticalEscalationRequired', 'evidenceSource', 'limitations']);
  assert.ok(Math.abs(assessment.body.data.score - 217 / 3) <= 1e-9);
  assert.equal(assessment.body.data.tier, 'TRUSTED');
  assert.equal(assessment.body.data.blockchainVerification, 'NOT_PERFORMED');
  const evidence = await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-A/trust-assessment/evidence');
  assert.deepEqual(Object.keys(evidence.body.data), ['pharmacyId', 'demoLabel', 'blockchainVerification', 'status', 'evidenceSource',
    'indicatorEvidence', 'evidenceValidation', 'component1', 'limitations']);
  assert.equal(evidence.body.data.indicatorEvidence.delivery.evidenceCount, 10);
  const findings = await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-B/trust-assessment/critical-findings');
  assert.deepEqual(Object.keys(findings.body.data), ['pharmacyId', 'demoLabel', 'blockchainVerification', 'required', 'findings']);
  assert.equal(findings.body.data.required, true);
  const session = await req(TOKENS.pharmacyA, 'GET', '/api/v1/session/pharmacies');
  assert.deepEqual(session.body.data, { pharmacies: [{ pharmacyCode: 'C3-PH-A', accessTypes: ['PHARMACY'],
    permissions: ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'] }], requiresWalletVerification: false });
  assert.equal((await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-UNKNOWN/trust-assessment')).status, 404);
});

test('a pharmacy user cannot read or change another pharmacy; a distributor reads no assessment', async () => {
  const { req, id, pool } = app();
  for (const url of ['/api/v1/pharmacies/C3-PH-B/trust-assessment', '/api/v1/pharmacies/C3-PH-B/trust-assessment/evidence',
    '/api/v1/live/pharmacies/C3-PH-B/calculation']) {
    assert.equal((await req(TOKENS.pharmacyA, 'GET', url)).status, 403, url);
  }
  const before = JSON.stringify(pool.store());
  const confirm = await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/deliveries/${id('C3-DL-B04')}/confirm`, { confirmationStatus: 'ACCEPTED' });
  assert.deepEqual([confirm.status, confirm.body.error], [404, 'DELIVERY_NOT_FOUND']);
  assert.equal((await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/recall-actions/${id('C3-RC-001:C3-PH-B:CLOSE')}/complete`, {})).status, 404);
  assert.equal((await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/complaints/${id('C3-CP-B03')}/resolve`, { note: 'x' })).status, 404);
  assert.equal(JSON.stringify(pool.store()), before, 'out-of-scope attempts change nothing');
  for (const url of ['/api/v1/pharmacies/C3-PH-A/trust-assessment', '/api/v1/pharmacies/C3-PH-A/trust-assessment/critical-findings',
    '/api/v1/live/pharmacies/C3-PH-A/calculation', '/api/v1/live/regulator/overview']) {
    assert.equal((await req(TOKENS.distributor, 'GET', url)).status, 403, url);
  }
  const tasks = await req(TOKENS.pharmacyB, 'GET', '/api/v1/live/pharmacy/tasks');
  assert.ok(tasks.body.data.deliveriesToConfirm.every(row => row.pharmacy_id === id('pharmacy:C3-PH-B')));
});

test('forward-only steps: repeating a completed step returns 409', async () => {
  const { req, id } = app();
  const confirmUrl = `/api/v1/live/deliveries/${id('C3-DL-A09')}/confirm`;
  assert.equal((await req(TOKENS.pharmacyA, 'POST', confirmUrl, { confirmationStatus: 'ACCEPTED' })).status, 200);
  assert.deepEqual((await req(TOKENS.pharmacyA, 'POST', confirmUrl, { confirmationStatus: 'ACCEPTED' })).body.error, 'ALREADY_CONFIRMED');
  const notArrived = await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/deliveries/${id('C3-DL-A11')}/confirm`, { confirmationStatus: 'ACCEPTED' });
  assert.deepEqual([notArrived.status, notArrived.body.error], [409, 'NOT_ARRIVED']);
  const arriveUrl = `/api/v1/live/deliveries/${id('C3-DL-A11')}/arrive`;
  assert.equal((await req(TOKENS.distributor, 'POST', arriveUrl, {})).status, 200);
  assert.deepEqual((await req(TOKENS.distributor, 'POST', arriveUrl, {})).status, 409);
  const actionUrl = `/api/v1/live/recall-actions/${id('C3-RC-003:C3-PH-A:CLOSE')}/complete`;
  assert.equal((await req(TOKENS.pharmacyA, 'POST', actionUrl, {})).status, 200);
  assert.equal((await req(TOKENS.pharmacyA, 'POST', actionUrl, {})).status, 409);
  const resolveUrl = `/api/v1/live/complaints/${id('C3-CP-A06')}/resolve`;
  assert.equal((await req(TOKENS.pharmacyA, 'POST', resolveUrl, { note: 'Resolved.' })).status, 200);
  assert.equal((await req(TOKENS.pharmacyA, 'POST', resolveUrl, { note: 'Again.' })).status, 409);
  const logged = await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/complaints/${id('C3-CP-A09')}/resolve`, { note: 'x' });
  assert.deepEqual([logged.status, logged.body.error], [409, 'NOT_RESOLVABLE']);
  const screenUrl = `/api/v1/live/complaints/${id('C3-CP-A09')}/screen`;
  assert.equal((await req(TOKENS.regulator, 'POST', screenUrl, { outcome: 'UNSUBSTANTIATED' })).status, 200);
  assert.equal((await req(TOKENS.regulator, 'POST', screenUrl, { outcome: 'SUBSTANTIATED' })).status, 409);
  const finalizeUrl = `/api/v1/live/inspections/${id('C3-IN-A03')}/finalize`;
  assert.equal((await req(TOKENS.regulator, 'POST', finalizeUrl, {})).status, 200);
  assert.deepEqual((await req(TOKENS.regulator, 'POST', finalizeUrl, {})).body.error, 'ALREADY_FINAL');
});

test('every write sets the verified actor first and stores PROTOTYPE_ENTRY; client actor fields are refused', async () => {
  const { req, id, pool } = app();
  const created = await req(TOKENS.distributor, 'POST', '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: inHours(24) });
  assert.equal(created.status, 201);
  await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/deliveries/${id('C3-DL-A09')}/confirm`, { confirmationStatus: 'PARTIAL', note: 'Short.' });
  await req(TOKENS.regulator, 'POST', '/api/v1/live/complaints', { pharmacyCode: 'C3-PH-B', summary: 'Prototype complaint.' });

  const expectedActor = { DISTRIBUTOR: USERS.distributor, PHARMACY_USER: USERS.pharmacyA, REGULATOR: USERS.regulator };
  let writeTransactions = 0;
  pool.log.forEach((entry, index) => {
    if (entry.sql === 'BEGIN') {
      writeTransactions += 1;
      assert.equal(pool.log[index + 1].sql, WRITE.setActor, 'the actor is set immediately after BEGIN');
      const [role, userId] = pool.log[index + 1].params;
      assert.equal(expectedActor[role], userId, 'actor role and user come from the verified principal');
    }
    if (/^\s*(INSERT|UPDATE)\b/.test(entry.sql)) {
      assert.ok(entry.actor && expectedActor[entry.actor.role] === entry.actor.userId, `write without actor: ${entry.sql.slice(0, 40)}`);
    }
  });
  assert.equal(writeTransactions, 3);
  const row = pool.store().deliveries.find(delivery => delivery.id === created.body.data.id);
  assert.equal(row.evidence_class, 'PROTOTYPE_ENTRY');
  assert.equal(row.distributor_id, pool.store().user_roles.find(r => r.user_id === USERS.distributor).distributor_id);
  assert.ok(pool.store().audit_log.every(entry => expectedActor[entry.actor_role] === entry.actor_user_id));

  const before = JSON.stringify(pool.store());
  for (const field of [{ evidence_class: 'SEEDED_SIMULATED' }, { role: 'REGULATOR' }, { actor_user_id: USERS.regulator }, { distributor_id: 'x' }]) {
    const res = await req(TOKENS.distributor, 'POST', '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: inHours(24), ...field });
    assert.deepEqual([res.status, res.body.error], [422, 'UNSUPPORTED_FIELD'], JSON.stringify(field));
  }
  assert.equal(JSON.stringify(pool.store()), before, 'refused requests write nothing');
});

test('reads never set an actor and run read-only', async () => {
  const { req, pool } = app();
  await req(TOKENS.regulator, 'GET', '/api/v1/live/regulator/overview');
  await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-A/trust-assessment');
  await req(TOKENS.regulator, 'GET', '/api/v1/live/regulator/audit-log?limit=5');
  const begins = pool.log.filter(entry => entry.sql.startsWith('BEGIN'));
  assert.ok(begins.length > 0);
  assert.ok(begins.every(entry => /READ ONLY/.test(entry.sql)));
  assert.ok(!pool.log.some(entry => entry.sql === WRITE.setActor));
});

test('input validation: types, unknown fields, sizes, content type, JSON, timestamp order, methods', async () => {
  const { req, id } = app();
  const post = (token, url, body, extra) => req(token, 'POST', url, body, extra);
  const errorOf = res => [res.status, res.body.error];
  assert.deepEqual(errorOf(await post(TOKENS.distributor, '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: 123 })), [422, 'INVALID_TIMESTAMP']);
  assert.deepEqual(errorOf(await post(TOKENS.distributor, '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: '2026-10-03T00:00:00' })), [422, 'INVALID_TIMESTAMP']);
  assert.deepEqual(errorOf(await post(TOKENS.distributor, '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: inHours(-1) })), [422, 'TIMESTAMP_ORDER']);
  assert.deepEqual(errorOf(await post(TOKENS.distributor, '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-NONE', expectedBy: inHours(5) })), [404, 'PHARMACY_NOT_FOUND']);
  assert.deepEqual(errorOf(await post(TOKENS.pharmacyA, `/api/v1/live/deliveries/${id('C3-DL-A09')}/confirm`, { confirmationStatus: 'PARTIAL' })), [422, 'MISSING_FIELD']);
  assert.deepEqual(errorOf(await post(TOKENS.pharmacyA, `/api/v1/live/deliveries/${id('C3-DL-A09')}/confirm`, { confirmationStatus: 'MAYBE' })), [422, 'INVALID_VALUE']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/inspections', { pharmacyCode: 'C3-PH-A', inspectedAt: inHours(-2),
    items: [{ criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT', critical: true }] })), [422, 'INVALID_VALUE']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/inspections', { pharmacyCode: 'C3-PH-A', inspectedAt: inHours(2),
    items: [{ criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT' }] })), [422, 'TIMESTAMP_ORDER']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/inspections', { pharmacyCode: 'C3-PH-A', inspectedAt: inHours(-2),
    items: [{ criterionCode: 'NOT_A_CRITERION', result: 'COMPLIANT' }] })), [422, 'UNKNOWN_CRITERION']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/recalls', { batchReference: 'B', reason: 'R', pharmacyCodes: ['C3-PH-A'],
    actions: [{ actionType: 'CLOSE', dueAt: inHours(5) }, { actionType: 'CLOSE', dueAt: inHours(6) }] })), [422, 'DUPLICATE_VALUE']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/recalls', { batchReference: 'B', reason: 'R', pharmacyCodes: ['C3-PH-ZZ'],
    actions: [{ actionType: 'CLOSE', dueAt: inHours(5) }] })), [422, 'UNKNOWN_PHARMACY']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/complaints', [1, 2])), [422, 'INVALID_BODY']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/complaints', undefined, { rawBody: '{"summary":' })), [400, 'INVALID_JSON']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/complaints', undefined, { rawBody: JSON.stringify({ summary: 'x'.repeat(17000) }) })), [413, 'PAYLOAD_TOO_LARGE']);
  assert.deepEqual(errorOf(await post(TOKENS.regulator, '/api/v1/live/complaints', { summary: 'x' }, { headers: { 'content-type': 'text/plain' } })), [415, 'UNSUPPORTED_MEDIA_TYPE']);
  assert.deepEqual(errorOf(await req(TOKENS.regulator, 'GET', '/api/v1/live/session?role=REGULATOR')), [400, 'UNSUPPORTED_QUERY_FIELDS']);
  assert.deepEqual(errorOf(await req(TOKENS.regulator, 'GET', '/api/v1/live/regulator/audit-log?limit=500')), [400, 'INVALID_QUERY']);
  assert.deepEqual(errorOf(await req(TOKENS.regulator, 'GET', '/api/v1/live/nothing-here')), [404, 'NOT_FOUND']);
  assert.deepEqual(errorOf(await post(TOKENS.pharmacyA, '/api/v1/live/deliveries/not-a-uuid/confirm', { confirmationStatus: 'ACCEPTED' })), [404, 'NOT_FOUND']);
  const put = await req(TOKENS.regulator, 'PUT', '/api/v1/live/complaints');
  assert.deepEqual(errorOf(put), [405, 'METHOD_NOT_ALLOWED']);
  assert.equal(put.headers.allow, 'POST');
  const options = await req(undefined, 'OPTIONS', '/api/v1/live/complaints');
  assert.equal(options.status, 405);
  assert.equal(options.headers['access-control-allow-origin'], undefined, 'no CORS headers');
  for (const res of [put, options]) assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message', 'success']);
});

test('delivery -> arrival -> confirmation recomputes the pharmacy assessment', async () => {
  const { req, advanceHours } = app();
  const calc = async () => (await req(TOKENS.regulator, 'GET', '/api/v1/live/pharmacies/C3-PH-A/calculation')).body.data;
  const before = await calc();
  assert.deepEqual([before.calculation.delivery.numerator, before.calculation.delivery.denominator], [7, 10]);

  const created = await req(TOKENS.distributor, 'POST', '/api/v1/live/deliveries', { pharmacyCode: 'C3-PH-A', expectedBy: inHours(48) });
  assert.equal(created.status, 201);
  const deliveryId = created.body.data.id;
  advanceHours(30);
  const arrived = await req(TOKENS.distributor, 'POST', `/api/v1/live/deliveries/${deliveryId}/arrive`, {});
  assert.equal(arrived.status, 200);
  assert.ok(arrived.body.data.confirm_due_at, 'the database derives the confirmation deadline');

  const waiting = await calc();
  assert.deepEqual([waiting.calculation.delivery.numerator, waiting.calculation.delivery.denominator], [7, 10]);
  assert.ok(waiting.calculation.delivery.excluded.some(item => item.id === deliveryId && item.reason === 'CONFIRMATION_WINDOW_NOT_YET_ELAPSED'));
  assert.equal(waiting.score, before.score);
  const tasks = await req(TOKENS.pharmacyA, 'GET', '/api/v1/live/pharmacy/tasks');
  assert.ok(tasks.body.data.deliveriesToConfirm.some(row => row.id === deliveryId));

  advanceHours(2);
  const confirmed = await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/deliveries/${deliveryId}/confirm`, { confirmationStatus: 'ACCEPTED' });
  assert.equal(confirmed.status, 200);
  const after = await calc();
  assert.deepEqual([after.calculation.delivery.numerator, after.calculation.delivery.denominator], [8, 11]);
  assert.ok(after.calculation.delivery.successIds.includes(deliveryId));
  assert.notEqual(after.score, before.score);
  assert.ok(Math.abs(after.breakdown.delivery.value - 800 / 11) <= 1e-9);
  assert.equal(after.provenance.label, 'Mixed: seeded simulated data and prototype entries');
});

test('regulator processes: recall, complaint, inspection with a critical finding, assessment snapshot', async () => {
  const { req, pool } = app();
  const recall = await req(TOKENS.regulator, 'POST', '/api/v1/live/recalls', {
    batchReference: 'SIM-BATCH-900', reason: 'Prototype recall.', pharmacyCodes: ['C3-PH-A', 'C3-PH-B'],
    actions: [{ actionType: 'ACKNOWLEDGE', dueAt: inHours(24) }, { actionType: 'QUARANTINE', dueAt: inHours(72) }],
  });
  assert.equal(recall.status, 201);
  assert.equal(recall.body.data.actions.length, 4);
  const actionForA = recall.body.data.actions.find(action => action.pharmacy_code === 'C3-PH-A');
  assert.equal((await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/recall-actions/${actionForA.id}/complete`, { note: 'Done.' })).status, 200);

  const complaint = await req(TOKENS.regulator, 'POST', '/api/v1/live/complaints', { pharmacyCode: 'C3-PH-A', summary: 'Prototype complaint.' });
  assert.equal(complaint.status, 201);
  const screened = await req(TOKENS.regulator, 'POST', `/api/v1/live/complaints/${complaint.body.data.id}/screen`, { outcome: 'SUBSTANTIATED' });
  assert.equal(Date.parse(screened.body.data.resolution_due_at) - Date.parse(screened.body.data.screened_at), 30 * 24 * 3600 * 1000);
  assert.equal((await req(TOKENS.pharmacyA, 'POST', `/api/v1/live/complaints/${complaint.body.data.id}/resolve`, { note: 'Resolved.' })).status, 200);

  const inspection = await req(TOKENS.regulator, 'POST', '/api/v1/live/inspections', {
    pharmacyCode: 'C3-PH-C', inspectedAt: inHours(-3),
    items: [
      { criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT' },
      { criterionCode: 'CONTROLLED_MEDICINES_LOCKED', result: 'NON_COMPLIANT', critical: true, note: 'Cabinet unlocked.' },
      { criterionCode: 'VACCINE_STORAGE_LOG', result: 'NOT_APPLICABLE' },
    ],
  });
  assert.equal(inspection.status, 201);
  assert.equal(inspection.body.data.status, 'DRAFT');
  const finalized = await req(TOKENS.regulator, 'POST', `/api/v1/live/inspections/${inspection.body.data.id}/finalize`, {});
  assert.equal(finalized.body.data.criticalFindings.length, 1);
  const findings = await req(TOKENS.regulator, 'GET', '/api/v1/pharmacies/C3-PH-C/trust-assessment/critical-findings');
  assert.equal(findings.body.data.required, true);
  const calcC = (await req(TOKENS.regulator, 'GET', '/api/v1/live/pharmacies/C3-PH-C/calculation')).body.data;
  assert.equal(calcC.calculation.inspection.inspectionId, inspection.body.data.id);
  assert.deepEqual([calcC.calculation.inspection.numerator, calcC.calculation.inspection.denominator], [1, 2]);

  const snapshot = await req(TOKENS.regulator, 'POST', '/api/v1/live/pharmacies/C3-PH-B/assessment-snapshots', {});
  assert.equal(snapshot.status, 201);
  assert.match(snapshot.body.data.assessmentHash, /^0x[0-9a-f]{64}$/);
  assert.equal(snapshot.body.data.blockchainVerification, 'NOT_PERFORMED');
  const stored = pool.store().assessment_snapshots.at(-1);
  assert.equal(stored.sha256, snapshot.body.data.assessmentHash);
  assert.equal(stored.tier, 'UNDER_REVIEW');
  assert.equal(stored.critical_escalation_required, true);
  assert.equal(stored.blockchain_verification, 'NOT_PERFORMED');
  const notAssessable = await req(TOKENS.regulator, 'POST', '/api/v1/live/pharmacies/C3-PH-C/assessment-snapshots', {});
  assert.equal(notAssessable.status, 201);
  assert.deepEqual([pool.store().assessment_snapshots.at(-1).score, pool.store().assessment_snapshots.at(-1).tier], [null, null]);
});

test('role workspaces return scoped lists', async () => {
  const { req, id } = app();
  const deliveries = await req(TOKENS.distributor, 'GET', '/api/v1/live/distributor/deliveries');
  assert.equal(deliveries.body.data.length, 24);
  const overview = await req(TOKENS.regulator, 'GET', '/api/v1/live/regulator/overview');
  assert.deepEqual(overview.body.data.map(item => [item.pharmacyId, item.tier]), [
    ['C3-PH-A', 'TRUSTED'], ['C3-PH-B', 'UNDER_REVIEW'], ['C3-PH-C', 'NOT_ASSESSABLE'],
  ]);
  const tasks = await req(TOKENS.pharmacyA, 'GET', '/api/v1/live/pharmacy/tasks');
  assert.deepEqual(tasks.body.data.deliveriesToConfirm.map(row => row.id), [id('C3-DL-A09')]);
  assert.ok(tasks.body.data.recallActionsDue.every(row => row.pharmacy_id === id('pharmacy:C3-PH-A')));
  assert.equal((await req(TOKENS.regulator, 'GET', '/api/v1/live/inspection-criteria')).body.data.length, 22);
  const directory = await req(TOKENS.distributor, 'GET', '/api/v1/live/pharmacy-directory');
  assert.deepEqual(Object.keys(directory.body.data[0]).sort(), ['display_name', 'pharmacy_code']);
});
