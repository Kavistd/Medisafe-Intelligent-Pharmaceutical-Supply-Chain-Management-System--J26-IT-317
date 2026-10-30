'use strict';

/**
 * Builds a Component 3 live assessment by feeding the live indicator results
 * through the EXISTING research core (indicatorScoring -> toTrustScoreInput ->
 * calculateTrustScore -> classifyTier) and evidenceValidation. Both live evidence
 * classes (SEEDED_SIMULATED, PROTOTYPE_ENTRY) are passed to the core as the
 * SYNTHETIC source label because neither is real-world verified; REAL is never used.
 * Decision support, not a regulatory determination.
 */
const { calculateTrustScore, classifyTier } = require('../trustScore');
const {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
  toTrustScoreInput,
} = require('../indicatorScoring');
const { CLASSIFICATION, validateEvidenceSet } = require('../evidenceValidation');
const { POLICY_V1, assertCompatibleWithScoringCore, scoringPolicyFor } = require('./policy');
const { computeAllIndicators } = require('./liveIndicators');

const SCORING_SOURCE = 'SYNTHETIC';
const INDICATORS = ['delivery', 'recall', 'complaint', 'inspection'];

function provenanceFor(classes) {
  const set = new Set(classes);
  const label = set.size === 0 ? 'No evidence records used'
    : set.has('SEEDED_SIMULATED') && set.has('PROTOTYPE_ENTRY') ? 'Mixed: seeded simulated data and prototype entries'
      : set.has('SEEDED_SIMULATED') ? 'Seeded simulated data'
        : 'Prototype entries';
  return {
    evidenceClasses: [...set].sort(),
    label,
    realWorldVerified: false,
    scoringSourceLabel: SCORING_SOURCE,
    note: 'Neither seeded simulated data nor prototype entries are real-world verified; the scoring core receives them as SYNTHETIC.',
  };
}

function envelopesFor(pharmacyCode, results) {
  const envelopes = [];
  for (const name of INDICATORS) {
    for (const evidenceId of results[name].evidenceIds) {
      envelopes.push({
        evidenceId,
        pharmacyId: pharmacyCode,
        indicator: name,
        eventType: `c3-live-${name}-record`,
        source: { system: 'component3-live-c3-schema', reference: evidenceId },
        provenance: 'SYNTHETIC',
        metadata: { evidenceClasses: results[name].evidenceClasses },
      });
    }
  }
  return envelopes;
}

function calculationDetails(result) {
  const shared = {
    status: result.status,
    numerator: result.numerator,
    denominator: result.denominator,
    formula: result.formula,
    excluded: result.excluded,
    evidenceIds: result.evidenceIds,
    evidenceClasses: result.evidenceClasses,
    reason: result.reason,
  };
  if (result.indicator === 'inspection') {
    return { ...shared, inspectionId: result.inspectionId, inspectionRef: result.inspectionRef, items: result.items };
  }
  return { ...shared, eligibleIds: result.eligibleIds, successIds: result.successIds, failures: result.failures, notes: result.notes };
}

/**
 * bundle: { pharmacy: { id, pharmacy_code }, deliveries, recallActions, complaints,
 *           inspections, inspectionItems, criticalFindings } (plain c3 rows)
 * options: { policy = POLICY_V1, now } -- now is required and injected.
 */
