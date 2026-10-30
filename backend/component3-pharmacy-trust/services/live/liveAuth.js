'use strict';

/**
 * Authentication for the Component 3 live runtime. The Supabase access token is
 * verified server-side against /auth/v1/user (same approach as component3Auth.js:
 * bearer/JWT shape check, no redirects, 5 s timeout, fail closed). The role and its
 * scope ALWAYS come from the caller's c3.user_roles row, never from the client.
 * No row -> authenticated but no access; SUSPENDED -> no access (deny by default).
 */
const { validateComponent3AuthConfig, permissionForRequest } = require('../component3Auth');
const { can, allowedActions, isActive } = require('./permissions');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SQL = Object.freeze({
  roleForUser: `
    SELECT r.role, r.status, r.pharmacy_id, p.pharmacy_code, r.distributor_id, d.distributor_code
    FROM c3.user_roles AS r
    LEFT JOIN c3.pharmacies AS p ON p.id = r.pharmacy_id
    LEFT JOIN c3.distributors AS d ON d.id = r.distributor_id
    WHERE r.user_id = $1
    ORDER BY (r.status = 'ACTIVE') DESC, r.granted_at DESC
    LIMIT 1`,
});

// server.js permission names -> live matrix actions for its existing GET routes.
const LEGACY_PERMISSION_ACTIONS = Object.freeze({
  ASSESSMENT_READ: 'assessment.read',
  EVIDENCE_READ: 'evidence.read',
  CRITICAL_FINDINGS_READ: 'criticalFindings.read',
});

function bearerToken(request) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header !== 'string' || header.length > 8192) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header);
  if (!match || match[1].split('.').length !== 3) return null;
  return match[1];
}

/** Supabase token verifier: user id for a valid token, null when rejected, throws when unavailable. */
function createSupabaseTokenVerifier({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  validateComponent3AuthConfig(env);
  if (typeof fetchImpl !== 'function') throw new Error('A server-side fetch implementation is required.');
  const userEndpoint = new URL('/auth/v1/user', env.SUPABASE_URL).toString();
  return async function verifyToken(token) {
    let response;
    try {
      response = await fetchImpl(userEndpoint, {
        method: 'GET',
        redirect: 'manual',
        headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error('Supabase Auth verification service is unavailable.');
    }
    if (response && ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect')) {
      throw new Error('Supabase Auth verification endpoint redirected unexpectedly.');
    }
    if ([400, 401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error('Supabase Auth verification service returned an error.');
    let user;
    try { user = await response.json(); } catch { throw new Error('Supabase Auth returned an invalid response.'); }
    return user && typeof user.id === 'string' && UUID.test(user.id) ? user.id.toLowerCase() : null;
  };
}

/**
 * createLiveAuth({ pool, readRepository, tokenVerifier | env+fetchImpl })
 * Returns the interface server.js expects (authenticate, authorizePharmacy,
 * listAuthorizedPharmacies) plus isVerifiedPrincipal and describeSession.
 */
function createLiveAuth({ pool, readRepository, tokenVerifier, env, fetchImpl } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('A pg pool with query() is required.');
  if (!readRepository || typeof readRepository.listVisiblePharmacies !== 'function') {
    throw new Error('The live read repository is required.');
  }
  const verifyToken = tokenVerifier || createSupabaseTokenVerifier({ env, fetchImpl });
  const verified = new WeakSet();

  async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) return null;
    const userId = await verifyToken(token); // throws -> service unavailable (fail closed)
    if (!userId) return null;
    const result = await pool.query(SQL.roleForUser, [userId]);
    if (!result || !Array.isArray(result.rows)) throw new Error('Role lookup returned invalid data.');
    const row = result.rows[0] || null;
    const principal = Object.freeze({
      userId,
      role: row ? row.role : null,
      status: row ? row.status : 'NO_ROLE',
      pharmacyId: row?.pharmacy_id ?? null,
      pharmacyCode: row?.pharmacy_code ?? null,
      distributorId: row?.distributor_id ?? null,
      distributorCode: row?.distributor_code ?? null,
    });
    verified.add(principal);
    return principal;
  }

  function isVerifiedPrincipal(principal) {
    return Boolean(principal && verified.has(principal));
  }

  /** server.js hook for its existing GET routes; the action comes from the requested path. */
  async function authorizePharmacy({ principal, pharmacyId, request } = {}) {
    if (!isVerifiedPrincipal(principal)) return false;
    const action = LEGACY_PERMISSION_ACTIONS[permissionForRequest(request || {})];
    return Boolean(action) && can(principal, action, { pharmacyCode: pharmacyId });
  }

  /** server.js hook for GET /api/v1/session/pharmacies (same response shape as before). */
  async function listAuthorizedPharmacies({ principal } = {}) {
    if (!isVerifiedPrincipal(principal) || !isActive(principal) || principal.role === 'DISTRIBUTOR') {
      return { pharmacies: [], requiresWalletVerification: false };
    }
    const visible = await readRepository.listVisiblePharmacies(principal.userId);
    const accessType = principal.role === 'REGULATOR' ? 'REGULATORY' : 'PHARMACY';
    return {
      pharmacies: visible.pharmacies.map(row => ({
        pharmacyCode: row.pharmacy_code,
        accessTypes: [accessType],
        permissions: ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'],
      })),
      requiresWalletVerification: false,
    };
  }

  /** Session description for the UI: role, scope, accessible pharmacies and allowed actions. */
  async function describeSession(principal) {
    if (!isVerifiedPrincipal(principal)) throw new Error('Unverified principal.');
    const visible = isActive(principal) && principal.role !== 'DISTRIBUTOR'
      ? (await readRepository.listVisiblePharmacies(principal.userId)).pharmacies
      : [];
    return {
      role: principal.role,
      status: principal.status,
      pharmacy: principal.pharmacyCode ? { code: principal.pharmacyCode } : null,
      distributor: principal.distributorCode ? { code: principal.distributorCode } : null,
      accessiblePharmacies: visible.map(row => row.pharmacy_code),
      allowedActions: allowedActions(principal),
      walletVerification: 'NOT_REQUIRED_IN_THIS_PHASE',
    };
  }

  return Object.freeze({ authenticate, authorizePharmacy, listAuthorizedPharmacies, describeSession, isVerifiedPrincipal });
}

module.exports = { SQL, bearerToken, createSupabaseTokenVerifier, createLiveAuth };
