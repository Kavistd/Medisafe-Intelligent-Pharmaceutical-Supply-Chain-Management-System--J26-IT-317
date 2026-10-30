'use strict';

const { createComponent3Server } = require('./server');
const { createAssessmentService } = require('./services/assessmentService');
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
} = require('./services/indicatorScoring');
const { createSampleOverviewFixtures } = require('./sampleOverviewFixtures');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5003;
const DEMO_TOKEN = 'component3-local-demo';
const DEMO_LABEL = 'LOCAL_SYNTHETIC_DEMO';
const DEMO_IDS = Object.freeze({
  assessable: 'C3-DEMO-PHARMACY-001',
  insufficient: 'C3-DEMO-PHARMACY-INSUFFICIENT',
});

function parsePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  return port;
}

function syntheticEvidence(evidenceId, pharmacyId, indicator) {
  return {
    evidenceId,
    pharmacyId,
    indicator,
    eventType: 'synthetic-demo-event',
    source: { system: 'component3-local-demo-fixture', reference: evidenceId },
    provenance: 'SYNTHETIC',
    metadata: { demoOnly: true },
  };
}

function createAssessableFixture(pharmacyId) {
  const policy = { id: 'local-synthetic-demo-policy', approved: true };
  const assessments = {
    delivery: assessDeliveryReliability({
      onTimeCount: 4,
      eligibleCommitmentCount: 5,
      evidenceIds: Array.from({ length: 5 }, (_unused, index) => `SYN-DEMO-D-${index + 1}`),
      source: 'SYNTHETIC',
      policy,
    }),
    recall: assessRecallResponse({
      timelyCompleteNoticeCount: 4,
      eligibleNoticeCount: 5,
      evidenceIds: Array.from({ length: 5 }, (_unused, index) => `SYN-DEMO-R-${index + 1}`),
      source: 'SYNTHETIC',
      policy,
    }),
    complaint: assessComplaintHandling({
      compliantComplaintCount: 3,
      eligibleComplaintCount: 4,
      evidenceIds: Array.from({ length: 4 }, (_unused, index) => `SYN-DEMO-C-${index + 1}`),
      source: 'SYNTHETIC',
      policy,
    }),
    inspection: assessInspectionPerformance({
      pointsAchieved: 90,
      pointsApplicable: 100,
      evidenceIds: ['SYN-DEMO-I-1'],
      source: 'SYNTHETIC',
      policy,
    }),
  };
  const evidence = Object.entries(assessments).flatMap(([indicator, assessment]) =>
    assessment.evidenceIds.map(id => syntheticEvidence(id, pharmacyId, indicator)));
  return {
    pharmacyId,
    demoLabel: DEMO_LABEL,
    assessments,
    evidence,
    criticalFindings: [{
      id: 'SYNTHETIC-DEMO-CRITICAL-001',
      description: 'Synthetic demonstration finding; not a real regulatory finding.',
      source: 'SYNTHETIC_TEST_DATA',
    }],
  };
}

function createInsufficientFixture(pharmacyId) {
  const policy = { id: 'local-synthetic-demo-unapproved-policy', approved: false };
  const assess = (fn, input) => fn(input);
  const assessments = {
    delivery: assess(assessDeliveryReliability, { onTimeCount: 0, eligibleCommitmentCount: 0, evidenceIds: [], source: 'SYNTHETIC', policy }),
    recall: assess(assessRecallResponse, { timelyCompleteNoticeCount: 0, eligibleNoticeCount: 0, evidenceIds: [], source: 'SYNTHETIC', policy }),
    complaint: assess(assessComplaintHandling, { compliantComplaintCount: 0, eligibleComplaintCount: 0, evidenceIds: [], source: 'SYNTHETIC', policy }),
    inspection: assess(assessInspectionPerformance, { pointsAchieved: 0, pointsApplicable: 0, evidenceIds: [], source: 'SYNTHETIC', policy }),
  };
  return { pharmacyId, demoLabel: DEMO_LABEL, assessments, evidence: [], criticalFindings: [] };
}

function createDemoFixtures() {
  return new Map([
    [DEMO_IDS.assessable, createAssessableFixture(DEMO_IDS.assessable)],
    [DEMO_IDS.insufficient, createInsufficientFixture(DEMO_IDS.insufficient)],
    ...createSampleOverviewFixtures().map(fixture => [fixture.pharmacyId, fixture]),
  ]);
}

/** Sample-mode session list, in the same shape server.js expects from listAuthorizedPharmacies. */
function listDemoPharmacies(fixtures, principal) {
  if (principal?.mode !== 'LOCAL_DEMO') return { pharmacies: [], requiresWalletVerification: false };
  return {
    pharmacies: [...fixtures.keys()].sort().map(pharmacyCode => ({
      pharmacyCode,
      accessTypes: ['REGULATORY'],
      permissions: ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'],
    })),
    requiresWalletVerification: false,
  };
}

function createLocalDemoServer() {
  const fixtures = createDemoFixtures();
  const assessmentService = createAssessmentService({
    readPharmacyAssessment: async pharmacyId => fixtures.get(pharmacyId) || null,
  });
  return createComponent3Server({
    assessmentService,
    authenticate: async request => request.headers.authorization === `Bearer ${DEMO_TOKEN}`
      ? { mode: 'LOCAL_DEMO' }
      : null,
    authorizePharmacy: async ({ principal, pharmacyId }) =>
      principal?.mode === 'LOCAL_DEMO' && pharmacyId.startsWith('C3-DEMO-'),
    listAuthorizedPharmacies: async ({ principal }) => listDemoPharmacies(fixtures, principal),
  });
}

function startLocalDemo({ port = parsePort(process.env.COMPONENT3_PORT), logger = console } = {}) {
  const server = createLocalDemoServer();
  server.listen(port, HOST, () => {
    logger.log(`Component 3 synthetic demo listening at http://${HOST}:${server.address().port}`);
    logger.log(`Demo bearer token: ${DEMO_TOKEN} (local demonstration only; not production authentication)`);
    logger.log(`Synthetic example pharmacy: ${DEMO_IDS.assessable}`);
    logger.log(`Insufficient-evidence example: ${DEMO_IDS.insufficient}`);
  });
  return server;
}

if (require.main === module) {
  try {
    startLocalDemo();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  HOST, DEFAULT_PORT, DEMO_TOKEN, DEMO_IDS, DEMO_LABEL, parsePort,
  createDemoFixtures, listDemoPharmacies, createLocalDemoServer, startLocalDemo,
};