function buildLiveAssessment(bundle, { policy = POLICY_V1, now } = {}) {
  if (!bundle || typeof bundle !== 'object' || !bundle.pharmacy) throw new Error('A pharmacy bundle is required.');
  const pharmacyCode = bundle.pharmacy.pharmacy_code;
  if (typeof pharmacyCode !== 'string' || pharmacyCode.length === 0) throw new Error('The bundle pharmacy requires a pharmacy_code.');
  assertCompatibleWithScoringCore(policy);
  const results = computeAllIndicators(bundle, policy, now);
  const asOf = (now instanceof Date ? now : new Date(now)).toISOString();

  const scoringPolicy = scoringPolicyFor(policy);
  const assessments = {
    delivery: assessDeliveryReliability({
      onTimeCount: results.delivery.numerator, eligibleCommitmentCount: results.delivery.denominator,
      evidenceIds: results.delivery.evidenceIds, source: SCORING_SOURCE, policy: scoringPolicy,
    }),
    recall: assessRecallResponse({
      timelyCompleteNoticeCount: results.recall.numerator, eligibleNoticeCount: results.recall.denominator,
      evidenceIds: results.recall.evidenceIds, source: SCORING_SOURCE, policy: scoringPolicy,
    }),
    complaint: assessComplaintHandling({
      compliantComplaintCount: results.complaint.numerator, eligibleComplaintCount: results.complaint.denominator,
      evidenceIds: results.complaint.evidenceIds, source: SCORING_SOURCE, policy: scoringPolicy,
    }),
    inspection: assessInspectionPerformance({
      pointsAchieved: results.inspection.numerator, pointsApplicable: results.inspection.denominator,
      evidenceIds: results.inspection.evidenceIds, source: SCORING_SOURCE, policy: scoringPolicy,
    }),
  };

  const evidenceValidation = validateEvidenceSet(envelopesFor(pharmacyCode, results));
  if (evidenceValidation.status === CLASSIFICATION.INVALID) {
    throw new Error(`Live evidence failed structural validation: ${evidenceValidation.reason}`);
  }

  // Critical findings: stored c3.critical_findings of the latest FINAL inspection only.
  const findings = results.inspection.criticalFindings.map(finding => ({
    id: finding.id,
    description: `Critical non-compliance recorded on a finalised inspection (criterion ${finding.criterionCode}).`,
    criterionCode: finding.criterionCode,
    inspectionItemId: finding.inspectionItemId,
    raisedAt: finding.raisedAt,
    evidenceClass: finding.evidenceClass,
  }));
  const core = calculateTrustScore(toTrustScoreInput(assessments, findings));

  const allClasses = [
    ...INDICATORS.flatMap(name => results[name].evidenceClasses),
    ...findings.map(finding => finding.evidenceClass),
  ];
  return {
    pharmacyId: pharmacyCode,
    asOf,
    policyVersion: policy.version,
    policyLabel: policy.label,
    status: core.status,
    score: core.score,
    tier: classifyTier(core.score),
    breakdown: core.breakdown,
    missingIndicators: core.missingIndicators,
    criticalEscalation: core.criticalEscalation,
    criticalEscalationRequired: core.criticalEscalation.required,
    evidenceSource: core.evidenceSource,
    provenance: provenanceFor(allClasses),
    blockchainVerification: 'NOT_PERFORMED',
    evidenceValidation: {
      status: evidenceValidation.status,
      evidenceCount: evidenceValidation.evidence.length,
      duplicateCount: evidenceValidation.duplicates.length,
    },
    calculation: Object.fromEntries(INDICATORS.map(name => [name, calculationDetails(results[name])])),
    limitations: [
      'Decision support, not a regulatory determination.',
      `Weights, tier thresholds and indicator rules are ${policy.label}.`,
      'Seeded simulated data and prototype entries are not real-world verified.',
      'Inspection checklist clause mapping to GL-013/GL-014/GL-033 is still to be verified.',
      'Blockchain verification has not been performed.',
    ],
  };
}

/** Compact rows for the regulator overview, built from full assessments. */
function summarizeLiveAssessments(bundles, options) {
  return bundles
    .map(bundle => buildLiveAssessment(bundle, options))
    .map(assessment => ({
      pharmacyId: assessment.pharmacyId,
      status: assessment.status,
      score: assessment.score,
      tier: assessment.tier,
      criticalEscalationRequired: assessment.criticalEscalationRequired,
      missingIndicators: assessment.missingIndicators.map(item => item.name),
      evidenceCount: assessment.evidenceValidation.evidenceCount,
      provenance: assessment.provenance.label,
      blockchainVerification: assessment.blockchainVerification,
    }))
    .sort((left, right) => left.pharmacyId.localeCompare(right.pharmacyId));
}

module.exports = { SCORING_SOURCE, buildLiveAssessment, summarizeLiveAssessments, provenanceFor };
