'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('node:http');
const { createComponent3Server } = require('../server');
const { createAssessmentService } = require('../services/assessmentService');
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
} = require('../services/indicatorScoring');

const PHARMACY_ID = 'PHARMACY-TEST-01';
const criticalFinding = { id: 'SYNTHETIC-C-1', description: 'Synthetic test finding' };

function input(indicator, numerator, denominator, evidenceId) {
  const fields = {
    delivery: ['onTimeCount', 'eligibleCommitmentCount'],
    recall: ['timelyCompleteNoticeCount', 'eligibleNoticeCount'],
    complaint: ['compliantComplaintCount', 'eligibleComplaintCount'],
  };
  const source = 'SYNTHETIC';
  const policy = { id: 'synthetic-test-policy', approved: true };
  if (indicator === 'inspection') return {
    pointsAchieved: numerator,
    pointsApplicable: denominator,
    evidenceIds: denominator > 0 ? [evidenceId] : [],
    source,
    policy,
  };
  const [n, d] = fields[indicator];
  return {
    [n]: numerator,
    [d]: denominator,
    evidenceIds: Array.from({ length: denominator }, (_unused, index) => `${evidenceId}-${index}`),
    source,
    policy,
  };
}

function syntheticRecord(pharmacyId = PHARMACY_ID, overrides = {}) {
  const defaultAssessments = {
    delivery: assessDeliveryReliability(input('delivery', 4, 5, 'SYN-D')),
    recall: assessRecallResponse(input('recall', 0, 0, 'SYN-R')),
    complaint: assessComplaintHandling(input('complaint', 0, 0, 'SYN-C')),
    inspection: assessInspectionPerformance(input('inspection', 0, 0, 'SYN-I')),
  };
  const assessments = overrides.assessments || defaultAssessments;
  const evidence = Object.entries(assessments).flatMap(([indicator, assessment]) => assessment.evidenceIds.map(evidenceId => ({
    evidenceId,
    pharmacyId,
    indicator,
    eventType: 'synthetic-test-event',
    source: { system: 'component3-synthetic-test-fixture', reference: evidenceId },
    provenance: 'SYNTHETIC',
  })));
  return { pharmacyId, criticalFindings: [criticalFinding], ...overrides, assessments, evidence: overrides.evidence ?? evidence };
}

function fullyAssessableSyntheticRecord(pharmacyId = PHARMACY_ID, overrides = {}) {
  return syntheticRecord(pharmacyId, {
    assessments: {
      delivery: assessDeliveryReliability(input('delivery', 4, 5, 'SYN-D')),
      recall: assessRecallResponse(input('recall', 4, 5, 'SYN-R')),
      complaint: assessComplaintHandling(input('complaint', 3, 4, 'SYN-C')),
      inspection: assessInspectionPerformance({
        pointsAchieved: 90,
        pointsApplicable: 100,
        evidenceIds: ['SYN-I-1'],
        source: 'SYNTHETIC',
        policy: { id: 'synthetic-test-policy', approved: true },
      }),
    },
    ...overrides,
  });
}

async function withApi(options, run) {
  const server = createComponent3Server(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

function getWithBody(url, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers: { 'Content-Length': Buffer.byteLength(body) } }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { response += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(response) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function authOptions(assessmentService, extra = {}) {
  return {
    assessmentService,
    authenticate: async () => ({ subject: 'test-principal' }),
    authorizePharmacy: async ({ pharmacyId }) => pharmacyId === PHARMACY_ID,
    ...extra,
  };
}

test('returns an assessable read-only summary for an authorized explicit pharmacy ID', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async id => fullyAssessableSyntheticRecord(id) });
  await withApi(authOptions(assessmentService), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.pharmacyId, PHARMACY_ID);
    assert.equal(body.data.score, 80.5);
    assert.equal(body.data.status, 'ASSESSABLE');
    assert.equal(body.data.tier, 'HIGHLY_TRUSTED');
    assert.equal(body.data.criticalEscalationRequired, true);
    assert.equal(Object.hasOwn(body.data, 'criticalEscalation'), false);
  });
});

