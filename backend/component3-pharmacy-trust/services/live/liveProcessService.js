'use strict';

/**
 * Component 3 live processes (docs/component3/LIVE_DESIGN.md, decisions 4-5).
 * One function per process: authorize (permissions.js) -> validate the body
 * (unknown fields, types, sizes, timestamp order) -> one write transaction in
 * liveWriteRepository. Actor, role, scope, pharmacy_id and evidence_class always
 * come from the verified principal, never from the request. Timestamps of process
 * steps (dispatch, arrival, confirmation, completion, screening, resolution,
 * finalisation) are the server clock.
 */
const { randomBytes } = require('node:crypto');
const { ProcessError } = require('./liveErrors');
const { can, roleAllows, isActive } = require('./permissions');
const { POLICY_V1, policyFromRow } = require('./policy');
const { buildLiveAssessment, summarizeLiveAssessments } = require('./liveAssessment');
const { buildAnchorPayload } = require('../anchorPayload');

const DAY_MS = 24 * 3600 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const CRITERION = /^[A-Z][A-Z0-9_]{0,63}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ACTION_TYPES = ['ACKNOWLEDGE', 'IDENTIFY_STOCK', 'QUARANTINE', 'REPORT_QUANTITY', 'CLOSE'];
const ITEM_RESULTS = ['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE'];
const COMPUTED_BY = 'component3-live-engine/v1';

const invalid = (code, message) => new ProcessError(422, code, message);
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function only(body, allowed, label = 'Request body') {
  if (!isPlainObject(body)) throw invalid('INVALID_BODY', `${label} must be a JSON object.`);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid('UNSUPPORTED_FIELD', `${label} contains unsupported field "${key}".`);
  }
  return body;
}

