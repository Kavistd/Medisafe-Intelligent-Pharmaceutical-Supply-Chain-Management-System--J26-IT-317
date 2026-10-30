'use strict';

/**
 * HTTP layer for the Component 3 live runtime.
 * - The existing GET routes (session pharmacies, trust-assessment, evidence,
 *   critical-findings) are served by server.js's own handler (imported factory, not
 *   edited), backed by the live engine, so their response shape is unchanged.
 * - New routes under /api/v1/live/: role workspaces (GET) and processes (POST JSON).
 * Every new route: verified principal -> permissions.js -> validation -> service.
 * Safe JSON errors only (no stack traces), body size limit, JSON content type, no CORS
 * headers (same-origin through the Vite /c3-api proxy). 'now' is the server clock.
 */
const http = require('node:http');
const { URL } = require('node:url');
const { createComponent3Server } = require('../../server');
const { ProcessError } = require('./liveErrors');
const { can } = require('./permissions');
const { requireRole } = require('./liveProcessService');

const MAX_BODY_BYTES = 16 * 1024;
const LEGACY_ROUTE = /^\/api\/v1\/(?:session\/pharmacies|pharmacies\/[^/]*\/trust-assessment(?:\/(?:evidence|critical-findings))?)$/;

function sendJson(res, statusCode, body) {
  const serialized = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(serialized);
}

function sendError(res, error) {
  const safe = error instanceof ProcessError
    ? error
    : new ProcessError(503, 'SERVICE_UNAVAILABLE', 'The request could not be completed. Try again later.');
  sendJson(res, safe.status, { success: false, error: safe.code, message: safe.message });
}

/** Per-indicator evidence summary in the shape server.js returns as indicatorEvidence. */
function indicatorEvidence(assessment) {
  return Object.fromEntries(Object.entries(assessment.calculation).map(([name, detail]) => [name, {
    status: detail.status === 'ASSESSABLE' ? 'USABLE' : 'INSUFFICIENT',
    evidenceCount: detail.evidenceIds.length,
    provenance: detail.evidenceClasses.length ? detail.evidenceClasses.join('+') : 'NONE',
    evidenceIds: [...detail.evidenceIds],
    reason: detail.reason,
  }]));
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(type)) {
      req.resume();
      reject(new ProcessError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request bodies must be application/json.'));
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new ProcessError(413, 'PAYLOAD_TOO_LARGE', `Request bodies are limited to ${maxBytes} bytes.`));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('error', () => reject(new ProcessError(400, 'INVALID_REQUEST', 'The request body could not be read.')));
    req.on('end', () => {
      if (tooLarge) return reject(new ProcessError(413, 'PAYLOAD_TOO_LARGE', `Request bodies are limited to ${maxBytes} bytes.`));
      const textBody = Buffer.concat(chunks).toString('utf8');
      if (textBody.trim() === '') return resolve({});
      try { resolve(JSON.parse(textBody)); } catch { reject(new ProcessError(400, 'INVALID_JSON', 'The request body is not valid JSON.')); }
    });
  });
}

