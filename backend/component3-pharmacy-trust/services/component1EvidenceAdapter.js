
'use strict';

/**
 * Pure adapter for explicit snapshots from Component 1. It performs no network,
 * provider, filesystem, or blockchain access and does not authenticate inputs.
 * Component 1 history is completed custody transfers only. The caller may
 * provide a pharmacy identity mapping, but it remains an unverified declaration.
 */
const { CLASSIFICATION, validateEvidenceSet } = require('./evidenceValidation');

const TRANSFER_FIELDS = new Set(['id', 'from', 'to', 'stage', 'initiatedAt', 'confirmedAt']);
const RECALL_FIELDS = new Set(['batchKey', 'batchId', 'actor', 'reason']);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BATCH_KEY = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function rejectUnknownFields(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field "${key}".`);
  }
}

function uintString(value, label, { positive = false } = {}) {
  if (typeof value !== 'string' || !DECIMAL.test(value) || (positive && value === '0')) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'non-negative'} decimal string.`);
  }
  return value;
}

function timestampFromSeconds(seconds, label) {
  const value = BigInt(uintString(seconds, label));
  if (value > 8640000000000n) throw new Error(`${label} is outside the JavaScript ISO timestamp range.`);
  return new Date(Number(value) * 1000).toISOString();
}

function normalizeTransfer(record, batchId) {
  if (!isPlainObject(record)) throw new Error('Transfer history entry must be a plain object.');
  rejectUnknownFields(record, TRANSFER_FIELDS, 'Transfer history entry');
  for (const key of TRANSFER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`Transfer history entry requires "${key}".`);
  }
  const id = uintString(record.id, 'transfer id', { positive: true });
  if (typeof record.from !== 'string' || !ADDRESS.test(record.from)) throw new Error('Transfer from must be a 20-byte address string.');
  if (typeof record.to !== 'string' || !ADDRESS.test(record.to)) throw new Error('Transfer to must be a 20-byte address string.');
  if (!['0', '1', '2'].includes(record.stage)) throw new Error('Transfer stage must be the Component 1 enum string 0, 1, or 2.');
  return {
    batchId,
    transferId: id,
    from: record.from,
    to: record.to,
    stage: record.stage,
    initiatedAtSeconds: uintString(record.initiatedAt, 'initiatedAt'),
    confirmedAtSeconds: uintString(record.confirmedAt, 'confirmedAt'),
    confirmedAt: timestampFromSeconds(record.confirmedAt, 'confirmedAt'),
  };
}

function normalizeRecall(record, requestedBatchId) {
  if (!isPlainObject(record)) throw new Error('Recall event must be a plain object.');
  rejectUnknownFields(record, RECALL_FIELDS, 'Recall event');
  for (const key of RECALL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`Recall event requires "${key}".`);
  }
  const batchId = requiredString(record.batchId, 'Recall batchId');
  if (batchId !== requestedBatchId) throw new Error('Recall event batchId does not match the supplied batchId.');
  if (typeof record.batchKey !== 'string' || !BATCH_KEY.test(record.batchKey)) throw new Error('Recall batchKey must be a 32-byte hex string.');
  if (typeof record.actor !== 'string' || !ADDRESS.test(record.actor)) throw new Error('Recall actor must be a 20-byte address string.');
  if (typeof record.reason !== 'string' || record.reason.trim().length === 0) throw new Error('Recall reason must be a non-empty string.');
  return { batchKey: record.batchKey, batchId, actor: record.actor, reason: record.reason };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function classifyRecalls(records, requestedBatchId) {
  const accepted = [];
  const duplicates = [];
  const conflicts = [];
  const invalid = [];
  const byBatch = new Map();
  records.forEach((record, index) => {
    let normalized;
    try {
      normalized = normalizeRecall(record, requestedBatchId);
    } catch (error) {
      invalid.push({ index, reason: error.message });
      return;
    }
    const fingerprint = stableJson(normalized);
    if (byBatch.has(normalized.batchId)) {
      const first = byBatch.get(normalized.batchId);
      if (first.fingerprint === fingerprint) duplicates.push({ batchId: normalized.batchId, index, duplicateOf: first.index });
      else conflicts.push({ batchId: normalized.batchId, index, conflictsWith: first.index });
      return;
    }
    byBatch.set(normalized.batchId, { fingerprint, index });
    accepted.push(normalized);
  });
  return { events: accepted, duplicates, conflicts, invalid };
}

function validateIdentityMapping(mapping) {
  if (mapping === undefined) return null;
  if (!isPlainObject(mapping)) throw new Error('pharmacyIdentity must be a plain object when supplied.');
  rejectUnknownFields(mapping, new Set(['pharmacyId', 'participantAddress']), 'pharmacyIdentity');
  const pharmacyId = requiredString(mapping.pharmacyId, 'pharmacyIdentity.pharmacyId');
  if (typeof mapping.participantAddress !== 'string' || !ADDRESS.test(mapping.participantAddress)) {
    throw new Error('pharmacyIdentity.participantAddress must be a 20-byte address string.');
  }
  return { pharmacyId, participantAddress: mapping.participantAddress };
}

