'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const BASE = '/api/v1/pharmacies/';
const WALLET_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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

function fail(res, statusCode, error, message) {
  sendJson(res, statusCode, { success: false, error, message });
}

function parseRoute(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  const match = /^\/api\/v1\/pharmacies\/([^/]*)\/trust-assessment(?:\/(evidence|critical-findings))?$/.exec(pathname);
  if (!match) return null;
  let pharmacyId;
  try { pharmacyId = decodeURIComponent(match[1]); } catch { return { invalidId: true }; }
  return { pharmacyId, resource: match[2] || 'assessment' };
}

function validatePharmacyId(pharmacyId) {
  return typeof pharmacyId === 'string' &&
    pharmacyId.length > 0 && pharmacyId.length <= 128 &&
    pharmacyId === pharmacyId.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(pharmacyId) &&
    !WALLET_ADDRESS.test(pharmacyId);
}

function createComponent3Server({ assessmentService, authenticate, authorizePharmacy, listAuthorizedPharmacies } = {}) {
  return http.createServer(async (req, res) => {
    if (req.url.length > 2048) return fail(res, 414, 'URI_TOO_LONG', 'Request URL exceeds the allowed length.');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.');
    }
    if ((req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding']) {
      req.resume();
      return fail(res, 400, 'UNSUPPORTED_REQUEST_BODY', 'This read-only API does not accept request bodies.');
    }

    let parsedUrl;
    try { parsedUrl = new URL(req.url, 'http://localhost'); } catch {
      return fail(res, 400, 'INVALID_REQUEST', 'Request URL is malformed.');
    }
    if (parsedUrl.searchParams.size > 0) return fail(res, 400, 'UNSUPPORTED_QUERY_FIELDS', 'Query parameters are not supported.');
    if (parsedUrl.pathname === '/api/v1/session/pharmacies') {
      if (typeof authenticate !== 'function' || typeof listAuthorizedPharmacies !== 'function') {
        return fail(res, 503, 'AUTH_CONFIGURATION_ERROR', 'Authenticated pharmacy discovery is not configured.');
      }
      let principal;
      try { principal = await authenticate(req); } catch {
        return fail(res, 503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication could not be completed.');
      }
      if (!principal) return fail(res, 401, 'UNAUTHORIZED', 'Authentication is required.');
      let access;
      try { access = await listAuthorizedPharmacies({ principal, request: req }); } catch (error) {
        if (['42P01', '3F000', '42703'].includes(error?.code)) {
          return fail(res, 503, 'AUTHORIZATION_SCHEMA_NOT_READY', 'Component 3 authorization tables are missing or out of date. Review and apply migrations/001_component3_authorization.sql, then restart the runtime.');
        }
        if (error?.code === '42501') {
          return fail(res, 503, 'AUTHORIZATION_DATABASE_PRIVILEGES_MISSING', 'The Component 3 runtime database role lacks required read privileges. Review its least-privilege grants and row-level security policies.');
        }
        return fail(res, 503, 'AUTHORIZATION_UNAVAILABLE', 'Component 3 access could not be retrieved. Confirm its authorization schema and runtime configuration.');
      }
      if (!access || !Array.isArray(access.pharmacies) || typeof access.requiresWalletVerification !== 'boolean') {
        return fail(res, 503, 'AUTHORIZATION_UNAVAILABLE', 'Component 3 access returned an invalid response.');
      }
      const pharmacies = access.pharmacies.filter(item => item && typeof item.pharmacyCode === 'string' &&
        Array.isArray(item.accessTypes) && Array.isArray(item.permissions)).map(item => ({
        pharmacyCode: item.pharmacyCode,
        accessTypes: item.accessTypes.filter(value => value === 'PHARMACY' || value === 'REGULATORY'),
        permissions: item.permissions.filter(value => ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'].includes(value)),
      }));
      return sendJson(res, 200, {
        success: true,
        data: { pharmacies, requiresWalletVerification: access.requiresWalletVerification },
      });
    }

    const route = parseRoute(parsedUrl.pathname);
    if (!route) return fail(res, 404, 'NOT_FOUND', 'Route not found.');
    if (route.invalidId || !validatePharmacyId(route.pharmacyId)) {
      return fail(res, 400, 'INVALID_PHARMACY_ID', 'A valid explicit pharmacy ID is required.');
    }
    if (typeof authenticate !== 'function' || typeof authorizePharmacy !== 'function') {
      return fail(res, 503, 'AUTH_CONFIGURATION_ERROR', 'Authentication and pharmacy authorization are not configured.');
    }
    if (!assessmentService || typeof assessmentService.getAssessment !== 'function') {
      return fail(res, 503, 'ASSESSMENT_SOURCE_UNAVAILABLE', 'No read-only assessment source is configured.');
    }

    let principal;
    try { principal = await authenticate(req); } catch {
      return fail(res, 503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication could not be completed.');
    }
    if (!principal) return fail(res, 401, 'UNAUTHORIZED', 'Authentication is required.');
    let authorized;
    try { authorized = await authorizePharmacy({ principal, pharmacyId: route.pharmacyId, request: req }); } catch {
      return fail(res, 503, 'AUTHORIZATION_UNAVAILABLE', 'Pharmacy authorization could not be completed.');
    }
    if (authorized !== true) return fail(res, 403, 'FORBIDDEN', 'The caller is not authorized to read this pharmacy assessment.');

    let assessment;
    try { assessment = await assessmentService.getAssessment(route.pharmacyId); } catch {
      return fail(res, 503, 'ASSESSMENT_UNAVAILABLE', 'The pharmacy assessment could not be retrieved.');
    }
    if (!assessment) return fail(res, 404, 'PHARMACY_NOT_FOUND', 'No assessment record exists for this pharmacy ID.');

    if (route.resource === 'critical-findings') {
      return sendJson(res, 200, {
        success: true,
        data: {
          pharmacyId: assessment.pharmacyId,
          demoLabel: assessment.demoLabel,
          blockchainVerification: 'NOT_PERFORMED',
          required: assessment.criticalEscalation.required,
          findings: assessment.criticalEscalation.findings,
        },
      });
    }
    if (route.resource === 'evidence') {
      return sendJson(res, 200, {
        success: true,
        data: {
          pharmacyId: assessment.pharmacyId,
          demoLabel: assessment.demoLabel,
          blockchainVerification: 'NOT_PERFORMED',
          status: assessment.status,
          evidenceSource: assessment.evidenceSource,
          indicatorEvidence: assessment.indicatorEvidence,
          evidenceValidation: assessment.evidenceValidation,
          component1: assessment.component1,
          limitations: assessment.limitations,
        },
      });
    }
    return sendJson(res, 200, {
      success: true,
      data: {
        pharmacyId: assessment.pharmacyId,
        demoLabel: assessment.demoLabel,
        blockchainVerification: 'NOT_PERFORMED',
        status: assessment.status,
        score: assessment.score,
        tier: assessment.tier,
        breakdown: assessment.breakdown,
        missingIndicators: assessment.missingIndicators,
        criticalEscalationRequired: assessment.criticalEscalation.required,
        evidenceSource: assessment.evidenceSource,
        limitations: assessment.limitations,
      },
    });
  });
}

module.exports = { createComponent3Server };
