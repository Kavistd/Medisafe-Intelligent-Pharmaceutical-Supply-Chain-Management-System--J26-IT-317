/**
 * "Path to improvement" (what-if) for one pharmacy. Pure: no React, no network.
 * Input is the calculation payload already loaded from GET /api/v1/live/pharmacies/:code/calculation
 * (per-indicator numerator/denominator in `calculation`, weights in `breakdown`). Nothing is
 * recomputed from raw rows and the server's score, tier and escalation are never changed here.
 * Indicative only: it assumes every future event is eligible and successful. Decision support,
 * not a regulatory determination.
 */
import { INDICATORS, TIER_LABELS } from './liveModel.js';

/**
 * Tier minimums. Must match classifyTier in backend/component3-pharmacy-trust/services/trustScore.js
 * (score >= 80 HIGHLY_TRUSTED, >= 60 TRUSTED, >= 40 UNDER_REVIEW, else ESCALATION_ALERT).
 * improvement.test.js fails if they drift. Proposed research parameters, not NMRA values.
 */
export const TIER_MINIMUMS = Object.freeze({ HIGHLY_TRUSTED: 80, TRUSTED: 60, UNDER_REVIEW: 40 });
export const TIER_ORDER = Object.freeze(['ESCALATION_ALERT', 'UNDER_REVIEW', 'TRUSTED', 'HIGHLY_TRUSTED']);
export const MAX_EXTRA_EVENTS = 200;
const EPSILON = 1e-9;

export const INDICATOR_UNITS = Object.freeze({
  delivery: 'deliveries confirmed within the window',
  recall: 'recall actions completed on time',
  complaint: 'substantiated complaints resolved on time',
  inspection: 'inspection points',
});

export const CAVEAT = 'Indicative, assumes all future events are eligible and successful.';
export const ESCALATION_NOTICE = 'Critical escalation is handled separately and is not cleared by score improvement.';

export function tierForScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'NOT_ASSESSABLE';
  if (score >= TIER_MINIMUMS.HIGHLY_TRUSTED) return 'HIGHLY_TRUSTED';
  if (score >= TIER_MINIMUMS.TRUSTED) return 'TRUSTED';
  if (score >= TIER_MINIMUMS.UNDER_REVIEW) return 'UNDER_REVIEW';
  return 'ESCALATION_ALERT';
}

/** Next tier above `tier` and its minimum, or null at the top. */
export function nextTierAbove(tier) {
  const index = TIER_ORDER.indexOf(tier);
  if (index < 0 || index === TIER_ORDER.length - 1) return null;
  const next = TIER_ORDER[index + 1];
  return { tier: next, minimum: TIER_MINIMUMS[next] };
}

/** Indicator value (0..100) after k more successful eligible events: 100 x (n + k) / (d + k). */
export function valueWith(numerator, denominator, k) {
  return (100 * (numerator + k)) / (denominator + k);
}

/** Weighted score from per-indicator { weight, numerator, denominator } and extra events per key. */
export function scoreWith(indicators, extra = {}) {
  return indicators.reduce((sum, item) => sum + item.weight * valueWith(item.numerator, item.denominator, extra[item.key] || 0), 0);
}

const reaches = (score, minimum) => score >= minimum - EPSILON;

/** Smallest integer k in 1..MAX_EXTRA_EVENTS with reach(k) true, else null. reach is monotone in k. */
function smallestK(reach) {
  for (let k = 1; k <= MAX_EXTRA_EVENTS; k += 1) if (reach(k)) return k;
  return null;
}

const labelOf = key => INDICATORS.find(meta => meta.key === key)?.label || key;

