export const DEMO_API_BASE = '/c3-demo-api';
export const LIVE_API_BASE = '/c3-api';
export const DEMO_BEARER_TOKEN = 'component3-local-demo';

const RESOURCES = ['trust-assessment', 'trust-assessment/evidence', 'trust-assessment/critical-findings'];

function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function getJson(path, headers, fetchImpl, service = 'live') {
  let response;
  try {
    response = await fetchImpl(path, {
      method: 'GET',
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    throw new Error('Cannot reach the Component 3 API. Check which backend is running and the frontend proxy.');
  }
  if (!response || response.redirected || (response.status >= 300 && response.status < 400)) {
    throw apiError('The Component 3 API redirected unexpectedly.', response?.status);
  }
  let bodyText;
  try {
    bodyText = typeof response.text === 'function'
      ? await response.text()
      : JSON.stringify(await response.json());
  } catch {
    throw apiError(`The Component 3 ${service} API response could not be read (HTTP ${response.status || 'unknown'}).`, response.status);
  }
  let result;
  try {
    if (!bodyText) throw new Error('empty response');
    result = JSON.parse(bodyText);
  } catch {
    const detail = service === 'live'
      ? 'Check that the PostgreSQL runtime started on 127.0.0.1:5005. The unapplied authorization migration prevents its required role/schema checks from succeeding.'
      : 'Check that the synthetic demo server is running on 127.0.0.1:5003.';
    throw apiError(`The Component 3 ${service} API returned a non-JSON response (HTTP ${response.status || 'unknown'}). ${detail}`, response.status);
  }
  if (!response.ok || result?.success !== true || !result.data || typeof result.data !== 'object') {
    if (result?.error === 'AUTHORIZATION_SCHEMA_NOT_READY' || result?.error === 'AUTHORIZATION_DATABASE_PRIVILEGES_MISSING') {
      throw apiError(result.message || 'Component 3 authorization database setup is incomplete.', response.status, result.error);
    }
    if (response.status === 401) throw apiError(result?.message || 'Authentication is required or has expired. Check the selected mode and credentials.', 401, result?.error);
    if (response.status === 403) throw apiError(result?.message || 'Access is denied for this pharmacy or requested information.', 403, result?.error);
    if (response.status === 404) throw apiError(result?.message || 'No assessment was found for this pharmacy code.', 404, result?.error);
    if (response.status >= 500) throw apiError(result?.message || `The Component 3 service returned an error (HTTP ${response.status}). Try again later.`, response.status, result?.error);
    throw apiError(result?.message || `Component 3 request failed (${response.status || 'unknown status'}).`, response.status, result?.error);
  }
  return result.data;
}

async function getResource(base, pharmacyCode, resource, headers, fetchImpl) {
  const path = `${base}/api/v1/pharmacies/${encodeURIComponent(pharmacyCode)}/${resource}`;
  return getJson(path, headers, fetchImpl, base === DEMO_API_BASE ? 'demo' : 'live');
}

function requestHeaders({ demo, accessToken, walletToken }) {
  if (!demo && (typeof accessToken !== 'string' || !accessToken.trim())) {
    throw new Error('A verified Supabase access token is required for live API requests.');
  }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${demo ? DEMO_BEARER_TOKEN : accessToken.trim()}`,
  };
  if (!demo && typeof walletToken === 'string' && walletToken.trim()) {
    headers['X-Component4-Wallet-Token'] = walletToken.trim();
  }
  return headers;
}

export async function fetchAuthorizedPharmacies({ accessToken, walletToken, mode = 'live', fetchImpl = globalThis.fetch } = {}) {
  const demo = mode === 'demo';
  const headers = requestHeaders({ demo, accessToken, walletToken });
  const access = await getJson(`${demo ? DEMO_API_BASE : LIVE_API_BASE}/api/v1/session/pharmacies`, headers, fetchImpl, demo ? 'demo' : 'live');
  if (!Array.isArray(access?.pharmacies) || typeof access.requiresWalletVerification !== 'boolean') {
    throw new Error('The Component 3 API returned an invalid authorized-pharmacy list.');
  }
  for (const pharmacy of access.pharmacies) {
    if (!pharmacy || typeof pharmacy.pharmacyCode !== 'string' ||
        !Array.isArray(pharmacy.accessTypes) || !pharmacy.accessTypes.every(value => ['PHARMACY', 'REGULATORY'].includes(value)) ||
        !Array.isArray(pharmacy.permissions) || !pharmacy.permissions.every(value =>
          ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'].includes(value))) {
      throw new Error('The Component 3 API returned an invalid authorized-pharmacy entry.');
    }
  }
  return access;
}

export async function fetchComponent3Dashboard({
  pharmacyCode,
  mode = 'live',
  accessToken,
  walletToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedCode = typeof pharmacyCode === 'string' ? pharmacyCode.trim() : '';
  if (!normalizedCode) throw new Error('Enter a pharmacy code.');
  if (typeof fetchImpl !== 'function') throw new Error('A browser fetch implementation is required.');

  const demo = mode === 'demo';
  const base = demo ? DEMO_API_BASE : LIVE_API_BASE;
  const headers = requestHeaders({ demo, accessToken, walletToken });

  if (demo) {
    const [assessment, evidence, criticalFindings] = await Promise.all(
      RESOURCES.map(resource => getResource(base, normalizedCode, resource, headers, fetchImpl)),
    );
    return { assessment, evidence, criticalFindings };
  }

  const assessment = await getResource(base, normalizedCode, RESOURCES[0], headers, fetchImpl);
  const optionalResource = resource => getResource(base, normalizedCode, resource, headers, fetchImpl)
    .catch(error => error?.status === 403 ? { accessDenied: true } : Promise.reject(error));
  const [evidence, criticalFindings] = await Promise.all([
    optionalResource(RESOURCES[1]),
    optionalResource(RESOURCES[2]),
  ]);
  return { assessment, evidence, criticalFindings };
}

/**
 * One overview entry from the existing read-only endpoints: the assessment, plus
 * critical findings when permitted. A denied critical-findings read returns
 * { accessDenied: true }; any assessment failure is thrown for the caller to report.
 */
export async function fetchOverviewEntry({
  pharmacyCode,
  mode = 'live',
  accessToken,
  walletToken,
  includeCriticalFindings = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedCode = typeof pharmacyCode === 'string' ? pharmacyCode.trim() : '';
  if (!normalizedCode) throw new Error('A pharmacy code is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A browser fetch implementation is required.');
  const demo = mode === 'demo';
  const base = demo ? DEMO_API_BASE : LIVE_API_BASE;
  const headers = requestHeaders({ demo, accessToken, walletToken });
  const assessment = await getResource(base, normalizedCode, RESOURCES[0], headers, fetchImpl);
  const criticalFindings = includeCriticalFindings
    ? await getResource(base, normalizedCode, RESOURCES[2], headers, fetchImpl)
      .catch(error => (error?.status === 403 ? { accessDenied: true } : Promise.reject(error)))
    : null;
  return { assessment, criticalFindings };
}
