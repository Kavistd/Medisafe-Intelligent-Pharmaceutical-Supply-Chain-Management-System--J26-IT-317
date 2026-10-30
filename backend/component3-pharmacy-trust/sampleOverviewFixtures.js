'use strict';

/**
 * SAMPLE MODE ONLY: simulated pharmacies for the local health-authority overview.
 * Not real pharmacy data. Every fixture is built from evidence COUNTS through the
 * real indicatorScoring calculators; final scores and tiers are produced later by
 * assessmentService/trustScore and are never written by hand here.
 * Labels match the existing run-local.js fixtures (SYNTHETIC, LOCAL_SYNTHETIC_DEMO).
 */
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
} = require('./services/indicatorScoring');

const DEMO_LABEL = 'LOCAL_SYNTHETIC_DEMO';
const POLICY = Object.freeze({ id: 'local-synthetic-demo-policy', approved: true });

// [onTime, eligible] / [timely, notices] / [compliant, complaints] / [pointsAchieved, pointsApplicable]
const SAMPLE_PHARMACIES = Object.freeze([
  { id: 'C3-DEMO-PHARMACY-HT-02', d: [9, 10], r: [5, 5], c: [4, 4], i: [92, 100] },
  { id: 'C3-DEMO-PHARMACY-TR-01', d: [7, 10], r: [3, 4], c: [4, 6], i: [80, 100] },
  { id: 'C3-DEMO-PHARMACY-TR-02', d: [6, 10], r: [7, 10], c: [3, 5], i: [70, 100] },
  { id: 'C3-DEMO-PHARMACY-UR-01', d: [5, 10], r: [2, 4], c: [2, 4], i: [60, 100] },
  { id: 'C3-DEMO-PHARMACY-UR-02', d: [4, 10], r: [2, 5], c: [3, 6], i: [50, 100] },
  { id: 'C3-DEMO-PHARMACY-EA-01', d: [2, 10], r: [1, 4], c: [1, 4], i: [30, 100] },
  { id: 'C3-DEMO-PHARMACY-CRIT-01', d: [10, 10], r: [5, 5], c: [5, 5], i: [90, 100], critical: true },
  // No eligible recall notices in the window: recall (and so the overall score) is NOT_ASSESSABLE.
  { id: 'C3-DEMO-PHARMACY-NA-02', d: [8, 10], r: [0, 0], c: [3, 4], i: [85, 100] },
]);

function ids(pharmacyId, indicator, count) {
  return Array.from({ length: count }, (_unused, index) => `SYN-SAMPLE:${pharmacyId}:${indicator}:${index + 1}`);
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

function createSampleFixture(spec) {
  const pharmacyId = spec.id;
  const assessments = {
    delivery: assessDeliveryReliability({
      onTimeCount: spec.d[0], eligibleCommitmentCount: spec.d[1],
      evidenceIds: ids(pharmacyId, 'delivery', spec.d[1]), source: 'SYNTHETIC', policy: { ...POLICY },
    }),
    recall: assessRecallResponse({
      timelyCompleteNoticeCount: spec.r[0], eligibleNoticeCount: spec.r[1],
      evidenceIds: ids(pharmacyId, 'recall', spec.r[1]), source: 'SYNTHETIC', policy: { ...POLICY },
    }),
    complaint: assessComplaintHandling({
      compliantComplaintCount: spec.c[0], eligibleComplaintCount: spec.c[1],
      evidenceIds: ids(pharmacyId, 'complaint', spec.c[1]), source: 'SYNTHETIC', policy: { ...POLICY },
    }),
    inspection: assessInspectionPerformance({
      pointsAchieved: spec.i[0], pointsApplicable: spec.i[1],
      evidenceIds: spec.i[1] > 0 ? ids(pharmacyId, 'inspection', 1) : [], source: 'SYNTHETIC', policy: { ...POLICY },
    }),
  };
  const evidence = Object.entries(assessments).flatMap(([indicator, assessment]) =>
    assessment.evidenceIds.map(id => syntheticEvidence(id, pharmacyId, indicator)));
  return {
    pharmacyId,
    demoLabel: DEMO_LABEL,
    assessments,
    evidence,
    criticalFindings: spec.critical ? [{
      id: `SYNTHETIC-SAMPLE-CRITICAL:${pharmacyId}`,
      description: 'Simulated critical finding for the sample overview; not a real regulatory finding.',
      source: 'SYNTHETIC_TEST_DATA',
    }] : [],
  };
}

function createSampleOverviewFixtures() {
  return SAMPLE_PHARMACIES.map(createSampleFixture);
}

module.exports = { SAMPLE_PHARMACIES, createSampleOverviewFixtures };
