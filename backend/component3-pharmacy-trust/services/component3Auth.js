'use strict';

const MEMBERSHIP_SQL = `
  SELECT p.id AS pharmacy_id, om.member_role,
         om.status AS membership_status, o.status AS organization_status
  FROM pharmacy_trust.pharmacies AS p
  LEFT JOIN public.organizations AS o ON o.id = p.organization_id
  LEFT JOIN public.organization_members AS om
    ON om.organization_id = o.id AND om.profile_id = $2
  WHERE p.pharmacy_code = $1
  LIMIT 1`;
const WALLET_ASSIGNMENT_SQL = `
  SELECT wallet_address
  FROM pharmacy_trust.component3_pharmacy_wallet_assignments
  WHERE pharmacy_id = $1 AND approval_status = 'APPROVED'
    AND approved_at IS NOT NULL AND proof_reference IS NOT NULL
    AND effective_at <= now() AND (expires_at IS NULL OR expires_at > now())
    AND revoked_at IS NULL
  ORDER BY approved_at DESC
  LIMIT 2`;
const REGULATORY_GRANT_SQL = `
  SELECT 1
  FROM pharmacy_trust.component3_regulatory_access_grants AS g
  JOIN pharmacy_trust.component3_regulatory_organizations AS ro
    ON ro.organization_id = g.organization_id
  JOIN public.organization_members AS om
    ON om.organization_id = g.organization_id AND om.profile_id = g.grantee_profile_id
  JOIN pharmacy_trust.component3_regulatory_designations AS rd
    ON rd.organization_id = om.organization_id AND rd.profile_id = om.profile_id
  JOIN public.organizations AS o ON o.id = om.organization_id
  JOIN public.profiles AS pr ON pr.id = om.profile_id
  JOIN pharmacy_trust.pharmacies AS p ON p.id = g.pharmacy_id
  WHERE p.pharmacy_code = $1 AND pr.id = $2 AND g.permission = $3
    AND g.grant_status = 'ACTIVE' AND g.effective_at <= now()
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND g.revoked_at IS NULL AND g.approver_profile_id IS NOT NULL
    AND g.approved_at IS NOT NULL
    AND rd.verification_status = 'VERIFIED' AND rd.verified_at IS NOT NULL
    AND ro.approval_status = 'APPROVED' AND ro.approved_at IS NOT NULL
    AND ro.revoked_at IS NULL AND o.status = 'ACTIVE' AND om.status = 'ACTIVE'
  LIMIT 1`;
const PHARMACY_ACCESS_LIST_SQL = `
  SELECT p.id AS pharmacy_id, p.pharmacy_code, om.member_role
  FROM pharmacy_trust.pharmacies AS p
  JOIN public.organizations AS o ON o.id = p.organization_id
  JOIN public.organization_members AS om ON om.organization_id = o.id
  WHERE om.profile_id = $1 AND om.status = 'ACTIVE' AND o.status = 'ACTIVE'
    AND om.member_role = ANY($2::text[])
  ORDER BY p.pharmacy_code`;
const REGULATORY_ACCESS_LIST_SQL = `
  SELECT p.pharmacy_code, g.permission
  FROM pharmacy_trust.component3_regulatory_access_grants AS g
  JOIN pharmacy_trust.component3_regulatory_organizations AS ro
    ON ro.organization_id = g.organization_id
  JOIN public.organization_members AS om
    ON om.organization_id = g.organization_id AND om.profile_id = g.grantee_profile_id
  JOIN pharmacy_trust.component3_regulatory_designations AS rd
    ON rd.organization_id = om.organization_id AND rd.profile_id = om.profile_id
  JOIN public.organizations AS o ON o.id = om.organization_id
  JOIN public.profiles AS pr ON pr.id = om.profile_id
  JOIN pharmacy_trust.pharmacies AS p ON p.id = g.pharmacy_id
  WHERE pr.id = $1 AND g.permission = ANY($2::text[])
    AND g.grant_status = 'ACTIVE' AND g.effective_at <= now()
    AND (g.expires_at IS NULL OR g.expires_at > now()) AND g.revoked_at IS NULL
    AND g.approver_profile_id IS NOT NULL AND g.approved_at IS NOT NULL
    AND rd.verification_status = 'VERIFIED' AND rd.verified_at IS NOT NULL
    AND ro.approval_status = 'APPROVED' AND ro.approved_at IS NOT NULL AND ro.revoked_at IS NULL
    AND o.status = 'ACTIVE' AND om.status = 'ACTIVE'
  ORDER BY p.pharmacy_code, g.permission`;

