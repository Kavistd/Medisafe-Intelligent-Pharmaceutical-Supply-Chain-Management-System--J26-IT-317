'use strict';

/**
 * Pure builder for a PharmacyTrustAnchor payload (blockchain/contracts/component3).
 * It sends no transaction, reads no environment, touches no database and never
 * changes blockchainVerification: that stays NOT_PERFORMED until a confirmed
 * on-chain transaction actually exists.
 *
 *   pharmacyKeyInput : the pharmacy code; the chain client derives
 *                      pharmacyKey = keccak256(utf8(pharmacyKeyInput)) (ethers.id).
 *   scoreMilli       : Math.round(score * 1000), for chain encoding ONLY. The displayed
 *                      and stored score stays unrounded. null when NOT_ASSESSABLE.
 *   canonicalJson    : the committed assessment content, keys sorted recursively.
 *   assessmentHash   : 0x-prefixed sha256 of canonicalJson (the off-chain commitment;
 *                      usable directly as bytes32). It proves the content existed when
 *                      anchored, not that the underlying evidence is true.
 */
const { createHash } = require('node:crypto');
const { classifyTier } = require('./trustScore');

const SCHEMA = 'component3.trust-assessment-anchor.v1';
const INDICATORS = ['delivery', 'recall', 'complaint', 'inspection'];
const MAX_SCORE_MILLI = 100000;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** JSON with recursively sorted object keys; rejects values JSON cannot represent exactly. */
function canonicalize(value, label = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${label}[${index}]`)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key], `${label}.${key}`)}`).join(',')}}`;
  }
  throw new Error(`${label} must contain only JSON-compatible values.`);
}

function criticalFlag(result) {
  const nested = isPlainObject(result.criticalEscalation) ? result.criticalEscalation.required : undefined;
  const flag = nested !== undefined ? nested : result.criticalEscalationRequired;
  if (typeof flag !== 'boolean') throw new Error('Assessment must state criticalEscalation.required or criticalEscalationRequired as a boolean.');
  if (typeof result.criticalEscalationRequired === 'boolean' && result.criticalEscalationRequired !== flag) {
    throw new Error('Assessment critical escalation flags disagree.');
  }
  return flag;
}

function breakdownFor(result) {
  if (result.breakdown === undefined || result.breakdown === null) return null;
  if (!isPlainObject(result.breakdown)) throw new Error('Assessment breakdown must be a plain object.');
  return Object.fromEntries(INDICATORS.map(name => {
    const row = result.breakdown[name];
    if (!isPlainObject(row)) throw new Error(`Assessment breakdown requires "${name}".`);
    return [name, {
      status: row.status ?? null,
      value: row.value ?? null,
      weight: row.weight ?? null,
      evidenceCount: row.evidenceCount ?? null,
      source: row.source ?? null,
    }];
  }));
}

/**
 * Accepts the assessmentService result or the API assessment payload.
 * Returns { pharmacyKeyInput, scoreMilli, status, criticalEscalationRequired, canonicalJson, assessmentHash }.
 */
function buildAnchorPayload(assessmentResult, pharmacyCode) {
  if (!isPlainObject(assessmentResult)) throw new Error('Assessment result must be a plain object.');
  if (typeof pharmacyCode !== 'string' || pharmacyCode.trim() === '' || pharmacyCode !== pharmacyCode.trim()) {
    throw new Error('pharmacyCode must be a non-empty string without surrounding whitespace.');
  }
  if (assessmentResult.pharmacyId !== undefined && assessmentResult.pharmacyId !== pharmacyCode) {
    throw new Error('pharmacyCode does not match the assessment pharmacyId.');
  }

  const { status, score, tier } = assessmentResult;
  let scoreMilli = null;
  if (status === 'ASSESSABLE') {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('An ASSESSABLE assessment requires a score between 0 and 100.');
    }
    if (tier !== classifyTier(score)) throw new Error('Assessment tier does not match its score.');
    scoreMilli = Math.round(score * 1000);
    if (scoreMilli > MAX_SCORE_MILLI) throw new Error('Encoded score exceeds 100000.');
    // The contract derives the tier from scoreMilli; refuse any rounding that would change it.
    if (classifyTier(scoreMilli / 1000) !== tier) {
      throw new Error('Rounding the score to milli-points would change its tier; refusing to build an anchor payload.');
    }
  } else if (status === 'NOT_ASSESSABLE') {
    if (score !== null && score !== undefined) throw new Error('A NOT_ASSESSABLE assessment must not carry a score.');
    if (tier !== undefined && tier !== 'NOT_ASSESSABLE') throw new Error('A NOT_ASSESSABLE assessment must not carry a tier.');
  } else {
    throw new Error('Assessment status must be ASSESSABLE or NOT_ASSESSABLE.');
  }

  const criticalEscalationRequired = criticalFlag(assessmentResult);
  const findings = isPlainObject(assessmentResult.criticalEscalation) && Array.isArray(assessmentResult.criticalEscalation.findings)
    ? assessmentResult.criticalEscalation.findings
    : [];
  const commitment = {
    schema: SCHEMA,
    pharmacyCode,
    status,
    score: status === 'ASSESSABLE' ? score : null,
    tier: status === 'ASSESSABLE' ? tier : 'NOT_ASSESSABLE',
    breakdown: breakdownFor(assessmentResult),
    missingIndicators: Array.isArray(assessmentResult.missingIndicators)
      ? assessmentResult.missingIndicators.map(item => (isPlainObject(item) ? item.name ?? null : item))
      : [],
    criticalEscalationRequired,
    criticalFindingIds: findings.map(finding => (isPlainObject(finding) ? finding.id ?? null : null)),
    evidenceSource: assessmentResult.evidenceSource ?? null,
    demoLabel: assessmentResult.demoLabel ?? null,
  };
  const canonicalJson = canonicalize(commitment, 'commitment');
  return {
    pharmacyKeyInput: pharmacyCode,
    scoreMilli,
    status,
    criticalEscalationRequired,
    canonicalJson,
    assessmentHash: `0x${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`,
  };
}

module.exports = { SCHEMA, buildAnchorPayload, canonicalize };