test('returns a clear NOT_ASSESSABLE response without manufacturing a score', async () => {
  const record = syntheticRecord(PHARMACY_ID);
  record.assessments.recall = assessRecallResponse(input('recall', 0, 0, 'SYN-R'));
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async () => record });
  await withApi(authOptions(assessmentService), async base => {
    const body = await (await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`)).json();
    assert.equal(body.data.status, 'NOT_ASSESSABLE');
    assert.equal(body.data.score, null);
    assert.equal(body.data.tier, 'NOT_ASSESSABLE');
    assert.ok(body.data.missingIndicators.length > 0);
  });
});

test('returns evidence provenance with synthetic data clearly labeled', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async id => syntheticRecord(id) });
  await withApi(authOptions(assessmentService), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment/evidence`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.indicatorEvidence.delivery.provenance, 'SYNTHETIC_TEST_DATA');
    assert.equal(body.data.indicatorEvidence.delivery.status, 'USABLE');
    assert.equal(body.data.evidenceValidation.status, 'USABLE');
    assert.equal(body.data.component1, null);
  });
});

test('does not serve an assessable score when matching evidence envelopes are missing', async () => {
  const assessmentService = createAssessmentService({
    readPharmacyAssessment: async id => fullyAssessableSyntheticRecord(id, { evidence: [] }),
  });
  await withApi(authOptions(assessmentService), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'NOT_ASSESSABLE');
    assert.equal(body.data.score, null);
    assert.ok(body.data.missingIndicators.some(item => item.name === 'delivery'));
  });
});

test('does not label a REAL source claim as independently verified', async () => {
  const record = syntheticRecord(PHARMACY_ID);
  for (const assessment of Object.values(record.assessments)) {
    assessment.indicator.status = 'NOT_ASSESSABLE';
    delete assessment.indicator.value;
    assessment.indicator.evidenceCount = 0;
    assessment.indicator.source = 'REAL';
  }
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async () => record });
  const result = await assessmentService.getAssessment(PHARMACY_ID);
  assert.equal(result.indicatorEvidence.delivery.provenance, 'DECLARED_REAL_UNVERIFIED');
  assert.equal(result.status, 'NOT_ASSESSABLE');
  assert.equal(result.score, null);
});

test('returns critical findings separately from the aggregate route', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async id => syntheticRecord(id) });
  await withApi(authOptions(assessmentService), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment/critical-findings`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.findings, [criticalFinding]);
    assert.equal(body.data.required, true);
    assert.equal(Object.hasOwn(body.data, 'score'), false);
  });
});

test('rejects malformed, missing, and wallet-shaped pharmacy IDs consistently', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async () => null });
  await withApi(authOptions(assessmentService, { authorizePharmacy: async () => true }), async base => {
    for (const path of ['/api/v1/pharmacies//trust-assessment', `/api/v1/pharmacies/${'0x' + 'a'.repeat(40)}/trust-assessment`, '/api/v1/pharmacies/%20bad/trust-assessment']) {
      const response = await fetch(base + path);
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'success']);
    }
  });
});

test('returns 404 for an unknown pharmacy', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async () => null });
  await withApi(authOptions(assessmentService, { authorizePharmacy: async () => true }), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error, 'PHARMACY_NOT_FOUND');
  });
});

test('fails closed when authentication or pharmacy authorization is unavailable', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async id => syntheticRecord(id) });
  await withApi({ assessmentService }, async base => {
    const body = await (await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`)).json();
    assert.equal(body.error, 'AUTH_CONFIGURATION_ERROR');
  });
  await withApi(authOptions(assessmentService, { authenticate: async () => null }), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    assert.equal(response.status, 401);
  });
  await withApi(authOptions(assessmentService, { authorizePharmacy: async () => false }), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    assert.equal(response.status, 403);
  });
});

test('rejects request bodies, unsupported methods, and has no public mutation route', async () => {
  const assessmentService = createAssessmentService({ readPharmacyAssessment: async id => syntheticRecord(id) });
  await withApi(authOptions(assessmentService), async base => {
    const post = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`, { method: 'POST', body: '{}' });
    const postBody = await post.json();
    assert.equal(post.status, 405);
    assert.equal(postBody.error, 'METHOD_NOT_ALLOWED');
    const getWithBodyResponse = await getWithBody(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`, '{}');
    assert.equal(getWithBodyResponse.status, 400);
    assert.equal(getWithBodyResponse.body.error, 'UNSUPPORTED_REQUEST_BODY');
    const unsupportedQuery = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment?approved=true`);
    assert.equal(unsupportedQuery.status, 400);
    assert.equal((await unsupportedQuery.json()).error, 'UNSUPPORTED_QUERY_FIELDS');
  });
});

test('returns consistent safe errors when assessment services fail', async () => {
  const assessmentService = { getAssessment: async () => { throw new Error('private database detail'); } };
  await withApi(authOptions(assessmentService), async base => {
    const response = await fetch(`${base}/api/v1/pharmacies/${PHARMACY_ID}/trust-assessment`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'success']);
    assert.doesNotMatch(JSON.stringify(body), /private database detail/);
  });
});
