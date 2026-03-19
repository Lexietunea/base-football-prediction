require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// DATABASE MIGRATION (src/db/migrate.js)
// ============================================================
// Run once to create all your tables:
//   npm run migrate
//
// Safe to re-run — uses CREATE TABLE IF NOT EXISTS
// ============================================================



async function migrate() {
  console.log('🔄  Running database migration...\n');

  try {
    await pool.query(`

      -- ── USERS ───────────────────────────────────────────
      -- Every fan who makes predictions
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        username       VARCHAR(50) UNIQUE NOT NULL,
        wallet_address VARCHAR(42) UNIQUE,               -- optional, for Web3 rewards
        email          VARCHAR(255) UNIQUE,
        points         INTEGER NOT NULL DEFAULT 0,        -- total prediction points
        predictions_made INTEGER NOT NULL DEFAULT 0,
        correct_predictions INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── LEAGUES ─────────────────────────────────────────
      -- Premier League, La Liga, UCL, etc.
      CREATE TABLE IF NOT EXISTS leagues (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) UNIQUE NOT NULL,          -- e.g. "Champions League"
        country    VARCHAR(100),                          -- e.g. "Europe"
        logo_url   TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── TEAMS ───────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS teams (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) UNIQUE NOT NULL,
        short_name VARCHAR(10),                           -- e.g. "RMA", "LFC"
        league_id  INTEGER REFERENCES leagues(id),
        logo_url   TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── MATCHES ─────────────────────────────────────────
      -- Every upcoming and completed fixture
      CREATE TABLE IF NOT EXISTS matches (
        id             SERIAL PRIMARY KEY,
        home_team_id   INTEGER NOT NULL REFERENCES teams(id),
        away_team_id   INTEGER NOT NULL REFERENCES teams(id),
        league_id      INTEGER NOT NULL REFERENCES leagues(id),
        kickoff_time   TIMESTAMPTZ NOT NULL,              -- when the match starts
        status         VARCHAR(20) NOT NULL DEFAULT 'upcoming',
                       -- 'upcoming' | 'live' | 'completed' | 'postponed'
        home_score     INTEGER,                           -- null until completed
        away_score     INTEGER,                           -- null until completed
        result         VARCHAR(10),                       -- 'home' | 'away' | 'draw'
        matchday       INTEGER,                           -- e.g. Matchday 28
        venue          VARCHAR(150),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT different_teams CHECK (home_team_id != away_team_id)
      );

      -- ── PREDICTIONS ─────────────────────────────────────
      -- A user's prediction for a specific match
      CREATE TABLE IF NOT EXISTS predictions (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        predicted_result VARCHAR(10) NOT NULL,            -- 'home' | 'away' | 'draw'
        predicted_home_score INTEGER,                     -- optional exact score
        predicted_away_score INTEGER,                     -- optional exact score
        points_earned   INTEGER NOT NULL DEFAULT 0,       -- filled in after match
        is_correct      BOOLEAN,                          -- filled in after match
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- A user can only predict each match once
        UNIQUE(user_id, match_id)
      );

      -- ── POINT RULES ─────────────────────────────────────
      -- Configurable scoring system
      CREATE TABLE IF NOT EXISTS point_rules (
        id          SERIAL PRIMARY KEY,
        rule_name   VARCHAR(50) UNIQUE NOT NULL,
        points      INTEGER NOT NULL,
        description TEXT
      );

      -- ── INDEXES (make queries fast) ──────────────────────
      CREATE INDEX IF NOT EXISTS idx_matches_status       ON matches(status);
      CREATE INDEX IF NOT EXISTS idx_matches_kickoff      ON matches(kickoff_time);
      CREATE INDEX IF NOT EXISTS idx_matches_league       ON matches(league_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_user     ON predictions(user_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_match    ON predictions(match_id);
      CREATE INDEX IF NOT EXISTS idx_users_points         ON users(points DESC);
      CREATE INDEX IF NOT EXISTS idx_users_wallet         ON users(wallet_address);

    `);

    console.log('✅  Tables created: users, leagues, teams, matches, predictions, point_rules');

    // Insert default point rules
    await pool.query(`
      INSERT INTO point_rules (rule_name, points, description) VALUES
        ('correct_result',      3,  'Correctly predict win/draw/loss'),
        ('correct_exact_score', 5,  'Correctly predict the exact final score'),
        ('correct_scorer',      2,  'Correctly predict the first goalscorer')
      ON CONFLICT (rule_name) DO NOTHING;
    `);

    console.log('✅  Default point rules inserted');
    console.log('\n🎉  Migration complete! Now run: npm run seed\n');

  } catch (err) {
    console.error('❌  Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();