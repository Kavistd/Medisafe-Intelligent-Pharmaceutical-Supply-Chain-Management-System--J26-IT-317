'use strict';

/**
 * Isolated Component 3 evidence-envelope validation and classification.
 * This module validates declarations; it does not authenticate sources, infer
 * indicator outcomes, decide policy sufficiency, or access a blockchain.
 */
const EVIDENCE_FIELDS = new Set([
  'evidenceId', 'pharmacyId', 'indicator', 'eventType', 'eventTimestamp',
  'source', 'provenance', 'metadata',
]);
const INDICATORS = new Set(['delivery', 'recall', 'complaint', 'inspection']);
const PROVENANCE = new Set(['SYNTHETIC', 'DECLARED_REAL', 'UNKNOWN']);
const SOURCE_FIELDS = new Set(['system', 'reference']);
const CLASSIFICATION = Object.freeze({
  USABLE: 'USABLE',
  INSUFFICIENT: 'INSUFFICIENT',
  INVALID: 'INVALID',
  REQUIRES_VERIFICATION: 'REQUIRES_VERIFICATION',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function cloneJson(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, `${label}[${index}]`));
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = cloneJson(value[key], `${label}.${key}`);
    return result;
  }
  throw new Error(`${label} must contain only JSON-compatible values.`);
}

