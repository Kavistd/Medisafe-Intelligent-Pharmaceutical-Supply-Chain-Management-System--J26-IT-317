'use strict';

/**
 * Pure indicator rate calculators. Numerator/denominator outcome classification and
 * evidence verification belong to the caller and must follow an approved policy.
 * `policy.approved` is a caller assertion, not independently verified here. No
 * deadlines, source records, APIs, or blockchain state are inferred or accessed.
 *
 * Count inputs:
 *   delivery: onTimeCount / eligibleCommitmentCount
 *   recall: timelyCompleteNoticeCount / eligibleNoticeCount
 *   complaint: compliantComplaintCount / eligibleComplaintCount
 * Inspection inputs: pointsAchieved / pointsApplicable under the supplied rubric.
 * Every input also requires unique evidenceIds and source (SYNTHETIC or REAL).
 * Results wrap the aggregate-compatible `indicator` object with reason, policyId,
 * evidenceIds, and metric metadata. Use toTrustScoreInput to adapt four results.
 */
const INDICATOR_FIELDS = Object.freeze({
  delivery: Object.freeze({ numerator: 'onTimeCount', denominator: 'eligibleCommitmentCount' }),
  recall: Object.freeze({ numerator: 'timelyCompleteNoticeCount', denominator: 'eligibleNoticeCount' }),
  complaint: Object.freeze({ numerator: 'compliantComplaintCount', denominator: 'eligibleComplaintCount' }),
  inspection: Object.freeze({ numerator: 'pointsAchieved', denominator: 'pointsApplicable' }),
});
const VALID_SOURCES = new Set(['SYNTHETIC', 'REAL']);
const INDICATOR_NAMES = Object.freeze(Object.keys(INDICATOR_FIELDS));

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateInput(indicator, input) {
  if (!isPlainObject(input)) throw new Error(`${indicator} assessment input must be a plain object.`);
  const config = INDICATOR_FIELDS[indicator];
  const allowed = [config.numerator, config.denominator, 'evidenceIds', 'source', 'policy'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new Error(`${indicator} assessment contains unsupported property "${key}".`);
  }
  for (const key of [config.numerator, config.denominator, 'evidenceIds', 'source']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`${indicator} assessment requires "${key}".`);
  }
  if (!Array.isArray(input.evidenceIds)) throw new Error(`${indicator} evidenceIds must be an array.`);
  const evidenceIds = input.evidenceIds.map((id, index) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`${indicator} evidenceIds[${index}] must be a non-empty string.`);
    }
    return id;
  });
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error(`${indicator} evidenceIds contain duplicates; deduplicate using authoritative source identifiers.`);
  }
  if (!VALID_SOURCES.has(input.source)) throw new Error(`${indicator} source must be SYNTHETIC or REAL.`);

  const numerator = input[config.numerator];
  const denominator = input[config.denominator];
  if (typeof numerator !== 'number' || !Number.isFinite(numerator) || numerator < 0) {
    throw new Error(`${indicator} ${config.numerator} must be a finite non-negative number.`);
  }
  if (typeof denominator !== 'number' || !Number.isFinite(denominator) || denominator < 0) {
    throw new Error(`${indicator} ${config.denominator} must be a finite non-negative number.`);
  }
  if (indicator !== 'inspection' && (!Number.isInteger(numerator) || !Number.isInteger(denominator))) {
    throw new Error(`${indicator} numerator and denominator must be integer record counts.`);
  }
  if (numerator > denominator) throw new Error(`${indicator} numerator cannot exceed its denominator.`);
  if (indicator !== 'inspection' && denominator !== evidenceIds.length) {
    throw new Error(`${indicator} eligible record count must match the number of unique evidenceIds.`);
  }
  if (denominator > 0 && evidenceIds.length === 0) {
    throw new Error(`${indicator} positive denominator requires at least one evidenceId.`);
  }
  if (denominator === 0 && numerator !== 0) throw new Error(`${indicator} numerator must be zero when the denominator is zero.`);

  let policy = null;
  if (Object.prototype.hasOwnProperty.call(input, 'policy') && input.policy !== undefined) {
    if (!isPlainObject(input.policy)) throw new Error(`${indicator} policy must be a plain object when supplied.`);
    for (const key of Object.keys(input.policy)) {
      if (!['id', 'approved'].includes(key)) throw new Error(`${indicator} policy contains unsupported property "${key}".`);
    }
    if (typeof input.policy.id !== 'string' || input.policy.id.trim().length === 0 || typeof input.policy.approved !== 'boolean') {
      throw new Error(`${indicator} policy requires a non-empty id and boolean approved flag.`);
    }
    policy = { id: input.policy.id, approved: input.policy.approved };
  }
  return { numerator, denominator, evidenceIds, source: input.source, policy };
}

