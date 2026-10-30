'use strict';

/**
 * Component 3 LIVE runtime (docs/component3/LIVE_API.md).
 *   PowerShell: $env:NODE_EXTRA_CA_CERTS='C:\certs\supabase-ca.crt'; node run-live.js
 * Requires DATABASE_URL, SUPABASE_URL and SUPABASE_ANON_KEY (from .env next to this file).
 * TLS certificate verification is always ON; Supabase's CA is trusted via NODE_EXTRA_CA_CERTS.
 * Listens on 127.0.0.1:5005 by default (COMPONENT3_PORT), the target of the Vite /c3-api proxy.
 * Do not run run-postgres.js at the same time: both use port 5005 by default.
 */
const path = require('node:path');
const { HOST, parsePort } = require('./run-postgres');
const { validateComponent3AuthConfig } = require('./services/component3Auth');
const { createLiveRepository } = require('./services/live/liveRepository');
const { createLiveWriteRepository } = require('./services/live/liveWriteRepository');
const { createLiveWorkspaceRepository } = require('./services/live/liveWorkspaceRepository');
const { createLiveAuth } = require('./services/live/liveAuth');
const { createLiveProcessService } = require('./services/live/liveProcessService');
const { createLiveServer } = require('./services/live/liveServer');

const REQUIRED_ENV = Object.freeze(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']);
const CERTIFICATE_ERRORS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_UNTRUSTED', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Names-only configuration check; never returns or prints values. */
function checkLiveConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter(name => typeof env[name] !== 'string' || env[name].trim() === '');
  const problems = [];
  if (!missing.includes('DATABASE_URL')) {
    let protocol = null;
    try { protocol = new URL(env.DATABASE_URL).protocol; } catch { /* reported below */ }
    if (!['postgres:', 'postgresql:'].includes(protocol)) problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }
  if (!missing.includes('SUPABASE_URL') && !missing.includes('SUPABASE_ANON_KEY')) {
    try { validateComponent3AuthConfig(env); } catch (error) { problems.push(error.message); }
  }
  try { parsePort(env.COMPONENT3_PORT); } catch (error) { problems.push(error.message); }
  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}

/** pg Pool options with certificate verification ON; sslmode-style URL parameters cannot weaken it. */
function poolOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  for (const key of [...url.searchParams.keys()]) if (/^ssl/i.test(key)) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  };
}

/** Safe startup message: error codes only, never connection details. */
function startupFailureMessage(error) {
  const code = error && error.code ? String(error.code) : 'UNKNOWN';
  if (CERTIFICATE_ERRORS.has(code)) {
    return `Component 3 live runtime could not verify the database TLS certificate (${code}). `
      + 'Certificate verification stays ON. Trust Supabase\'s CA by setting NODE_EXTRA_CA_CERTS to the CA file path '
      + 'before starting, e.g. in PowerShell: $env:NODE_EXTRA_CA_CERTS=\'C:\\certs\\supabase-ca.crt\'; node run-live.js';
  }
  if (code === 'C3_SCHEMA_MISSING') return 'Component 3 live runtime: schema c3 or policy v1 is missing. Apply migrations/live/001_c3_live_schema.sql first.';
  return `Component 3 live runtime could not start (${code}).`;
}

/** Builds the runtime (pool, repositories, auth, server) after a read-only database check. Does not listen. */
async function createLiveRuntime({ env = process.env, PoolClass, tokenVerifier, fetchImpl, clock } = {}) {
  const config = checkLiveConfig(env);
  if (!config.ok) {
    const error = new Error([
      config.missing.length ? `Missing required settings: ${config.missing.join(', ')}.` : '',
      ...config.problems,
    ].filter(Boolean).join(' '));
    error.code = 'C3_CONFIG_INVALID';
    throw error;
  }
  const Pool = PoolClass || require('pg').Pool;
  const pool = new Pool(poolOptions(env.DATABASE_URL));
  try {
    const check = await pool.query("SELECT to_regclass('c3.policy') IS NOT NULL AS ready");
    if (!check || !check.rows || check.rows[0]?.ready !== true) {
      const error = new Error('c3 schema missing');
      error.code = 'C3_SCHEMA_MISSING';
      throw error;
    }
    const readRepository = createLiveRepository({ pool });
    const auth = createLiveAuth({ pool, readRepository, tokenVerifier, env, fetchImpl });
    const processService = createLiveProcessService({
      writeRepository: createLiveWriteRepository({ pool }), readRepository, ...(clock ? { clock } : {}),
    });
    const { server, handler } = createLiveServer({
      auth, processService, workspaceRepository: createLiveWorkspaceRepository({ pool }), ...(clock ? { clock } : {}),
    });
    return { pool, server, handler, host: HOST, port: parsePort(env.COMPONENT3_PORT) };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

async function startLiveRuntime(options = {}) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const runtime = await createLiveRuntime(options);
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(runtime.port, runtime.host, () => { runtime.server.removeListener('error', reject); resolve(); });
  }).catch(async error => { await runtime.pool.end().catch(() => {}); throw error; });
  return runtime;
}

if (require.main === module) {
  startLiveRuntime().then(({ server, pool, host, port }) => {
    console.log(`Component 3 LIVE API listening at http://${host}:${port} (TLS verification on; decision support only).`);
    server.on('close', () => { pool.end().catch(() => {}); });
  }).catch(error => {
    console.error(error.code === 'C3_CONFIG_INVALID' ? error.message : startupFailureMessage(error));
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_ENV, checkLiveConfig, poolOptions, startupFailureMessage, createLiveRuntime, startLiveRuntime };
