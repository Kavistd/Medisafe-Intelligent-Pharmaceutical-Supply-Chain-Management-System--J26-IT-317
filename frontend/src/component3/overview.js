import { fetchOverviewEntry } from './api.js';

/**
 * Pure helpers for the health-authority overview. Decision support only, not a
 * regulatory determination. Missing data is never converted to a number: a
 * NOT_ASSESSABLE or unavailable pharmacy has score = null and tier = null.
 */
export const TIERS = Object.freeze(['HIGHLY_TRUSTED', 'TRUSTED', 'UNDER_REVIEW', 'ESCALATION_ALERT']);
export const TIER_LABELS = Object.freeze({
  HIGHLY_TRUSTED: 'Highly trusted',
  TRUSTED: 'Trusted',
  UNDER_REVIEW: 'Under review',
  ESCALATION_ALERT: 'Escalation alert',
  NOT_ASSESSABLE: 'Not assessable',
  UNAVAILABLE: 'Unavailable',
});

/** Pharmacies the current session may read an assessment for. */
export function overviewPharmacies(pharmacies) {
  return (Array.isArray(pharmacies) ? pharmacies : [])
    .filter(item => item && typeof item.pharmacyCode === 'string' && item.permissions?.includes('ASSESSMENT_READ'));
}

/** Sample mode, or any regulatory grant, shows the overview; pharmacy-only users keep the single view. */
export function shouldShowOverview(mode, pharmacies) {
  if (mode === 'demo') return true;
  if (mode !== 'live') return false;
  return overviewPharmacies(pharmacies).some(item => item.accessTypes?.includes('REGULATORY'));
}

/** Fetch every accessible pharmacy; a failed pharmacy becomes an unavailable entry instead of failing the overview. */
export async function loadOverview({ pharmacies, mode, accessToken, walletToken, fetchEntry = fetchOverviewEntry, fetchImpl } = {}) {
  return Promise.all(overviewPharmacies(pharmacies).map(async item => {
    try {
      const entry = await fetchEntry({
        pharmacyCode: item.pharmacyCode,
        mode,
        accessToken,
        walletToken,
        includeCriticalFindings: item.permissions.includes('CRITICAL_FINDINGS_READ'),
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      return { pharmacyCode: item.pharmacyCode, available: true, ...entry };
    } catch (error) {
      return { pharmacyCode: item.pharmacyCode, available: false, error: error?.message || 'Assessment unavailable.' };
    }
  }));
}

function evidenceCount(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const counts = Object.values(breakdown).map(row => row?.evidenceCount).filter(Number.isInteger);
  return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
}

/** Normalise one entry into a table row. */
export function toOverviewRow(entry) {
  if (!entry?.available || !entry.assessment) {
    return {
      pharmacyCode: entry?.pharmacyCode || 'Unknown', available: false, status: 'UNAVAILABLE',
      score: null, tier: null, criticalEscalationRequired: null, evidenceCount: null,
      error: entry?.error || 'Assessment unavailable.', escalationReasons: [],
    };
  }
  const { assessment, criticalFindings } = entry;
  const assessable = assessment.status === 'ASSESSABLE' && Number.isFinite(assessment.score) && TIERS.includes(assessment.tier);
  const flags = [assessment.criticalEscalationRequired, criticalFindings?.accessDenied ? undefined : criticalFindings?.required]
    .filter(value => typeof value === 'boolean');
  const critical = flags.length ? flags.some(Boolean) : null;
  const tier = assessable ? assessment.tier : null;
  const escalationReasons = [
    ...(critical ? ['Critical finding'] : []),
    ...(tier === 'ESCALATION_ALERT' ? ['Escalation-alert tier'] : []),
  ];
  return {
    pharmacyCode: assessment.pharmacyId || entry.pharmacyCode,
    available: true,
    status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE',
    score: assessable ? assessment.score : null,
    tier,
    criticalEscalationRequired: critical,
    evidenceCount: evidenceCount(assessment.breakdown),
    escalationReasons,
    error: null,
  };
}

/** Sort by score or tier. Rows without a score/tier always sort last, never as 0. */
export function sortRows(rows, { key = 'score', direction = 'desc' } = {}) {
  const sign = direction === 'asc' ? 1 : -1;
  const rank = row => (key === 'tier'
    ? (row.tier ? TIERS.length - TIERS.indexOf(row.tier) : null)
    : row.score);
  return [...rows].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    if (a === null && b === null) return left.pharmacyCode.localeCompare(right.pharmacyCode);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * sign || left.pharmacyCode.localeCompare(right.pharmacyCode);
  });
}

/** Counts per tier, plus NOT_ASSESSABLE and UNAVAILABLE. */
export function tierDistribution(rows) {
  const counts = Object.fromEntries([...TIERS, 'NOT_ASSESSABLE', 'UNAVAILABLE'].map(tier => [tier, 0]));
  for (const row of rows) {
    if (!row.available) counts.UNAVAILABLE += 1;
    else if (row.tier) counts[row.tier] += 1;
    else counts.NOT_ASSESSABLE += 1;
  }
  return counts;
}

/** Pharmacies needing attention: a critical escalation, or the ESCALATION_ALERT tier. */
export function escalationQueue(rows) {
  return rows.filter(row => row.available && row.escalationReasons.length > 0);
}

export function overviewSummary(rows) {
  return {
    total: rows.length,
    assessable: rows.filter(row => row.status === 'ASSESSABLE').length,
    notAssessable: rows.filter(row => row.status === 'NOT_ASSESSABLE').length,
    unavailable: rows.filter(row => !row.available).length,
    escalations: escalationQueue(rows).length,
  };
}
