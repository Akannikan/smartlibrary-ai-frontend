const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || null;

const pool = connectionString
  ? new Pool({ connectionString })
  : new Pool({
      connectionString: 'postgresql://postgres:postgres@localhost:5432/postgres',
      max: 5,
      idleTimeoutMillis: 30000,
    });

async function query(text, params = []) {
  return pool.query(text, params);
}

async function ensureSchema() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      message: 'DATABASE_URL is not configured. Database-backed endpoints will use empty data until Neon is connected.',
    };
  }

  try {
    const result = await query('SELECT 1');
    return { ok: true, message: 'Database connection available.', rowCount: result.rowCount };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

module.exports = { query, pool, ensureSchema };
