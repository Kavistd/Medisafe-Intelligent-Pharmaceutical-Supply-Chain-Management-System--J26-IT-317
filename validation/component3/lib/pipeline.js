'use strict';

/**
 * Drives SYNTHETIC validation profiles through the real Component 3 modules:
 *   synthetic evidence envelopes
 *     -> evidenceValidation.validateEvidenceSet (normalise, drop exact duplicates)
 *     -> outcome counting (the caller's role under an approved policy)
 *     -> indicatorScoring.assess* (real D/R/C/I calculators)
 *     -> assessmentService.getAssessment (real evidence gate, trustScore, classifyTier)
 * Nothing here calculates an indicator ratio, aggregate score or tier itself.
 */
const SERVICES = '../../../backend/component3-pharmacy-trust/services';
const { WEIGHTS, calculateTrustScore, classifyTier } = require(`${SERVICES}/trustScore`);
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
  toTrustScoreInput,
} = require(`${SERVICES}/indicatorScoring`);
const { CLASSIFICATION, validateEvidenceSet } = require(`${SERVICES}/evidenceValidation`);
const { createAssessmentService } = require(`${SERVICES}/assessmentService`);

const INDICATORS = Object.freeze(['delivery', 'recall', 'complaint', 'inspection']);

// Caller-asserted policy, exactly as run-local.js does for its synthetic demo.
// It is a validation fixture, not an approved real-world scoring policy.
const SYNTHETIC_POLICY = Object.freeze({ id: 'c3-validation-synthetic-policy', approved: true });

const COUNT_FIELDS = Object.freeze({
  delivery: { assess: assessDeliveryReliability, numerator: 'onTimeCount', denominator: 'eligibleCommitmentCount' },
  recall: { assess: assessRecallResponse, numerator: 'timelyCompleteNoticeCount', denominator: 'eligibleNoticeCount' },
  complaint: { assess: assessComplaintHandling, numerator: 'compliantComplaintCount', denominator: 'eligibleComplaintCount' },
});

function envelope(evidenceId, pharmacyId, indicator, metadata) {
  return {
    evidenceId,
    pharmacyId,
    indicator,
    eventType: 'synthetic-validation-event',
    source: { system: 'component3-validation-harness', reference: evidenceId },
    provenance: 'SYNTHETIC',
    metadata: { syntheticOnly: true, ...metadata },
  };
}

/**
 * One envelope per eligible record. The first `successes` records carry the
 * SUCCESS outcome, the rest FAIL.
 */
function countRecords(pharmacyId, indicator, successes, total) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || successes > total) {
    throw new Error(`Invalid synthetic counts for ${indicator}: ${successes}/${total}.`);
  }
  return Array.from({ length: total }, (_unused, index) => envelope(
    `SYN-VAL:${pharmacyId}:${indicator}:${index + 1}`,
    pharmacyId,
    indicator,
    { outcome: index < successes ? 'SUCCESS' : 'FAIL' },
  ));
}

/** One envelope per synthetic inspection report, carrying its rubric points. */
function inspectionRecords(pharmacyId, reports) {
  return reports.map((report, index) => envelope(
    `SYN-VAL:${pharmacyId}:inspection:${index + 1}`,
    pharmacyId,
    'inspection',
    { pointsAchieved: report.achieved, pointsApplicable: report.applicable },
  ));
}

/** Build the indicatorScoring input from validated (deduplicated) envelopes. */
function indicatorInput(indicator, items) {
  const evidenceIds = items.map(item => item.evidenceId);
  if (indicator === 'inspection') {
    return {
      pointsAchieved: items.reduce((sum, item) => sum + item.metadata.pointsAchieved, 0),
      pointsApplicable: items.reduce((sum, item) => sum + item.metadata.pointsApplicable, 0),
      evidenceIds,
      source: 'SYNTHETIC',
      policy: { ...SYNTHETIC_POLICY },
    };
  }
  const fields = COUNT_FIELDS[indicator];
  return {
    [fields.numerator]: items.filter(item => item.metadata.outcome === 'SUCCESS').length,
    [fields.denominator]: items.length,
    evidenceIds,
    source: 'SYNTHETIC',
    policy: { ...SYNTHETIC_POLICY },
  };
}

function assessIndicator(indicator, input) {
  return indicator === 'inspection' ? assessInspectionPerformance(input) : COUNT_FIELDS[indicator].assess(input);
}

/**
 * spec = {
 *   pharmacyId,
 *   indicators: { delivery|recall|complaint: {successes, total}, inspection: {reports: [{achieved, applicable}]} },
 *   criticalFindings?: [{id, description, source}],
 *   extraEvidence?: [envelope]   // e.g. resubmitted duplicates
 * }
 */
function buildAssessmentRecord(spec) {
  const rawEvidence = [];
  for (const name of INDICATORS) {
    const counts = spec.indicators[name];
    if (name === 'inspection') rawEvidence.push(...inspectionRecords(spec.pharmacyId, counts.reports));
    else rawEvidence.push(...countRecords(spec.pharmacyId, name, counts.successes, counts.total));
  }
  rawEvidence.push(...(spec.extraEvidence || []));

  const validation = validateEvidenceSet(rawEvidence);
  if (validation.status === CLASSIFICATION.INVALID) {
    throw new Error(`Synthetic evidence for ${spec.pharmacyId} is invalid: ${validation.reason}`);
  }
  const inputs = {};
  const assessments = {};
  for (const name of INDICATORS) {
    inputs[name] = indicatorInput(name, validation.evidence.filter(item => item.indicator === name));
    assessments[name] = assessIndicator(name, inputs[name]);
  }
  return {
    record: {
      pharmacyId: spec.pharmacyId,
      assessments,
      evidence: rawEvidence,
      criticalFindings: spec.criticalFindings || [],
    },
    validation,
    inputs,
  };
}

/** Full real-service assessment for one synthetic spec. */
async function evaluateSpec(spec) {
  const built = buildAssessmentRecord(spec);
  const service = createAssessmentService({
    readPharmacyAssessment: async pharmacyId => (pharmacyId === spec.pharmacyId ? built.record : null),
  });
  const assessment = await service.getAssessment(spec.pharmacyId);
  return { assessment, ...built };
}

/** Indicator values from a real assessment breakdown; null when NOT_ASSESSABLE. */
function indicatorValues(assessment) {
  return Object.fromEntries(INDICATORS.map(name => [name, assessment.breakdown[name].value]));
}

module.exports = {
  INDICATORS,
  WEIGHTS,
  SYNTHETIC_POLICY,
  calculateTrustScore,
  classifyTier,
  toTrustScoreInput,
  assessDeliveryReliability,
  validateEvidenceSet,
  countRecords,
  inspectionRecords,
  buildAssessmentRecord,
  evaluateSpec,
  indicatorValues,
};
