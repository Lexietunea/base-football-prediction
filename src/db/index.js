// ============================================================
// DATABASE CONNECTION (src/db/index.js)
// ============================================================
// Uses the 'pg' library to connect to PostgreSQL.
// Every route imports { query } from here to talk to the DB.
//
// Works with:
//   - Supabase (recommended, free)      → copy the URI from Settings → Database
//   - Local Postgres                    → postgresql://localhost:5432/basefootball
//   - Railway Postgres                  → given to you after provisioning
// ============================================================

const { Pool } = require('pg');

// Pool keeps connections open and reuses them — much faster than
// opening a new connection for every request
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  max:             10,   // max 10 simultaneous connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test the connection when server starts
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
    console.error('    Check your DATABASE_URL in .env');
  } else {
    console.log('✅  Database connected');
    release();
  }
});

// Convenience wrapper — use this in all routes:
// const { rows } = await query('SELECT * FROM matches WHERE id = $1', [id]);
const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };