'use strict';

const path = require('node:path');
const { createComponent3Server } = require('./server');
const { createAssessmentService } = require('./services/assessmentService');
const { createPostgresAssessmentRepository } = require('./services/postgresAssessmentRepository');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5005;

function parsePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error('COMPONENT3_PORT must be a decimal port from 1 through 65535.');
  return port;
}

function createPostgresServer({ pool, authenticate, authorizePharmacy, listAuthorizedPharmacies } = {}) {
  const repository = createPostgresAssessmentRepository({ pool });
  const assessmentService = createAssessmentService({ readPharmacyAssessment: repository.readPharmacyAssessment });
  return createComponent3Server({ assessmentService, authenticate, authorizePharmacy, listAuthorizedPharmacies });
}

function loadHostAuthorization(modulePath) {
  if (typeof modulePath !== 'string' || modulePath.trim() === '') {
    throw new Error('COMPONENT3_AUTH_MODULE must identify a trusted server-side authentication module.');
  }
  return require(path.resolve(__dirname, modulePath));
}

async function createPostgresRuntime({ env = process.env, PoolClass, authModule } = {}) {
  if (!env || typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.trim() === '') {
    throw new Error('DATABASE_URL is required; no database connection was opened.');
  }
  const port = parsePort(env.COMPONENT3_PORT);
  const moduleExports = authModule || loadHostAuthorization(env.COMPONENT3_AUTH_MODULE);
  if (typeof moduleExports.validateComponent3AuthConfig === 'function') {
    moduleExports.validateComponent3AuthConfig(env);
  }

  const Pool = PoolClass || require('pg').Pool;
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  try {
    let roleCheck;
    try {
      roleCheck = await pool.query(`
        SELECT r.rolsuper, r.rolbypassrls,
               pg_has_role(current_user, 'component3_runtime', 'USAGE') AS component3_runtime,
               pg_has_role(current_user, 'component3_provisioner', 'MEMBER') AS component3_provisioner,
               EXISTS (
                 SELECT 1 FROM pg_catalog.pg_class AS c
                 JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'pharmacy_trust'
                   AND c.relname LIKE 'component3_%'
                   AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
               ) AS owns_component3_table
        FROM pg_catalog.pg_roles AS r
        WHERE r.rolname = current_user`);
    } catch (error) {
      if (error?.code === '42704') {
        throw new Error('Component 3 authorization roles are not installed. Review and apply migrations/001_component3_authorization.sql before starting the live runtime.');
      }
      throw new Error('Component 3 could not verify the configured database role.');
    }
    const dbRole = roleCheck && Array.isArray(roleCheck.rows) ? roleCheck.rows[0] : null;
    if (!dbRole || dbRole.rolsuper !== false || dbRole.rolbypassrls !== false ||
        dbRole.component3_runtime !== true || dbRole.component3_provisioner !== false ||
        dbRole.owns_component3_table !== false) {
      throw new Error('DATABASE_URL must use a non-superuser, non-BYPASSRLS login with Component 3 runtime privileges.');
    }
    const auth = typeof moduleExports.createComponent3Auth === 'function'
      ? moduleExports.createComponent3Auth({ pool, env })
      : moduleExports;
    if (!auth || typeof auth.authenticate !== 'function' ||
        typeof auth.authorizePharmacy !== 'function') {
      throw new Error('The authentication module must export authenticate and authorizePharmacy, or createComponent3Auth.');
    }
    const server = createPostgresServer({
      pool,
      authenticate: auth.authenticate,
      authorizePharmacy: auth.authorizePharmacy,
      listAuthorizedPharmacies: auth.listAuthorizedPharmacies,
    });
    return { server, pool, host: HOST, port };
  } catch (error) {
    pool.end().catch(() => {});
    throw error;
  }
}

async function startPostgresRuntime(options = {}) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const runtime = await createPostgresRuntime(options);
  await new Promise((resolve, reject) => {
    const onError = error => reject(new Error(
      'Component 3 PostgreSQL server could not start (' + (error.code || 'listen error') + ').',
    ));
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
    console.log('Component 3 PostgreSQL read-only API listening at http://' + host + ':' + port);
    server.on('close', () => { pool.end().catch(() => {}); });
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { HOST, DEFAULT_PORT, parsePort, createPostgresServer, createPostgresRuntime, startPostgresRuntime };