function normalizeEvidence(input) {
  if (!isPlainObject(input)) throw new Error('Evidence must be a plain object.');
  for (const key of Object.keys(input)) {
    if (!EVIDENCE_FIELDS.has(key)) throw new Error(`Evidence contains unsupported property "${key}".`);
  }
  for (const key of ['evidenceId', 'pharmacyId', 'indicator', 'eventType', 'source', 'provenance']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`Evidence requires "${key}".`);
  }

  const normalized = {
    evidenceId: requireIdentifier(input.evidenceId, 'evidenceId'),
    pharmacyId: requireIdentifier(input.pharmacyId, 'pharmacyId'),
    indicator: requireIdentifier(input.indicator, 'indicator'),
    eventType: requireIdentifier(input.eventType, 'eventType'),
  };
  if (!INDICATORS.has(normalized.indicator)) throw new Error('indicator must be delivery, recall, complaint, or inspection.');

  if (input.eventTimestamp !== undefined) {
    const timestamp = typeof input.eventTimestamp === 'string' &&
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(input.eventTimestamp);
    const validCalendarDate = timestamp && (() => {
      const year = Number(timestamp[1]);
      const month = Number(timestamp[2]);
      const day = Number(timestamp[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    })();
    const validClock = timestamp && Number(timestamp[4]) <= 23 && Number(timestamp[5]) <= 59 &&
      Number(timestamp[6]) <= 59 && (timestamp[7] === 'Z' || (Number(timestamp[9]) <= 23 && Number(timestamp[10]) <= 59));
    if (!timestamp || !validCalendarDate || !validClock || !Number.isFinite(Date.parse(input.eventTimestamp))) {
      throw new Error('eventTimestamp must be a valid ISO 8601 timestamp with an explicit timezone.');
    }
    normalized.eventTimestamp = new Date(input.eventTimestamp).toISOString();
  }

  if (!isPlainObject(input.source)) throw new Error('source must be a plain object.');
  for (const key of Object.keys(input.source)) {
    if (!SOURCE_FIELDS.has(key)) throw new Error(`source contains unsupported property "${key}".`);
  }
  if (!Object.prototype.hasOwnProperty.call(input.source, 'system')) throw new Error('source requires "system".');
  normalized.source = { system: requireIdentifier(input.source.system, 'source.system') };
  if (input.source.reference !== undefined) normalized.source.reference = requireIdentifier(input.source.reference, 'source.reference');

  if (!PROVENANCE.has(input.provenance)) throw new Error('provenance must be SYNTHETIC, DECLARED_REAL, or UNKNOWN.');
  if (input.provenance === 'DECLARED_REAL' && !normalized.source.reference) {
    throw new Error('DECLARED_REAL evidence requires a source reference for later verification.');
  }
  normalized.provenance = input.provenance;
  if (input.metadata !== undefined) normalized.metadata = cloneJson(input.metadata, 'metadata');
  return normalized;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Validate/normalize one envelope. UNKNOWN and DECLARED_REAL remain unverified. */
function validateEvidence(input) {
  const evidence = normalizeEvidence(input);
  return {
    status: evidence.provenance === 'SYNTHETIC' ? CLASSIFICATION.USABLE : CLASSIFICATION.REQUIRES_VERIFICATION,
    evidence,
    reason: evidence.provenance === 'SYNTHETIC'
      ? 'Synthetic test evidence; usable for prototype tests only.'
      : 'Provenance is a declaration and requires independent source verification.',
  };
}

/**
 * Normalize a collection and report exact repeats separately from identifier
 * conflicts. Only the first instance of an identical record enters `evidence`.
 * Conflicts are never merged and make the collection INVALID.
 */
function validateEvidenceSet(inputs) {
  if (!Array.isArray(inputs)) throw new Error('Evidence set must be an array.');
  const evidence = [];
  const duplicates = [];
  const conflicts = [];
  const invalid = [];
  const byId = new Map();

  inputs.forEach((input, index) => {
    let item;
    try {
      item = normalizeEvidence(input);
    } catch (error) {
      invalid.push({ index, reason: error.message });
      return;
    }
    const canonical = stableJson(item);
    if (byId.has(item.evidenceId)) {
      const first = byId.get(item.evidenceId);
      if (first.canonical === canonical) duplicates.push({ evidenceId: item.evidenceId, index, duplicateOf: first.index });
      else conflicts.push({ evidenceId: item.evidenceId, index, conflictsWith: first.index });
      return;
    }
    byId.set(item.evidenceId, { canonical, index });
    evidence.push(item);
  });

  let status = CLASSIFICATION.USABLE;
  let reason = 'Structurally valid evidence; this does not establish indicator sufficiency.';
  if (invalid.length || conflicts.length) {
    status = CLASSIFICATION.INVALID;
    reason = invalid.length ? 'One or more evidence records are malformed.' : 'Conflicting records share an evidenceId.';
  } else if (evidence.length === 0) {
    status = CLASSIFICATION.INSUFFICIENT;
    reason = 'No evidence records are available.';
  } else if (evidence.some(item => item.provenance !== 'SYNTHETIC')) {
    status = CLASSIFICATION.REQUIRES_VERIFICATION;
    reason = 'At least one record has declared or unknown provenance requiring independent verification.';
  } else {
    reason = 'Synthetic test evidence only; distinct records are normalized for prototype use.';
  }

  return { status, reason, evidence, duplicates, conflicts, invalid };
}

/**
 * Return metadata compatible with indicatorScoring's evidenceIds/source fields.
 * This is not a score, numerator, denominator, or policy approval. Real evidence
 * cannot pass this adapter until a trusted verification adapter is implemented.
 */
function toIndicatorEvidenceMetadata(inputs) {
  const result = validateEvidenceSet(inputs);
  if (result.status !== CLASSIFICATION.USABLE) {
    throw new Error(`Evidence cannot be prepared for indicator scoring: ${result.reason}`);
  }
  return { evidenceIds: result.evidence.map(item => item.evidenceId), source: 'SYNTHETIC' };
}

/** Empty evidence is insufficient; no numeric assessment or sample-size rule is inferred. */
function classifyEvidenceSufficiency(inputs) {
  const result = validateEvidenceSet(inputs);
  if (result.status !== CLASSIFICATION.USABLE) return { status: result.status, evidenceCount: result.evidence.length, reason: result.reason };
  if (result.evidence.length === 0) {
    return { status: CLASSIFICATION.INSUFFICIENT, evidenceCount: 0, reason: 'No evidence records are available.' };
  }
  return {
    status: CLASSIFICATION.USABLE,
    evidenceCount: result.evidence.length,
    reason: 'Records are structurally usable; indicator sufficiency and assessability require an approved policy.',
  };
}

module.exports = {
  CLASSIFICATION,
  normalizeEvidence,
  validateEvidence,
  validateEvidenceSet,
  classifyEvidenceSufficiency,
  toIndicatorEvidenceMetadata,
};