/**
 * Input: { batchId, transferHistory, recallEvents? } plus optional explicit
 * pharmacyIdentity {pharmacyId, participantAddress}. The identity mapping is
 * caller-supplied and not verified. transferHistory uses the API's named
 * CompletedTransfer fields; recallEvents use BatchRecallRecorded event args.
 */
function adaptComponent1Evidence(input) {
  if (!isPlainObject(input)) throw new Error('Adapter input must be a plain object.');
  rejectUnknownFields(input, new Set(['batchId', 'transferHistory', 'recallEvents', 'pharmacyIdentity']), 'Adapter input');
  const batchId = requiredString(input.batchId, 'batchId');
  if (!Array.isArray(input.transferHistory)) throw new Error('transferHistory must be an array.');
  const recallInputs = input.recallEvents === undefined ? [] : input.recallEvents;
  if (!Array.isArray(recallInputs)) throw new Error('recallEvents must be an array when supplied.');
  const identity = validateIdentityMapping(input.pharmacyIdentity);

  const transferRecords = [];
  const transferInvalid = [];
  input.transferHistory.forEach((record, index) => {
    try {
      transferRecords.push({ index, fact: normalizeTransfer(record, batchId) });
    } catch (error) {
      transferInvalid.push({ index, reason: error.message });
    }
  });

  const transferCandidates = [];
  const transferResults = transferRecords.map(({ index, fact }) => {
    if (!identity) return { index, status: CLASSIFICATION.INSUFFICIENT, reason: 'No explicit pharmacy identity mapping was supplied.', fact, evidence: null };
    if (fact.stage !== '2' || fact.to.toLowerCase() !== identity.participantAddress.toLowerCase()) {
      return { index, status: CLASSIFICATION.INSUFFICIENT, reason: 'Transfer is not explicitly mapped to the supplied pharmacy recipient.', fact, evidence: null };
    }
    const sourceReference = `component1-history:${encodeURIComponent(batchId)}:transfer:${fact.transferId}`;
    const envelope = {
      evidenceId: sourceReference,
      pharmacyId: identity.pharmacyId,
      indicator: 'delivery',
      eventType: 'transfer-confirmed',
      eventTimestamp: fact.confirmedAt,
      source: { system: 'component1-traceability-api', reference: sourceReference },
      provenance: 'DECLARED_REAL',
      metadata: {
        batchId: fact.batchId,
        transferId: fact.transferId,
        fromAddress: fact.from,
        toAddress: fact.to,
        stage: fact.stage,
        initiatedAtSeconds: fact.initiatedAtSeconds,
        confirmedAtSeconds: fact.confirmedAtSeconds,
        sourceEventReference: null,
        identityMappingStatus: 'CALLER_SUPPLIED_UNVERIFIED',
      },
    };
    transferCandidates.push({ index, envelope });
    return { index, status: CLASSIFICATION.REQUIRES_VERIFICATION, reason: 'Transfer facts are mapped, but source authenticity and pharmacy identity mapping are not independently verified.', fact, evidence: envelope };
  });

  const candidateValidation = validateEvidenceSet(transferCandidates.map(item => item.envelope));
  const candidateResultByIndex = new Map();
  for (let i = 0; i < transferCandidates.length; i += 1) {
    const item = transferCandidates[i];
    const duplicate = candidateValidation.duplicates.find(result => result.index === i);
    const conflict = candidateValidation.conflicts.find(result => result.index === i);
    if (duplicate) candidateResultByIndex.set(item.index, { status: 'DUPLICATE', duplicateOf: transferCandidates[duplicate.duplicateOf]?.index });
    else if (conflict) candidateResultByIndex.set(item.index, { status: 'CONFLICT', conflictsWith: transferCandidates[conflict.conflictsWith]?.index });
    else candidateResultByIndex.set(item.index, { status: CLASSIFICATION.REQUIRES_VERIFICATION });
  }
  const recalls = classifyRecalls(recallInputs, batchId);

  return {
    sourceSystem: 'component1-medicine-traceability',
    blockchainVerification: 'NOT_PERFORMED',
    transferHistory: {
      records: transferResults.map(record => ({ ...record, candidateHandling: candidateResultByIndex.get(record.index) || null })),
      invalid: transferInvalid,
      evidenceValidation: candidateValidation,
    },
    delivery: {
      status: CLASSIFICATION.INSUFFICIENT,
      score: null,
      reason: 'Component 1 supplies actual custody timestamps but no authoritative expected-delivery deadline or approved pharmacy identity mapping.',
    },
    recallEvents: {
      events: recalls.events.map(event => ({ ...event, eventReference: null, eventTimestamp: null, pharmacyEvidence: null })),
      duplicates: recalls.duplicates,
      conflicts: recalls.conflicts,
      invalid: recalls.invalid,
    },
    recallResponse: {
      status: CLASSIFICATION.INSUFFICIENT,
      score: null,
      reason: 'BatchRecallRecorded contains no pharmacy recipient, acknowledgement, or response action.',
    },
    complaint: { status: CLASSIFICATION.INSUFFICIENT, reason: 'Component 1 provides no complaint evidence.' },
    inspection: { status: CLASSIFICATION.INSUFFICIENT, reason: 'Component 1 provides no inspection evidence.' },
  };
}

module.exports = { adaptComponent1Evidence };
