import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupabasePublicConfig, refreshSupabaseSession, signInWithSupabase } from './supabaseAuth.js';

const config = { url: 'https://project.example.test', anonKey: 'public-anon-key' };
const user = { id: '123e4567-e89b-42d3-a456-426614174000', email: 'pharmacy@example.test' };
const sessionResponse = (overrides = {}) => ({
  access_token: 'supabase-access-token',
  refresh_token: 'supabase-refresh-token',
  expires_in: 3600,
  user,
  ...overrides,
});

test('public Supabase configuration is explicit and requires HTTPS outside loopback', () => {
  assert.throws(() => getSupabasePublicConfig({}), /VITE_COMPONENT3_SUPABASE_URL/);
  assert.throws(() => getSupabasePublicConfig({
    VITE_COMPONENT3_SUPABASE_URL: 'http://project.example.test',
    VITE_COMPONENT3_SUPABASE_ANON_KEY: 'public-key',
  }), /requires HTTPS/);
  assert.equal(getSupabasePublicConfig({
    VITE_COMPONENT3_SUPABASE_URL: 'http://127.0.0.1:54321/',
    VITE_COMPONENT3_SUPABASE_ANON_KEY: 'local-public-key',
  }).url, 'http://127.0.0.1:54321');
});

test('password sign-in calls Supabase Auth and keeps only a validated in-memory session shape', async () => {
  let request;
  const session = await signInWithSupabase({
    email: ' pharmacy@example.test ', password: 'not-logged', config, now: 1000,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, redirected: false, json: async () => sessionResponse() };
    },
  });
  assert.equal(request.url, `${config.url}/auth/v1/token?grant_type=password`);
  assert.equal(request.options.headers.apikey, config.anonKey);
  assert.equal(request.options.headers.credentials, undefined);
  assert.equal(request.options.credentials, 'omit');
  assert.deepEqual(JSON.parse(request.options.body), { email: 'pharmacy@example.test', password: 'not-logged' });
  assert.deepEqual(session, {
    accessToken: 'supabase-access-token', refreshToken: 'supabase-refresh-token',
    expiresAt: 3601000, user,
  });
  assert.equal(Object.isFrozen(session), true);
});

test('bad credentials and malformed auth responses fail without returning tokens', async () => {
  await assert.rejects(signInWithSupabase({
    email: 'user@example.test', password: 'wrong', config,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'private provider detail' }) }),
  }), /Email or password is incorrect/);
  await assert.rejects(signInWithSupabase({
    email: 'user@example.test', password: 'password', config,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => sessionResponse({ user: { id: 'not-a-uuid' } }) }),
  }), /invalid session/);
});

test('expired Supabase sessions refresh, and refresh failures require sign-in again', async () => {
  const prior = { accessToken: 'old', refreshToken: 'refresh', expiresAt: 1000, user };
  let url;
  const refreshed = await refreshSupabaseSession(prior, {
    config, now: 5000,
    fetchImpl: async (requestedUrl, options) => {
      url = requestedUrl;
      assert.equal(JSON.parse(options.body).refresh_token, 'refresh');
      return { ok: true, status: 200, json: async () => sessionResponse({ expires_in: 120 }) };
    },
  });
  assert.equal(url, `${config.url}/auth/v1/token?grant_type=refresh_token`);
  assert.equal(refreshed.expiresAt, 125000);
  const stillFresh = await refreshSupabaseSession(refreshed, { config, now: 10000, fetchImpl: () => { throw new Error('should not fetch'); } });
  assert.equal(stillFresh, refreshed);
  await assert.rejects(refreshSupabaseSession(prior, {
    config, now: 5000,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  }), /expired/);
});
