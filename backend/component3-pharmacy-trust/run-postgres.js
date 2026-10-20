'use strict';

const path = require('node:path');
const { createComponent3Server } = require('./server');
const { createAssessmentService } = require('./services/assessmentService');
const { createPostgresAssessmentRepository } = require('./services/postgresAssessmentRepository');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5004;

function parsePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  return port;
}

function createPostgresServer({ pool, authenticate, authorizePharmacy } = {}) {
  const repository = createPostgresAssessmentRepository({ pool });
  const assessmentService = createAssessmentService({ readPharmacyAssessment: repository.readPharmacyAssessment });
  return createComponent3Server({ assessmentService, authenticate, authorizePharmacy });
}

function loadHostAuthorization(modulePath) {
  if (typeof modulePath !== 'string' || modulePath.trim() === '') {
    throw new Error('COMPONENT3_AUTH_MODULE must identify a trusted server-side authentication module.');
  }
  const auth = require(path.resolve(__dirname, modulePath));
  if (!auth || typeof auth.authenticate !== 'function' || typeof auth.authorizePharmacy !== 'function') {
    throw new Error('The configured authentication module must export authenticate and authorizePharmacy functions.');
  }
  return auth;
}

function createPostgresRuntime({ env = process.env, PoolClass, authModule } = {}) {
  if (!env || typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.trim() === '') {
    throw new Error('DATABASE_URL is required; no database connection was opened.');
  }
  const auth = authModule || loadHostAuthorization(env.COMPONENT3_AUTH_MODULE);
  if (typeof auth.authenticate !== 'function' || typeof auth.authorizePharmacy !== 'function') {
    throw new Error('Authentication and pharmacy authorization functions are required; server was not started.');
  }
  const port = parsePort(env.COMPONENT3_PORT);
  const Pool = PoolClass || require('pg').Pool;
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  const server = createPostgresServer({ pool, authenticate: auth.authenticate, authorizePharmacy: auth.authorizePharmacy });
  return { server, pool, host: HOST, port };
}

async function startPostgresRuntime(options = {}) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const runtime = createPostgresRuntime(options);
  await new Promise((resolve, reject) => {
    const onError = error => reject(new Error(`Component 3 PostgreSQL server could not start (${error.code || 'listen error'}).`));
    runtime.server.once('error', onError);
    runtime.server.listen(runtime.port, HOST, () => {
      runtime.server.removeListener('error', onError);
      resolve();
    });
  }).catch(async error => {
    await runtime.pool.end();
    throw error;
  });
  return runtime;
}

if (require.main === module) {
  startPostgresRuntime().then(({ server, pool, host, port }) => {
    console.log(`Component 3 PostgreSQL read-only API listening at http://${host}:${port}`);
    server.on('close', () => { pool.end().catch(() => {}); });
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { HOST, DEFAULT_PORT, parsePort, createPostgresServer, createPostgresRuntime, startPostgresRuntime };
