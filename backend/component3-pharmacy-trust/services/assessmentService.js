'use strict';

const { calculateTrustScore, classifyTier } = require('./trustScore');
const { toTrustScoreInput } = require('./indicatorScoring');
const { CLASSIFICATION, validateEvidenceSet } = require('./evidenceValidation');
const { adaptComponent1Evidence } = require('./component1EvidenceAdapter');

const INDICATORS = ['delivery', 'recall', 'complaint', 'inspection'];
const RECORD_FIELDS = new Set(['pharmacyId', 'assessments', 'criticalFindings', 'criticalEscalationRequired', 'evidence', 'component1Snapshot', 'demoLabel']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function buildIndicatorEvidence(assessments) {
  return Object.fromEntries(INDICATORS.map(name => {
    const assessment = assessments[name];
    const indicator = assessment.indicator;
    return [name, {
      status: indicator.status === 'NOT_ASSESSABLE'
        ? CLASSIFICATION.INSUFFICIENT
        : indicator.source === 'SYNTHETIC' ? CLASSIFICATION.USABLE : CLASSIFICATION.REQUIRES_VERIFICATION,
      evidenceCount: indicator.evidenceCount,
      provenance: indicator.source === 'SYNTHETIC' ? 'SYNTHETIC_TEST_DATA' : 'DECLARED_REAL_UNVERIFIED',
      evidenceIds: Array.isArray(assessment.evidenceIds) ? [...assessment.evidenceIds] : [],
      reason: assessment.reason || (indicator.status === 'NOT_ASSESSABLE' ? 'Indicator evidence or approved policy is insufficient.' : null),
    }];
  }));
}

function applyEvidenceGate(assessments, pharmacyId, evidenceValidation) {
  const knownEvidence = new Map(evidenceValidation.evidence.map(item => [item.evidenceId, item]));
  const canUseAnyEvidence = evidenceValidation.status !== CLASSIFICATION.INVALID;
  const gated = {};
  for (const name of INDICATORS) {
    const assessment = assessments[name];
    const indicator = assessment?.indicator;
    if (!indicator || indicator.status !== 'ASSESSABLE') {
      gated[name] = assessment;
      continue;
    }

    const ids = assessment.evidenceIds;
    const referencesValid = canUseAnyEvidence && Array.isArray(ids) && ids.length > 0 &&
      ids.every(id => {
        const item = knownEvidence.get(id);
        return item && item.pharmacyId === pharmacyId && item.indicator === name && item.provenance === 'SYNTHETIC';
      });
    const sourceMayBeUsed = indicator.source === 'SYNTHETIC';
    if (referencesValid && sourceMayBeUsed) {
      gated[name] = assessment;
      continue;
    }

    const reason = indicator.source === 'REAL'
      ? 'Declared REAL evidence has no independent verification adapter.'
      : 'Validated synthetic evidence envelopes matching the pharmacy, indicator, and evidence IDs are unavailable.';
    const unavailable = { ...indicator, status: 'NOT_ASSESSABLE' };
    delete unavailable.value;
    gated[name] = { ...assessment, indicator: unavailable, reason };
  }
  return gated;
}

/**
 * Create a read-only assessment service. `readPharmacyAssessment` is a trusted,
 * server-side dependency, never populated from public request bodies.
 */
function createAssessmentService({ readPharmacyAssessment } = {}) {
  if (typeof readPharmacyAssessment !== 'function') {
    throw new Error('readPharmacyAssessment must be supplied by the hosting service.');
  }

  async function getAssessment(pharmacyId) {
    const record = await readPharmacyAssessment(pharmacyId);
    if (record === null || record === undefined) return null;
    if (!isPlainObject(record)) throw new Error('Assessment provider returned an invalid record.');
    for (const key of Object.keys(record)) {
      if (!RECORD_FIELDS.has(key)) throw new Error(`Assessment provider returned unsupported field "${key}".`);
    }
    if (record.pharmacyId !== pharmacyId) throw new Error('Assessment provider pharmacy ID did not match the requested ID.');
    if (record.demoLabel !== undefined && record.demoLabel !== 'LOCAL_SYNTHETIC_DEMO') {
      throw new Error('Assessment provider demoLabel is unsupported.');
    }
    if (record.criticalEscalationRequired !== undefined && typeof record.criticalEscalationRequired !== 'boolean') {
      throw new Error('Assessment provider criticalEscalationRequired must be a boolean when supplied.');
    }
    if (!isPlainObject(record.assessments)) throw new Error('Assessment provider must return indicator assessments.');

    const evidence = validateEvidenceSet(record.evidence === undefined ? [] : record.evidence);
    const gatedAssessments = applyEvidenceGate(record.assessments, pharmacyId, evidence);
    const trustScore = calculateTrustScore(toTrustScoreInput(gatedAssessments, record.criticalFindings));
    const component1 = record.component1Snapshot === undefined
      ? null
      : adaptComponent1Evidence(record.component1Snapshot);

    return {
      pharmacyId,
      demoLabel: record.demoLabel || null,
      status: trustScore.status,
      score: trustScore.score,
      tier: classifyTier(trustScore.score),
      breakdown: trustScore.breakdown,
      missingIndicators: trustScore.missingIndicators,
      evidenceSource: trustScore.evidenceSource,
      indicatorEvidence: buildIndicatorEvidence(gatedAssessments),
      evidenceValidation: {
        status: evidence.status,
        reason: evidence.reason,
        evidenceCount: evidence.evidence.length,
        duplicateCount: evidence.duplicates.length,
        conflictCount: evidence.conflicts.length,
        invalidCount: evidence.invalid.length,
      },
      component1,
      criticalEscalation: {
        required: trustScore.criticalEscalation.required || record.criticalEscalationRequired === true,
        findings: trustScore.criticalEscalation.findings,
      },
      limitations: [
        'This is a read-only off-chain research assessment; it does not update or mirror blockchain trust state.',
        'REAL is a declared source label and does not establish evidence authenticity.',
        'Synthetic values are prototype fixtures and are not real pharmacy performance.',
        ...(record.criticalEscalationRequired === true && trustScore.criticalEscalation.findings.length === 0
          ? ['The source records an escalation flag but provides no critical-finding details; no finding has been created.']
          : []),
      ],
    };
  }

  return Object.freeze({ getAssessment });
}

module.exports = { createAssessmentService };
