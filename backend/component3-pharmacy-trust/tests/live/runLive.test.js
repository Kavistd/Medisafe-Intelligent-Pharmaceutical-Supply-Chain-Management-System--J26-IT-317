'use strict';

// run-live.js configuration and startup behaviour with a fake Pool class (no database, no listening).
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLiveConfig, poolOptions, startupFailureMessage, createLiveRuntime } = require('../../run-live');

// Dummy values for tests only; nothing here is a real credential.
const DUMMY_SECRET = 'dummy-password-for-tests';
const ENV = {
  DATABASE_URL: `postgresql://postgres.dummyref:${DUMMY_SECRET}@pooler.example.test:6543/postgres?sslmode=require&sslrootcert=x`,
  SUPABASE_URL: 'https://dummyref.supabase.test',
  SUPABASE_ANON_KEY: 'dummy-anon-key',
};

function FakePool(behaviour) {
  return class {
    constructor(options) { FakePool.lastOptions = options; this.ended = false; }
    async query() { return behaviour(); }
    async connect() { return { query: async () => behaviour(), release() {} }; }
    async end() { this.ended = true; }
  };
}

test('missing settings are reported by name only', () => {
  const result = checkLiveConfig({ DATABASE_URL: ENV.DATABASE_URL });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  assert.ok(!JSON.stringify(result).includes(DUMMY_SECRET));
  assert.deepEqual(checkLiveConfig(ENV), { ok: true, missing: [], problems: [] });
  assert.ok(checkLiveConfig({ ...ENV, DATABASE_URL: 'mysql://x' }).problems.some(p => /postgres/.test(p)));
  assert.ok(checkLiveConfig({ ...ENV, SUPABASE_URL: 'http://dummyref.supabase.test' }).problems.some(p => /HTTPS/.test(p)));
});

test('TLS certificate verification stays ON and sslmode parameters cannot weaken it', () => {
  const options = poolOptions(ENV.DATABASE_URL);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.doesNotMatch(options.connectionString, /ssl/i);
});

test('a certificate failure names NODE_EXTRA_CA_CERTS and reveals no connection details', async () => {
  const certError = Object.assign(new Error(`self-signed certificate in certificate chain for pooler.example.test (${DUMMY_SECRET})`), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  let thrown;
  await assert.rejects(createLiveRuntime({ env: ENV, PoolClass: FakePool(() => { throw certError; }), tokenVerifier: async () => null }),
    error => { thrown = error; return true; });
  const message = startupFailureMessage(thrown);
  assert.match(message, /NODE_EXTRA_CA_CERTS/);
  assert.match(message, /SELF_SIGNED_CERT_IN_CHAIN/);
  assert.match(message, /verification stays ON/i);
  for (const secret of [DUMMY_SECRET, 'pooler.example.test', 'dummyref']) assert.ok(!message.includes(secret), secret);
  assert.deepEqual(FakePool.lastOptions.ssl, { rejectUnauthorized: true });
});

test('refuses to start when misconfigured or when schema c3 is missing', async () => {
  await assert.rejects(createLiveRuntime({ env: { DATABASE_URL: ENV.DATABASE_URL } }), error => {
    assert.equal(error.code, 'C3_CONFIG_INVALID');
    assert.match(error.message, /SUPABASE_URL, SUPABASE_ANON_KEY/);
    assert.ok(!error.message.includes(DUMMY_SECRET));
    return true;
  });
  await assert.rejects(createLiveRuntime({ env: ENV, PoolClass: FakePool(() => ({ rows: [{ ready: false }] })), tokenVerifier: async () => null }),
    error => error.code === 'C3_SCHEMA_MISSING' && /001_c3_live_schema/.test(startupFailureMessage(error)));
});

test('builds the runtime on port 5005 without listening', async () => {
  const runtime = await createLiveRuntime({ env: ENV, PoolClass: FakePool(() => ({ rows: [{ ready: true }] })), tokenVerifier: async () => null });
  assert.equal(runtime.host, '127.0.0.1');
  assert.equal(runtime.port, 5005);
  assert.equal(runtime.server.listening, false);
  assert.equal(typeof runtime.handler, 'function');
});