function listText(labels) {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Per-indicator inputs from the payload, or the list of indicators without eligible events. */
function readIndicators(data) {
  const missing = new Set((Array.isArray(data?.missingIndicators) ? data.missingIndicators : [])
    .map(item => (typeof item === 'string' ? item : item?.name)).filter(Boolean));
  const indicators = [];
  for (const meta of INDICATORS) {
    const detail = data?.calculation?.[meta.key];
    const payloadWeight = data?.breakdown?.[meta.key]?.weight;
    const numerator = detail?.numerator;
    const denominator = detail?.denominator;
    const usable = detail && detail.status === 'ASSESSABLE' && Number.isFinite(numerator) && Number.isFinite(denominator)
      && denominator > 0 && numerator >= 0 && numerator <= denominator;
    if (!usable) { missing.add(meta.key); continue; }
    indicators.push({
      key: meta.key, label: meta.label, letter: meta.letter, unit: INDICATOR_UNITS[meta.key],
      weight: Number.isFinite(payloadWeight) ? payloadWeight : meta.weight, numerator, denominator,
    });
  }
  return { indicators, missing: INDICATORS.map(meta => meta.key).filter(key => missing.has(key)) };
}

/**
 * Improvement path for one calculation payload.
 * options.criticalEscalation: boolean from the critical-findings route (falls back to the payload flag).
 */
export function improvementPath(data, { criticalEscalation } = {}) {
  const escalation = typeof criticalEscalation === 'boolean' ? criticalEscalation : data?.criticalEscalationRequired === true;
  const escalationNotice = escalation ? ESCALATION_NOTICE : null;
  const { indicators, missing } = readIndicators(data);

  if (data?.status !== 'ASSESSABLE' || missing.length > 0 || typeof data?.score !== 'number') {
    const names = missing.length ? missing.map(labelOf) : ['One or more indicators'];
    return {
      kind: 'NOT_ENOUGH_EVIDENCE',
      message: `Not enough evidence yet: ${listText(names)} ${names.length > 1 ? 'have' : 'has'} no eligible events.`,
      missing, currentTier: 'NOT_ASSESSABLE', nextTier: null, indicators: [], weakest: null, escalationNotice, caveat: CAVEAT,
    };
  }

  const currentTier = TIER_ORDER.includes(data.tier) ? data.tier : tierForScore(data.score);
  const current = scoreWith(indicators);
  const rows = indicators.map(item => {
    const value = valueWith(item.numerator, item.denominator, 0);
    return { ...item, value, weightedGap: item.weight * (100 - value) };
  });
  const weakest = rows.reduce((worst, row) => (worst === null || row.weightedGap > worst.weightedGap + EPSILON ? row : worst), null);
  const next = nextTierAbove(currentTier);

  if (!next) {
    return {
      kind: 'MAINTAIN', message: 'Maintain current performance.', currentTier, nextTier: null,
      indicators: rows.map(row => ({ ...row, kAlone: null, reachableAlone: false })), weakest, escalationNotice, caveat: CAVEAT,
    };
  }

  const kAll = smallestK(k => reaches(scoreWith(rows, Object.fromEntries(rows.map(row => [row.key, k]))), next.minimum));
  const withAlone = rows.map(row => {
    // Upper bound if only this indicator improved: its value tends to (but never exceeds) 100.
    const ceiling = current + row.weight * (100 - row.value);
    const kAlone = ceiling < next.minimum - EPSILON ? null : smallestK(k => reaches(scoreWith(rows, { [row.key]: k }), next.minimum));
    return { ...row, kAlone, reachableAlone: kAlone !== null };
  });

  return {
    kind: 'PLAN',
    currentTier,
    nextTier: next.tier,
    nextTierMinimum: next.minimum,
    pointsNeeded: Math.max(0, next.minimum - current),
    kAll,
    message: kAll === null
      ? `${TIER_LABELS[next.tier]} is not reachable within ${MAX_EXTRA_EVENTS} more on-time events in each area.`
      : `About ${kAll} more on-time ${kAll === 1 ? 'event' : 'events'} in each area would reach ${TIER_LABELS[next.tier]}.`,
    indicators: withAlone,
    weakest,
    escalationNotice,
    caveat: CAVEAT,
  };
}