const PERMISSIONS = Object.freeze({
  assessment: 'ASSESSMENT_READ',
  evidence: 'EVIDENCE_READ',
  'critical-findings': 'CRITICAL_FINDINGS_READ',
});
const PHARMACY_ROLE_PERMISSIONS = Object.freeze({
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set(Object.values(PERMISSIONS)),
  PHARMACIST: new Set(['ASSESSMENT_READ', 'EVIDENCE_READ']),
});

function validateComponent3AuthConfig(env = process.env) {
  if (!env || typeof env.SUPABASE_URL !== 'string' ||
      typeof env.SUPABASE_ANON_KEY !== 'string' || !env.SUPABASE_ANON_KEY.trim()) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for Component 3 authentication.');
  }
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('SUPABASE_URL must use HTTPS outside loopback testing.');
  }
}

function permissionForRequest(request) {
  try {
    const route = /^\/api\/v1\/pharmacies\/[^/]+\/trust-assessment(?:\/(evidence|critical-findings))?$/
      .exec(new URL(request.url, 'http://localhost').pathname);
    return route ? PERMISSIONS[route[1] || 'assessment'] : null;
  } catch { return null; }
}

function createComponent4WalletVerifier() {
  // Adapt Component 4's trusted Express middleware without changing that component.
  const component4Auth = require('../../component4-prescription/middleware/auth');
  function invoke(handler, request) {
    return new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { resolve({ status: this.statusCode, auth: request.auth || null }); return this; },
      };
      const next = error => error
        ? reject(error)
        : resolve({ status: 200, auth: request.auth || null });
      try {
        const result = handler(request, response, next);
        if (result && typeof result.then === 'function') result.catch(reject);
      } catch (error) { reject(error); }
    });
  }
  return Object.freeze({
    async verifyPharmacyWallet(token) {
      const request = { headers: { authorization: 'Bearer ' + token } };
      const authenticated = await invoke(component4Auth.authenticate, request);
      if (authenticated.status === 503) throw new Error('Component 4 wallet verification is unavailable.');
      if (authenticated.status !== 200 || !authenticated.auth) return null;
      const authorized = await invoke(component4Auth.authorize('pharmacy'), request);
      if (authorized.status === 503) throw new Error('Component 4 chain role verification is unavailable.');
      return authorized.status === 200 ? authorized.auth.address : null;
    },
  });
}

