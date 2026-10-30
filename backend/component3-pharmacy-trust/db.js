
'use strict';

require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is missing. Configure it in the component3 .env file.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function testConnection() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        to_regnamespace('pharmacy_trust') IS NOT NULL
          AS pharmacy_trust_exists
    `);

    console.log('Supabase PostgreSQL connection successful.');
    console.log('Database:', result.rows[0].database_name);
    console.log(
      'pharmacy_trust schema exists:',
      result.rows[0].pharmacy_trust_exists
    );
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  testConnection();
}

module.exports = { pool };