function createLiveServer({ auth, processService, workspaceRepository, clock = () => new Date(), maxBodyBytes = MAX_BODY_BYTES } = {}) {
  if (!auth || !processService || !workspaceRepository) throw new Error('auth, processService and workspaceRepository are required.');
  const reader = processService.reader;

  const legacy = createComponent3Server({
    assessmentService: {
      async getAssessment(pharmacyCode) {
        const assessed = await reader.assess(pharmacyCode, clock());
        if (!assessed) return null;
        return { ...assessed.assessment, demoLabel: null, indicatorEvidence: indicatorEvidence(assessed.assessment), component1: null };
      },
    },
    authenticate: auth.authenticate,
    authorizePharmacy: auth.authorizePharmacy,
    listAuthorizedPharmacies: auth.listAuthorizedPharmacies,
  });
  const legacyHandler = legacy.listeners('request')[0];

  const ok = data => ({ status: 200, data });
  const scopedPharmacy = (principal, action, code) => {
    if (!can(principal, action, { pharmacyCode: code })) {
      throw new ProcessError(403, 'FORBIDDEN', 'The caller is not authorized for this pharmacy.');
    }
  };

  const routes = [
    { method: 'GET', path: /^\/api\/v1\/live\/session$/, action: 'session.read',
      run: async ({ principal }) => ok(await auth.describeSession(principal)) },
    { method: 'GET', path: /^\/api\/v1\/live\/pharmacies\/([^/]+)\/calculation$/, params: ['pharmacyCode'], action: 'calculation.read',
      run: async ({ principal, params }) => {
        scopedPharmacy(principal, 'calculation.read', params.pharmacyCode);
        const assessed = await reader.assess(params.pharmacyCode, clock());
        if (!assessed) throw new ProcessError(404, 'PHARMACY_NOT_FOUND', 'No assessment record exists for this pharmacy code.');
        const a = assessed.assessment;
        return ok({
          pharmacyId: a.pharmacyId, asOf: a.asOf, policyVersion: a.policyVersion, policyLabel: a.policyLabel,
          status: a.status, score: a.score, tier: a.tier, breakdown: a.breakdown, missingIndicators: a.missingIndicators,
          calculation: a.calculation, provenance: a.provenance, criticalEscalationRequired: a.criticalEscalationRequired,
          blockchainVerification: 'NOT_PERFORMED', limitations: a.limitations,
        });
      } },
    { method: 'GET', path: /^\/api\/v1\/live\/pharmacy\/tasks$/, action: 'workspace.pharmacy',
      run: async ({ principal }) => ok(await workspaceRepository.pharmacyTasks(principal.pharmacyId)) },
    { method: 'GET', path: /^\/api\/v1\/live\/distributor\/deliveries$/, action: 'workspace.distributor',
      run: async ({ principal }) => ok(await workspaceRepository.distributorDeliveries(principal.distributorId)) },
    { method: 'GET', path: /^\/api\/v1\/live\/regulator\/overview$/, action: 'overview.read',
      run: async () => ok(await reader.summaries(clock())) },
    { method: 'GET', path: /^\/api\/v1\/live\/regulator\/complaints$/, action: 'workspace.regulator',
      run: async () => ok(await workspaceRepository.openComplaints()) },
    { method: 'GET', path: /^\/api\/v1\/live\/regulator\/recalls$/, action: 'workspace.regulator',
      run: async () => ok(await workspaceRepository.recalls()) },
    { method: 'GET', path: /^\/api\/v1\/live\/regulator\/inspections$/, action: 'workspace.regulator',
      run: async () => ok(await workspaceRepository.inspections()) },
    { method: 'GET', path: /^\/api\/v1\/live\/regulator\/audit-log$/, action: 'auditLog.read', query: ['limit'],
      run: async ({ query }) => {
        const raw = query.get('limit');
        const limit = raw === null ? 50 : Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (raw !== null && !/^\d+$/.test(raw))) {
          throw new ProcessError(400, 'INVALID_QUERY', '"limit" must be an integer from 1 to 200.');
        }
        return ok(await workspaceRepository.auditLog(limit));
      } },
    { method: 'GET', path: /^\/api\/v1\/live\/pharmacy-directory$/, action: 'directory.read',
      run: async () => ok(await workspaceRepository.pharmacyDirectory()) },
    { method: 'GET', path: /^\/api\/v1\/live\/inspection-criteria$/, action: 'criteria.read',
      run: async () => ok(await workspaceRepository.criteria()) },

    { method: 'POST', path: /^\/api\/v1\/live\/deliveries$/, action: 'delivery.create', run: input => processService.createDelivery(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/deliveries\/([^/]+)\/arrive$/, params: ['id'], action: 'delivery.markArrived', run: input => processService.markArrived(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/deliveries\/([^/]+)\/confirm$/, params: ['id'], action: 'delivery.confirm', run: input => processService.confirmReceipt(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/recall-actions\/([^/]+)\/complete$/, params: ['id'], action: 'recallAction.complete', run: input => processService.completeRecallAction(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/complaints\/([^/]+)\/resolve$/, params: ['id'], action: 'complaint.resolve', run: input => processService.resolveComplaint(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/recalls$/, action: 'recall.issue', run: input => processService.issueRecall(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/complaints$/, action: 'complaint.log', run: input => processService.logComplaint(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/complaints\/([^/]+)\/screen$/, params: ['id'], action: 'complaint.screen', run: input => processService.screenComplaint(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/inspections$/, action: 'inspection.record', run: input => processService.recordInspection(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/inspections\/([^/]+)\/finalize$/, params: ['id'], action: 'inspection.finalize', run: input => processService.finalizeInspection(input.principal, input) },
    { method: 'POST', path: /^\/api\/v1\/live\/pharmacies\/([^/]+)\/assessment-snapshots$/, params: ['pharmacyCode'], action: 'snapshot.finalize', run: input => processService.finalizeAssessmentSnapshot(input.principal, input) },
  ];

  async function handler(req, res) {
    try {
      if (typeof req.url !== 'string' || req.url.length > 2048) throw new ProcessError(414, 'URI_TOO_LONG', 'Request URL exceeds the allowed length.');
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { throw new ProcessError(400, 'INVALID_REQUEST', 'Request URL is malformed.'); }

      if (req.method === 'GET' && LEGACY_ROUTE.test(url.pathname)) return await legacyHandler(req, res);

      const candidates = routes.filter(route => route.path.test(url.pathname));
      if (candidates.length === 0) throw new ProcessError(404, 'NOT_FOUND', 'Route not found.');
      const route = candidates.find(candidate => candidate.method === req.method);
      if (!route) {
        res.setHeader('Allow', [...new Set(candidates.map(candidate => candidate.method))].join(', '));
        throw new ProcessError(405, 'METHOD_NOT_ALLOWED', 'This method is not supported for this route.');
      }
      for (const key of url.searchParams.keys()) {
        if (!(route.query || []).includes(key)) throw new ProcessError(400, 'UNSUPPORTED_QUERY_FIELDS', 'Unsupported query parameters.');
      }
      const params = {};
      const match = route.path.exec(url.pathname);
      for (const [index, name] of (route.params || []).entries()) {
        try { params[name] = decodeURIComponent(match[index + 1]); } catch { throw new ProcessError(404, 'NOT_FOUND', 'Route not found.'); }
      }

      let principal;
      try { principal = await auth.authenticate(req); } catch {
        throw new ProcessError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication could not be completed.');
      }
      if (!principal) throw new ProcessError(401, 'UNAUTHORIZED', 'Authentication is required.');
      requireRole(principal, route.action);

      let body;
      if (route.method === 'POST') {
        body = await readJsonBody(req, maxBodyBytes);
      } else if ((req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding']) {
        req.resume();
        throw new ProcessError(400, 'UNSUPPORTED_REQUEST_BODY', 'GET requests do not accept a body.');
      }
      const result = await route.run({ principal, params, body, query: url.searchParams });
      return sendJson(res, result.status, { success: true, data: result.data });
    } catch (error) {
      if (res.headersSent) return undefined;
      return sendError(res, error);
    }
  }

  return { handler, server: http.createServer(handler) };
}

module.exports = { MAX_BODY_BYTES, createLiveServer, indicatorEvidence };