function text(body, key, { required = true, max = 1000, pattern } = {}) {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) throw invalid('MISSING_FIELD', `"${key}" is required.`);
    return null;
  }
  if (typeof value !== 'string') throw invalid('INVALID_TYPE', `"${key}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (required) throw invalid('MISSING_FIELD', `"${key}" must not be empty.`);
    return null;
  }
  if (trimmed.length > max) throw invalid('TOO_LONG', `"${key}" must be at most ${max} characters.`);
  if (pattern && !pattern.test(trimmed)) throw invalid('INVALID_FORMAT', `"${key}" has an invalid format.`);
  return trimmed;
}

function pharmacyCode(value, key = 'pharmacyCode') {
  if (typeof value !== 'string' || !CODE.test(value) || WALLET.test(value)) {
    throw invalid('INVALID_PHARMACY_CODE', `"${key}" must be a valid pharmacy code.`);
  }
  return value;
}

function oneOf(body, key, values) {
  if (!values.includes(body[key])) throw invalid('INVALID_VALUE', `"${key}" must be one of ${values.join(', ')}.`);
  return body[key];
}

function timestamp(body, key) {
  const value = body[key];
  if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw invalid('INVALID_TIMESTAMP', `"${key}" must be an ISO 8601 timestamp with an explicit timezone.`);
  }
  return new Date(value);
}

function within(date, from, to, key, message) {
  if (date.getTime() < from.getTime() || date.getTime() > to.getTime()) throw new ProcessError(422, 'TIMESTAMP_ORDER', `"${key}" ${message}`);
}

function recordId(params, key = 'id') {
  const value = params && params[key];
  if (typeof value !== 'string' || !UUID.test(value)) throw new ProcessError(404, 'NOT_FOUND', 'No such record.');
  return value.toLowerCase();
}

function requireRole(principal, action) {
  if (!principal) throw new ProcessError(401, 'UNAUTHORIZED', 'Authentication is required.');
  if (!isActive(principal)) {
    throw principal.status === 'SUSPENDED'
      ? new ProcessError(403, 'ROLE_SUSPENDED', 'Your Component 3 role is suspended.')
      : new ProcessError(403, 'NO_ACTIVE_ROLE', 'No Component 3 role is assigned to this account.');
  }
  if (!roleAllows(principal.role, action)) throw new ProcessError(403, 'FORBIDDEN', 'Your role may not perform this action.');
}

const actorOf = principal => ({
  role: principal.role, userId: principal.userId, pharmacyId: principal.pharmacyId, distributorId: principal.distributorId,
});

function defaultRefFactory(prefix) {
  return `C3-${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/** Live assessment reads: c3.policy + read repository + the existing engine, 'now' from the clock. */
function createLiveAssessmentReader({ readRepository, clock = () => new Date() } = {}) {
  async function loadPolicy() {
    const row = await readRepository.readPolicyRow(POLICY_V1.version);
    if (!row) throw new ProcessError(503, 'POLICY_UNAVAILABLE', 'The scoring policy is not available.');
    return policyFromRow(row);
  }
  return Object.freeze({
    loadPolicy,
    async assess(code, now = clock()) {
      const bundle = await readRepository.readPharmacyBundle(code);
      if (!bundle) return null;
      return { bundle, assessment: buildLiveAssessment(bundle, { policy: await loadPolicy(), now }) };
    },
    async summaries(now = clock()) {
      const bundles = await readRepository.listPharmacySummaries();
      return summarizeLiveAssessments(bundles, { policy: await loadPolicy(), now });
    },
  });
}

function createLiveProcessService({ writeRepository, readRepository, clock = () => new Date(), refFactory = defaultRefFactory } = {}) {
  if (!writeRepository || !readRepository) throw new Error('Write and read repositories are required.');
  const reader = createLiveAssessmentReader({ readRepository, clock });
  const policyVersion = POLICY_V1.version;
  const optionalRef = (body, key, prefix) => text(body, key, { required: false, max: 64, pattern: REF }) || refFactory(prefix);

  return Object.freeze({
    reader,

    // DISTRIBUTOR ---------------------------------------------------------------------------
    async createDelivery(principal, { body } = {}) {
      requireRole(principal, 'delivery.create');
      only(body, ['pharmacyCode', 'expectedBy', 'deliveryRef']);
      const code = pharmacyCode(body.pharmacyCode);
      const expectedBy = timestamp(body, 'expectedBy');
      const now = clock();
      within(expectedBy, now, new Date(now.getTime() + 90 * DAY_MS), 'expectedBy', 'must be between dispatch (now) and 90 days ahead.');
      const data = await writeRepository.createDelivery(actorOf(principal), {
        deliveryRef: optionalRef(body, 'deliveryRef', 'DL'), pharmacyCode: code, expectedBy, now, policyVersion,
      });
      return { status: 201, data };
    },

    async markArrived(principal, { params, body } = {}) {
      requireRole(principal, 'delivery.markArrived');
      only(body, []);
      const data = await writeRepository.markArrived(actorOf(principal), {
        deliveryId: recordId(params), now: clock(),
        authorize: row => can(principal, 'delivery.markArrived', { distributorId: row.distributor_id }),
      });
      return { status: 200, data };
    },

    // PHARMACY_USER ---------------------------------------------------------------------------
    async confirmReceipt(principal, { params, body } = {}) {
      requireRole(principal, 'delivery.confirm');
      only(body, ['confirmationStatus', 'note']);
      const confirmationStatus = oneOf(body, 'confirmationStatus', ['ACCEPTED', 'PARTIAL', 'REJECTED']);
      const note = text(body, 'note', { required: confirmationStatus !== 'ACCEPTED' });
      const data = await writeRepository.confirmDelivery(actorOf(principal), {
        deliveryId: recordId(params), confirmationStatus, note, now: clock(),
        authorize: row => can(principal, 'delivery.confirm', { pharmacyId: row.pharmacy_id }),
      });
      return { status: 200, data };
    },

    async completeRecallAction(principal, { params, body } = {}) {
      requireRole(principal, 'recallAction.complete');
      only(body, ['note']);
      const data = await writeRepository.completeRecallAction(actorOf(principal), {
        actionId: recordId(params), note: text(body, 'note', { required: false }), now: clock(),
        authorize: row => can(principal, 'recallAction.complete', { pharmacyId: row.pharmacy_id }),
      });
      return { status: 200, data };
    },

    async resolveComplaint(principal, { params, body } = {}) {
      requireRole(principal, 'complaint.resolve');
      only(body, ['note']);
      const data = await writeRepository.resolveComplaint(actorOf(principal), {
        complaintId: recordId(params), note: text(body, 'note'), now: clock(),
        authorize: row => can(principal, 'complaint.resolve', { pharmacyId: row.pharmacy_id }),
      });
      return { status: 200, data };
    },

    // REGULATOR -------------------------------------------------------------------------------
    async issueRecall(principal, { body } = {}) {
      requireRole(principal, 'recall.issue');
      only(body, ['batchReference', 'reason', 'pharmacyCodes', 'actions', 'recallRef']);
      const batchReference = text(body, 'batchReference', { max: 128 });
      const reason = text(body, 'reason');
      if (!Array.isArray(body.pharmacyCodes) || body.pharmacyCodes.length < 1 || body.pharmacyCodes.length > 50) {
        throw invalid('INVALID_VALUE', '"pharmacyCodes" must list 1 to 50 pharmacy codes.');
      }
      const pharmacyCodes = body.pharmacyCodes.map(code => pharmacyCode(code, 'pharmacyCodes[]'));
      if (new Set(pharmacyCodes).size !== pharmacyCodes.length) throw invalid('DUPLICATE_VALUE', '"pharmacyCodes" contains duplicates.');
      if (!Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > ACTION_TYPES.length) {
        throw invalid('INVALID_VALUE', `"actions" must list 1 to ${ACTION_TYPES.length} actions.`);
      }
      const now = clock();
      const actions = body.actions.map(action => {
        only(action, ['actionType', 'dueAt'], 'Each action');
        const dueAt = timestamp(action, 'dueAt');
        within(dueAt, new Date(now.getTime() + 1), new Date(now.getTime() + 365 * DAY_MS), 'dueAt', 'must be after issue (now) and within 365 days.');
        return { actionType: oneOf(action, 'actionType', ACTION_TYPES), dueAt };
      });
      if (new Set(actions.map(action => action.actionType)).size !== actions.length) {
        throw invalid('DUPLICATE_VALUE', 'Each action type may appear once per recall.');
      }
      const data = await writeRepository.issueRecall(actorOf(principal), {
        recallRef: optionalRef(body, 'recallRef', 'RC'), batchReference, reason, pharmacyCodes, actions, now,
      });
      return { status: 201, data };
    },

    async logComplaint(principal, { body } = {}) {
      requireRole(principal, 'complaint.log');
      only(body, ['pharmacyCode', 'summary', 'complaintRef']);
      const data = await writeRepository.logComplaint(actorOf(principal), {
        complaintRef: optionalRef(body, 'complaintRef', 'CP'), pharmacyCode: pharmacyCode(body.pharmacyCode),
        summary: text(body, 'summary', { max: 2000 }), now: clock(), policyVersion,
      });
      return { status: 201, data };
    },

    async screenComplaint(principal, { params, body } = {}) {
      requireRole(principal, 'complaint.screen');
      only(body, ['outcome']);
      const data = await writeRepository.screenComplaint(actorOf(principal), {
        complaintId: recordId(params), outcome: oneOf(body, 'outcome', ['SUBSTANTIATED', 'UNSUBSTANTIATED']), now: clock(),
      });
      return { status: 200, data };
    },

    async recordInspection(principal, { body } = {}) {
      requireRole(principal, 'inspection.record');
      only(body, ['pharmacyCode', 'inspectedAt', 'items', 'inspectionRef']);
      const code = pharmacyCode(body.pharmacyCode);
      const inspectedAt = timestamp(body, 'inspectedAt');
      const now = clock();
      within(inspectedAt, new Date(now.getTime() - 365 * DAY_MS), now, 'inspectedAt', 'must be in the past 365 days, not in the future.');
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
        throw invalid('INVALID_VALUE', '"items" must list 1 to 50 inspection items.');
      }
      const items = body.items.map(item => {
        only(item, ['criterionCode', 'result', 'critical', 'note'], 'Each item');
        const result = oneOf(item, 'result', ITEM_RESULTS);
        if (item.critical !== undefined && typeof item.critical !== 'boolean') throw invalid('INVALID_TYPE', '"critical" must be a boolean.');
        const critical = item.critical === true;
        if (critical && result !== 'NON_COMPLIANT') throw invalid('INVALID_VALUE', 'Only a NON_COMPLIANT item can be flagged critical.');
        return {
          criterionCode: text(item, 'criterionCode', { max: 64, pattern: CRITERION }),
          result, critical, note: text(item, 'note', { required: false, max: 500 }),
        };
      });
      if (new Set(items.map(item => item.criterionCode)).size !== items.length) {
        throw invalid('DUPLICATE_VALUE', 'Each criterion may appear once per inspection.');
      }
      const data = await writeRepository.recordInspection(actorOf(principal), {
        inspectionRef: optionalRef(body, 'inspectionRef', 'IN'), pharmacyCode: code, inspectedAt, items, policyVersion,
      });
      return { status: 201, data };
    },

    async finalizeInspection(principal, { params, body } = {}) {
      requireRole(principal, 'inspection.finalize');
      only(body, []);
      const data = await writeRepository.finalizeInspection(actorOf(principal), { inspectionId: recordId(params), now: clock() });
      return { status: 200, data };
    },

    /** Stores the assessment computed now with its sha256 commitment. No blockchain transaction is sent. */
    async finalizeAssessmentSnapshot(principal, { params, body } = {}) {
      requireRole(principal, 'snapshot.finalize');
      only(body, []);
      const code = pharmacyCode(params && params.pharmacyCode);
      const now = clock();
      const assessed = await reader.assess(code, now);
      if (!assessed) throw new ProcessError(404, 'PHARMACY_NOT_FOUND', 'No assessment record exists for this pharmacy code.');
      const { bundle, assessment } = assessed;
      let payload;
      try {
        payload = buildAnchorPayload(assessment, code);
      } catch (error) {
        throw new ProcessError(422, 'SNAPSHOT_NOT_ENCODABLE', error.message);
      }
      const snapshot = await writeRepository.insertSnapshot(actorOf(principal), {
        pharmacyId: bundle.pharmacy.id,
        policyVersion: assessment.policyVersion,
        asOf: assessment.asOf,
        status: assessment.status,
        score: assessment.score,
        tier: assessment.status === 'ASSESSABLE' ? assessment.tier : null,
        breakdown: assessment.breakdown,
        evidenceRefs: Object.fromEntries(Object.entries(assessment.calculation).map(([name, detail]) => [name, detail.evidenceIds])),
        evidenceClasses: assessment.provenance.evidenceClasses,
        criticalEscalationRequired: assessment.criticalEscalationRequired,
        sha256: payload.assessmentHash,
        computedBy: COMPUTED_BY,
        now,
      });
      return {
        status: 201,
        data: {
          snapshot,
          assessmentHash: payload.assessmentHash,
          scoreMilli: payload.scoreMilli,
          blockchainVerification: 'NOT_PERFORMED',
          note: 'The hash commits to the assessment content; no blockchain transaction was sent.',
        },
      };
    },
  });
}

module.exports = { COMPUTED_BY, createLiveProcessService, createLiveAssessmentReader, requireRole };