function createComponent3Auth({ pool, env = process.env, fetchImpl = globalThis.fetch, walletVerifier } = {}) {
  validateComponent3AuthConfig(env);
  if (!pool || typeof pool.query !== 'function') throw new Error('A PostgreSQL query pool is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A server-side fetch implementation is required.');

  const userEndpoint = new URL('/auth/v1/user', env.SUPABASE_URL).toString();
  const wallet = walletVerifier || createComponent4WalletVerifier();
  const verifiedPrincipals = new WeakSet();

  async function authenticate(request) {
    const header = request && request.headers && request.headers.authorization;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header);
    if (!match || match[1].split('.').length !== 3) return null;

    let response;
    try {
      response = await fetchImpl(userEndpoint, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          authorization: 'Bearer ' + match[1],
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error('Supabase Auth verification service is unavailable.');
    }
    if (response && (response.status >= 300 && response.status < 400 || response.type === 'opaqueredirect')) {
      throw new Error('Supabase Auth verification endpoint redirected unexpectedly.');
    }
    if ([400, 401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error('Supabase Auth verification service returned an error.');

    let user;
    try { user = await response.json(); } catch {
      throw new Error('Supabase Auth returned an invalid response.');
    }
    if (!user || typeof user.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
      return null;
    }
    const principal = Object.freeze({ userId: user.id });
    verifiedPrincipals.add(principal);
    return principal;
  }

  async function authorizePharmacy({ principal, pharmacyId, request } = {}) {
    if (!principal || !verifiedPrincipals.has(principal) ||
        typeof pharmacyId !== 'string' || !pharmacyId) return false;
    const permission = permissionForRequest(request || {});
    if (!permission) return false;

    const membershipResult = await pool.query(MEMBERSHIP_SQL, [pharmacyId, principal.userId]);
    if (!membershipResult || !Array.isArray(membershipResult.rows)) {
      throw new Error('Membership query returned invalid data.');
    }
    const membership = membershipResult.rows[0];
    if (!membership) return false;
    const activePharmacyMembership = membership.membership_status === 'ACTIVE' &&
      membership.organization_status === 'ACTIVE';

    const rolePermissions = PHARMACY_ROLE_PERMISSIONS[membership.member_role];
    if (activePharmacyMembership && rolePermissions && rolePermissions.has(permission)) {
      const walletToken = request.headers['x-component4-wallet-token'];
      if (typeof walletToken !== 'string' || !/^[A-Za-z0-9._-]{1,4096}$/.test(walletToken)) return false;
      const walletAddress = await wallet.verifyPharmacyWallet(walletToken);
      if (typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return false;

      const assignmentResult = await pool.query(WALLET_ASSIGNMENT_SQL, [membership.pharmacy_id]);
      if (!assignmentResult || !Array.isArray(assignmentResult.rows)) {
        throw new Error('Wallet assignment query returned invalid data.');
      }
      return assignmentResult.rows.length === 1 &&
        typeof assignmentResult.rows[0].wallet_address === 'string' &&
        assignmentResult.rows[0].wallet_address.toLowerCase() === walletAddress.toLowerCase();
    }

    const grantResult = await pool.query(REGULATORY_GRANT_SQL, [pharmacyId, principal.userId, permission]);
    if (!grantResult || !Array.isArray(grantResult.rows)) {
      throw new Error('Regulatory grant query returned invalid data.');
    }
    return grantResult.rows.length > 0;
  }

  async function listAuthorizedPharmacies({ principal, request } = {}) {
    if (!principal || !verifiedPrincipals.has(principal)) return { pharmacies: [], requiresWalletVerification: false };
    const resultByCode = new Map();
    const addPermission = (pharmacyCode, accessType, permission) => {
      let item = resultByCode.get(pharmacyCode);
      if (!item) {
        item = { pharmacyCode, accessTypes: [], permissions: [] };
        resultByCode.set(pharmacyCode, item);
      }
      if (!item.accessTypes.includes(accessType)) item.accessTypes.push(accessType);
      if (!item.permissions.includes(permission)) item.permissions.push(permission);
    };

    const pharmacyResult = await pool.query(PHARMACY_ACCESS_LIST_SQL, [
      principal.userId,
      Object.keys(PHARMACY_ROLE_PERMISSIONS),
    ]);
    if (!pharmacyResult || !Array.isArray(pharmacyResult.rows)) {
      throw new Error('Pharmacy access-list query returned invalid data.');
    }
    const candidates = pharmacyResult.rows;
    const walletToken = request?.headers?.['x-component4-wallet-token'];
    let requiresWalletVerification = candidates.length > 0;
    if (candidates.length > 0 && typeof walletToken === 'string' && /^[A-Za-z0-9._-]{1,4096}$/.test(walletToken)) {
      const walletAddress = await wallet.verifyPharmacyWallet(walletToken);
      if (typeof walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
        for (const candidate of candidates) {
          const assignmentResult = await pool.query(WALLET_ASSIGNMENT_SQL, [candidate.pharmacy_id]);
          if (!assignmentResult || !Array.isArray(assignmentResult.rows)) {
            throw new Error('Wallet assignment query returned invalid data.');
          }
          const assignments = assignmentResult.rows;
          if (assignments.length !== 1 || assignments[0].wallet_address?.toLowerCase() !== walletAddress.toLowerCase()) continue;
          const permissions = PHARMACY_ROLE_PERMISSIONS[candidate.member_role];
          for (const permission of permissions || []) addPermission(candidate.pharmacy_code, 'PHARMACY', permission);
        }
        requiresWalletVerification = false;
      }
    }

    const regulatoryResult = await pool.query(REGULATORY_ACCESS_LIST_SQL, [
      principal.userId,
      Object.values(PERMISSIONS),
    ]);
    if (!regulatoryResult || !Array.isArray(regulatoryResult.rows)) {
      throw new Error('Regulatory access-list query returned invalid data.');
    }
    for (const row of regulatoryResult.rows) {
      if (Object.values(PERMISSIONS).includes(row.permission)) addPermission(row.pharmacy_code, 'REGULATORY', row.permission);
    }

    return {
      pharmacies: [...resultByCode.values()].sort((left, right) => left.pharmacyCode.localeCompare(right.pharmacyCode)),
      requiresWalletVerification,
    };
  }

  return Object.freeze({ authenticate, authorizePharmacy, listAuthorizedPharmacies });
}

module.exports = {
  createComponent3Auth,
  validateComponent3AuthConfig,
  permissionForRequest,
  MEMBERSHIP_SQL,
  WALLET_ASSIGNMENT_SQL,
  REGULATORY_GRANT_SQL,
  PHARMACY_ACCESS_LIST_SQL,
  REGULATORY_ACCESS_LIST_SQL,
};

