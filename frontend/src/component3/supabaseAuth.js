const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getSupabasePublicConfig(environment = import.meta.env || {}) {
  const url = typeof environment.VITE_COMPONENT3_SUPABASE_URL === 'string'
    ? environment.VITE_COMPONENT3_SUPABASE_URL.trim().replace(/\/$/, '') : '';
  const anonKey = typeof environment.VITE_COMPONENT3_SUPABASE_ANON_KEY === 'string'
    ? environment.VITE_COMPONENT3_SUPABASE_ANON_KEY.trim() : '';
  if (!url || !anonKey) {
    throw new Error('Configure VITE_COMPONENT3_SUPABASE_URL and VITE_COMPONENT3_SUPABASE_ANON_KEY for Component 3 sign-in.');
  }
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('The Component 3 Supabase URL is invalid.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('Component 3 Supabase authentication requires HTTPS outside local development.');
  }
  return Object.freeze({ url, anonKey });
}

async function authRequest(path, { config, method = 'POST', body, accessToken, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Browser fetch is unavailable.');
  let response;
  try {
    response = await fetchImpl(`${config.url}/auth/v1/${path}`, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        apikey: config.anonKey,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Supabase Auth could not be reached. Check the configured project URL and network connection.');
  }
  if (!response || response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new Error('Supabase Auth redirected unexpectedly; sign-in was stopped.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('Supabase Auth returned an unreadable response.'); }
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new Error('Email or password is incorrect, or this session has expired.');
    throw new Error(`Supabase Auth is unavailable (HTTP ${response.status}).`);
  }
  return result;
}

function sessionFromResponse(result, previousUser = null, now = Date.now()) {
  const expiresIn = Number(result?.expires_in);
  const user = result?.user || previousUser;
  if (typeof result?.access_token !== 'string' || !result.access_token ||
      typeof result?.refresh_token !== 'string' || !result.refresh_token ||
      !Number.isFinite(expiresIn) || expiresIn <= 0 ||
      !user || typeof user.id !== 'string' || !USER_ID.test(user.id)) {
    throw new Error('Supabase Auth returned an invalid session. Sign in again.');
  }
  return Object.freeze({
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: now + expiresIn * 1000,
    user: Object.freeze({ id: user.id, email: typeof user.email === 'string' ? user.email : '' }),
  });
}

export async function signInWithSupabase({ email, password, config, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    throw new Error('Enter your email address and password.');
  }
  if (!config?.url || !config?.anonKey) throw new Error('Component 3 Supabase sign-in is not configured.');
  const result = await authRequest('token?grant_type=password', {
    config,
    body: { email: email.trim(), password },
    fetchImpl,
  });
  return sessionFromResponse(result, null, now);
}

export async function refreshSupabaseSession(session, { config, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!session?.refreshToken) throw new Error('Your session has expired. Sign in again.');
  if (Number.isFinite(session.expiresAt) && session.expiresAt > now + 60000) return session;
  const result = await authRequest('token?grant_type=refresh_token', {
    config,
    body: { refresh_token: session.refreshToken },
    fetchImpl,
  });
  return sessionFromResponse(result, session.user, now);
}

export async function revokeSupabaseSession(session, { config, fetchImpl = globalThis.fetch } = {}) {
  if (!session?.accessToken || !config?.url || !config?.anonKey) return;
  try {
    await authRequest('logout', { config, accessToken: session.accessToken, fetchImpl });
  } catch {
    // Local credentials are discarded by the caller regardless of remote logout availability.
  }
}