function assess(indicator, input) {
  const normalized = validateInput(indicator, input);
  const config = INDICATOR_FIELDS[indicator];
  const evidenceCount = normalized.evidenceIds.length;
  let reason = null;
  let value;
  let status = 'NOT_ASSESSABLE';

  if (!normalized.policy) {
    reason = 'No approved scoring policy was supplied.';
  } else if (!normalized.policy.approved) {
    reason = 'The supplied scoring policy has not been approved for assessment.';
  } else if (normalized.denominator === 0) {
    reason = 'No eligible evidence is available for the assessment window.';
  } else {
    // These are the specification's candidate ratios. Caller supplies eligible
    // outcomes under the identified policy; this module does not infer them.
    value = 100 * normalized.numerator / normalized.denominator;
    status = 'ASSESSABLE';
  }

  const indicatorResult = { status };
  if (status === 'ASSESSABLE') indicatorResult.value = value;
  indicatorResult.evidenceCount = evidenceCount;
  indicatorResult.source = normalized.source;
  return {
    indicator: indicatorResult,
    reason,
    policyId: normalized.policy?.id ?? null,
    evidenceIds: [...normalized.evidenceIds],
    metric: {
      numerator: normalized.numerator,
      denominator: normalized.denominator,
      numeratorField: config.numerator,
      denominatorField: config.denominator,
    },
  };
}

function assessDeliveryReliability(input) { return assess('delivery', input); }
function assessRecallResponse(input) { return assess('recall', input); }
function assessComplaintHandling(input) { return assess('complaint', input); }
function assessInspectionPerformance(input) { return assess('inspection', input); }

/** Convert four assessment results to the exact input contract of calculateTrustScore. */
function toTrustScoreInput(assessments, criticalFindings = []) {
  if (!isPlainObject(assessments)) throw new Error('Assessments must be a plain object.');
  const result = {};
  for (const name of INDICATOR_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(assessments, name) ||
        !isPlainObject(assessments[name]) || !isPlainObject(assessments[name].indicator)) {
      throw new Error(`Assessments require a valid "${name}" result.`);
    }
    const current = assessments[name].indicator;
    if (!['ASSESSABLE', 'NOT_ASSESSABLE'].includes(current.status) ||
        !Number.isInteger(current.evidenceCount) || current.evidenceCount < 0 ||
        !VALID_SOURCES.has(current.source)) {
      throw new Error(`Assessment "${name}" does not match the trust score input contract.`);
    }
    const adapted = { status: current.status, evidenceCount: current.evidenceCount, source: current.source };
    if (current.status === 'ASSESSABLE') {
      if (typeof current.value !== 'number' || !Number.isFinite(current.value) || current.value < 0 || current.value > 100) {
        throw new Error(`Assessment "${name}" value must be between 0 and 100.`);
      }
      adapted.value = current.value;
    } else if (Object.prototype.hasOwnProperty.call(current, 'value')) {
      throw new Error(`Not-assessable assessment "${name}" must omit value.`);
    }
    result[name] = adapted;
  }
  result.criticalFindings = criticalFindings;
  return result;
}

module.exports = {
  assessDeliveryReliability,
  assessRecallResponse,
  assessComplaintHandling,
  assessInspectionPerformance,
  toTrustScoreInput,
};
