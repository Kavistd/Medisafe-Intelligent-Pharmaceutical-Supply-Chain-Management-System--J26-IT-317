/**
 * Thin client for the Component 3 live API (docs/component3/LIVE_API.md), reached
 * same-origin through the Vite /c3-api proxy. Uses the Supabase session token as a
 * Bearer token, sends and accepts JSON only, and maps every failure to a safe,
 * user-facing message: raw server text and stack traces are never shown.
 */
export const LIVE_API_BASE = '/c3-api';

const STATUS_MESSAGES = Object.freeze({
  0: 'Cannot reach the Component 3 live service. Check that it is running and try again.',
  400: 'The request was not accepted. Check the form and try again.',
  401: 'Your session has expired or could not be verified. Sign in again.',
  403: 'Your role is not permitted to do this.',
  404: 'That record was not found or is not available to your role.',
  405: 'The request was not accepted. Check the form and try again.',
  409: 'This step has already been completed or is not possible in the record\'s current state.',
  413: 'The submitted data is too large.',
  415: 'The request was not accepted. Check the form and try again.',
  422: 'Some details are invalid. Check the form and try again.',
  503: 'The Component 3 service is temporarily unavailable. Try again shortly.',
});
const GENERIC_MESSAGE = 'The request could not be completed. Try again shortly.';

// Known server codes -> fixed wording (the server's own message text is never displayed).
const CODE_MESSAGES = Object.freeze({
  ROLE_SUSPENDED: 'Your Component 3 role is suspended.',
  NO_ACTIVE_ROLE: 'No Component 3 role is assigned to this account.',
  AUTHENTICATION_UNAVAILABLE: 'Sign-in could not be verified right now. Try again shortly.',
  PHARMACY_NOT_FOUND: 'No active pharmacy with this code is available.',
  DELIVERY_NOT_FOUND: 'That delivery was not found or is not yours.',
  RECALL_ACTION_NOT_FOUND: 'That recall action was not found or is not yours.',
  COMPLAINT_NOT_FOUND: 'That complaint was not found or is not available to you.',
  INSPECTION_NOT_FOUND: 'That inspection was not found.',
  ALREADY_ARRIVED: 'This delivery has already been marked as arrived.',
  NOT_ARRIVED: 'This delivery has not been marked as arrived yet.',
  ALREADY_CONFIRMED: 'This delivery has already been confirmed.',
  ALREADY_COMPLETED: 'This recall action has already been completed.',
  ALREADY_SCREENED: 'This complaint has already been screened.',
  ALREADY_RESOLVED: 'This complaint has already been resolved.',
  NOT_RESOLVABLE: 'Only substantiated complaints can be resolved.',
  ALREADY_FINAL: 'This inspection has already been finalised.',
  DUPLICATE_RECORD: 'A record with this reference already exists.',
  TIMESTAMP_ORDER: 'A date is outside the allowed range or in the wrong order.',
  UNKNOWN_PHARMACY: 'One or more pharmacy codes are unknown or inactive.',
  UNKNOWN_CRITERION: 'One or more inspection criteria are unknown.',
  DUPLICATE_VALUE: 'The same value was entered more than once.',
  SNAPSHOT_NOT_ENCODABLE: 'This assessment cannot be finalised as a snapshot right now.',
  POLICY_UNAVAILABLE: 'The scoring policy is not available. Try again shortly.',
  PAYLOAD_TOO_LARGE: 'The submitted data is too large.',
});

export class LiveApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'LiveApiError';
    this.status = status;
    this.code = code;
  }
}

/** Safe message for a status and optional server error code. */
export function mapLiveError(status, code) {
  const safeStatus = Number.isInteger(status) ? status : 0;
  const message = (typeof code === 'string' && CODE_MESSAGES[code])
    || STATUS_MESSAGES[safeStatus]
    || (safeStatus >= 500 ? STATUS_MESSAGES[503] : GENERIC_MESSAGE);
  return new LiveApiError(safeStatus, typeof code === 'string' ? code : null, message);
}

const segment = value => encodeURIComponent(String(value));

/**
 * createLiveClient({ getAccessToken, fetchImpl, base })
 * getAccessToken: async () => current Supabase access token (refreshed by the caller).
 */
export function createLiveClient({ getAccessToken, fetchImpl = globalThis.fetch, base = LIVE_API_BASE } = {}) {
  if (typeof getAccessToken !== 'function') throw new Error('An access-token provider is required.');

  async function request(method, path, body) {
    let token;
    try { token = await getAccessToken(); } catch { throw mapLiveError(401, 'UNAUTHORIZED'); }
    if (typeof token !== 'string' || !token) throw mapLiveError(401, 'UNAUTHORIZED');
    if (typeof fetchImpl !== 'function') throw mapLiveError(0, null);
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'manual',
      });
    } catch {
      throw mapLiveError(0, null);
    }
    if (!response || response.redirected || (response.status >= 300 && response.status < 400)) throw mapLiveError(503, null);
    let payload = null;
    try {
      const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok || !payload || payload.success !== true) {
      throw mapLiveError(response.ok ? 503 : response.status, payload && payload.error);
    }
    return payload.data;
  }

  const get = path => request('GET', path);
  const post = (path, body) => request('POST', path, body);

  return Object.freeze({
    // Reads
    getSession: () => get('/api/v1/live/session'),
    getCalculation: code => get(`/api/v1/live/pharmacies/${segment(code)}/calculation`),
    getCriticalFindings: code => get(`/api/v1/pharmacies/${segment(code)}/trust-assessment/critical-findings`),
    getPharmacyTasks: () => get('/api/v1/live/pharmacy/tasks'),
    getDistributorDeliveries: () => get('/api/v1/live/distributor/deliveries'),
    getRegulatorOverview: () => get('/api/v1/live/regulator/overview'),
    getRegulatorComplaints: () => get('/api/v1/live/regulator/complaints'),
    getRegulatorRecalls: () => get('/api/v1/live/regulator/recalls'),
    getRegulatorInspections: () => get('/api/v1/live/regulator/inspections'),
    getAuditLog: (limit = 50) => get(`/api/v1/live/regulator/audit-log?limit=${segment(limit)}`),
    getPharmacyDirectory: () => get('/api/v1/live/pharmacy-directory'),
    getInspectionCriteria: () => get('/api/v1/live/inspection-criteria'),
    // Writes (server-authoritative; actor and role come from the verified session server-side)
    createDelivery: body => post('/api/v1/live/deliveries', body),
    markArrived: id => post(`/api/v1/live/deliveries/${segment(id)}/arrive`, {}),
    confirmDelivery: (id, body) => post(`/api/v1/live/deliveries/${segment(id)}/confirm`, body),
    completeRecallAction: (id, body) => post(`/api/v1/live/recall-actions/${segment(id)}/complete`, body),
    resolveComplaint: (id, body) => post(`/api/v1/live/complaints/${segment(id)}/resolve`, body),
    issueRecall: body => post('/api/v1/live/recalls', body),
    logComplaint: body => post('/api/v1/live/complaints', body),
    screenComplaint: (id, body) => post(`/api/v1/live/complaints/${segment(id)}/screen`, body),
    recordInspection: body => post('/api/v1/live/inspections', body),
    finalizeInspection: id => post(`/api/v1/live/inspections/${segment(id)}/finalize`, {}),
    finalizeSnapshot: code => post(`/api/v1/live/pharmacies/${segment(code)}/assessment-snapshots`, {}),
  });
}
