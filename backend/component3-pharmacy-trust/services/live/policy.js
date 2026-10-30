'use strict';

/**
 * Component 3 live indicator policy (docs/component3/LIVE_DESIGN.md, decision 4).
 * Proposed research parameters, not NMRA values. Defaults mirror the c3.policy
 * 'v1' row seeded by migrations/live/001_c3_live_schema.sql.
 */
const { WEIGHTS, classifyTier } = require('../trustScore');

const POLICY_LABEL = 'proposed research parameters, not NMRA values';

function freezePolicy(policy) {
  return Object.freeze({
    ...policy,
    weights: Object.freeze({ ...policy.weights }),
    tierMinimums: Object.freeze({ ...policy.tierMinimums }),
    inspectionPoints: Object.freeze({ ...policy.inspectionPoints }),
  });
}

const POLICY_V1 = freezePolicy({
  version: 'v1',
  parameterStatus: 'PROPOSED_RESEARCH_PARAMETERS',
  label: POLICY_LABEL,
  weights: { delivery: 0.35, recall: 0.30, complaint: 0.20, inspection: 0.15 },
  tierMinimums: { highlyTrusted: 80, trusted: 60, underReview: 40 },
  deliveryConfirmWindowHours: 24,
  complaintResolutionTargetDays: 30,
  inspectionPoints: { COMPLIANT: 1, PARTIAL: 0.5, NON_COMPLIANT: 0 },
});

function toNumber(value, label) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`Policy ${label} must be numeric.`);
  return number;
}

/**
 * The scoring core uses frozen WEIGHTS and fixed tier boundaries. A policy version
 * whose parameters differ cannot be scored by it, so it is rejected rather than
 * silently scored with the core's values.
 */
function assertCompatibleWithScoringCore(policy) {
  for (const name of Object.keys(WEIGHTS)) {
    if (policy.weights[name] !== WEIGHTS[name]) {
      throw new Error(`Policy ${policy.version} weight "${name}" differs from the scoring core; this version is not supported.`);
    }
  }
  const { highlyTrusted, trusted, underReview } = policy.tierMinimums;
  const consistent = classifyTier(highlyTrusted) === 'HIGHLY_TRUSTED' && classifyTier(highlyTrusted - 1e-9) === 'TRUSTED'
    && classifyTier(trusted) === 'TRUSTED' && classifyTier(trusted - 1e-9) === 'UNDER_REVIEW'
    && classifyTier(underReview) === 'UNDER_REVIEW' && classifyTier(underReview - 1e-9) === 'ESCALATION_ALERT';
  if (!consistent) throw new Error(`Policy ${policy.version} tier minimums differ from the scoring core; this version is not supported.`);
  return policy;
}

/** Convert a c3.policy row (numeric columns arrive from pg as strings) into a policy object. */
function policyFromRow(row) {
  if (!row || typeof row !== 'object') throw new Error('A c3.policy row is required.');
  if (row.parameter_status !== 'PROPOSED_RESEARCH_PARAMETERS') {
    throw new Error('Only PROPOSED_RESEARCH_PARAMETERS policies are supported by the prototype engine.');
  }
  const policy = freezePolicy({
    version: String(row.version),
    parameterStatus: row.parameter_status,
    label: POLICY_LABEL,
    weights: {
      delivery: toNumber(row.weight_delivery, 'weight_delivery'),
      recall: toNumber(row.weight_recall, 'weight_recall'),
      complaint: toNumber(row.weight_complaint, 'weight_complaint'),
      inspection: toNumber(row.weight_inspection, 'weight_inspection'),
    },
    tierMinimums: {
      highlyTrusted: toNumber(row.tier_highly_trusted_min, 'tier_highly_trusted_min'),
      trusted: toNumber(row.tier_trusted_min, 'tier_trusted_min'),
      underReview: toNumber(row.tier_under_review_min, 'tier_under_review_min'),
    },
    deliveryConfirmWindowHours: toNumber(row.delivery_confirm_window_hours, 'delivery_confirm_window_hours'),
    complaintResolutionTargetDays: toNumber(row.complaint_resolution_target_days, 'complaint_resolution_target_days'),
    inspectionPoints: {
      COMPLIANT: toNumber(row.inspection_points_compliant, 'inspection_points_compliant'),
      PARTIAL: toNumber(row.inspection_points_partial, 'inspection_points_partial'),
      NON_COMPLIANT: toNumber(row.inspection_points_non_compliant, 'inspection_points_non_compliant'),
    },
  });
  return assertCompatibleWithScoringCore(policy);
}

/** Policy assertion passed to indicatorScoring: approved for prototype use only, not a regulatory approval. */
function scoringPolicyFor(policy) {
  return { id: `c3-live-policy-${policy.version}`, approved: true };
}

assertCompatibleWithScoringCore(POLICY_V1);

module.exports = { POLICY_LABEL, POLICY_V1, policyFromRow, scoringPolicyFor, assertCompatibleWithScoringCore };
