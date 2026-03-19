// ============================================================
// MATCHES ROUTE (src/routes/matches.js)
// ============================================================
// GET /matches              → all upcoming matches
// GET /matches?league=UCL   → filter by league
// GET /matches?status=completed → past results
// GET /matches/:id          → single match detail
// ============================================================

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// ── GET /matches ─────────────────────────────────────────────
// Returns upcoming fixtures, optionally filtered by league or status
router.get('/', async (req, res, next) => {
  try {
    const { league, status = 'upcoming', limit = 20, offset = 0 } = req.query;

    // Build the query dynamically based on filters
    let conditions = ['1=1'];
    let params     = [];
    let i          = 1;

    if (status) {
      conditions.push(`m.status = $${i++}`);
      params.push(status);
    }

    if (league) {
      conditions.push(`l.name ILIKE $${i++}`);
      params.push(`%${league}%`);
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const { rows } = await query(`
      SELECT
        m.id,
        m.kickoff_time,
        m.status,
        m.home_score,
        m.away_score,
        m.result,
        m.matchday,
        m.venue,

        -- Home team
        ht.id         AS home_team_id,
        ht.name       AS home_team,
        ht.short_name AS home_short,

        -- Away team
        at.id         AS away_team_id,
        at.name       AS away_team,
        at.short_name AS away_short,

        -- League
        l.id          AS league_id,
        l.name        AS league,
        l.country     AS league_country,

        -- How many predictions have been made for this match
        COUNT(p.id)   AS total_predictions

      FROM matches m
      JOIN teams  ht ON ht.id = m.home_team_id
      JOIN teams  at ON at.id = m.away_team_id
      JOIN leagues l ON l.id  = m.league_id
      LEFT JOIN predictions p ON p.match_id = m.id

      WHERE ${conditions.join(' AND ')}

      GROUP BY m.id, ht.id, at.id, l.id
      ORDER BY m.kickoff_time ASC
      LIMIT $${i++} OFFSET $${i++}
    `, params);

    // Format the response into clean objects
    const matches = rows.map(formatMatch);

    res.json({
      success: true,
      count:   matches.length,
      matches,
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /matches/:id ─────────────────────────────────────────
// Single match with full details
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await query(`
      SELECT
        m.*,
        ht.name       AS home_team,
        ht.short_name AS home_short,
        at.name       AS away_team,
        at.short_name AS away_short,
        l.name        AS league,
        l.country     AS league_country,

        -- Prediction breakdown for this match
        COUNT(p.id)                                        AS total_predictions,
        COUNT(CASE WHEN p.predicted_result = 'home' THEN 1 END) AS home_predictions,
        COUNT(CASE WHEN p.predicted_result = 'draw' THEN 1 END) AS draw_predictions,
        COUNT(CASE WHEN p.predicted_result = 'away' THEN 1 END) AS away_predictions

      FROM matches m
      JOIN teams   ht ON ht.id = m.home_team_id
      JOIN teams   at ON at.id = m.away_team_id
      JOIN leagues l  ON l.id  = m.league_id
      LEFT JOIN predictions p ON p.match_id = m.id

      WHERE m.id = $1
      GROUP BY m.id, ht.id, at.id, l.id
    `, [id]);

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    const match = formatMatch(rows[0]);

    // Add percentage breakdowns
    const total = parseInt(match.total_predictions) || 1;
    match.prediction_breakdown = {
      home_pct: Math.round((rows[0].home_predictions / total) * 100),
      draw_pct: Math.round((rows[0].draw_predictions / total) * 100),
      away_pct: Math.round((rows[0].away_predictions / total) * 100),
    };

    res.json({ success: true, match });

  } catch (err) {
    next(err);
  }
});

// ── HELPER: format a DB row into a clean response object ─────
function formatMatch(row) {
  return {
    id:           row.id,
    kickoff_time: row.kickoff_time,
    status:       row.status,
    matchday:     row.matchday,
    venue:        row.venue,
    home_team: {
      id:    row.home_team_id,
      name:  row.home_team,
      short: row.home_short,
    },
    away_team: {
      id:    row.away_team_id,
      name:  row.away_team,
      short: row.away_short,
    },
    league: {
      id:      row.league_id,
      name:    row.league,
      country: row.league_country,
    },
    score: {
      home:   row.home_score,
      away:   row.away_score,
      result: row.result,         // 'home' | 'away' | 'draw' | null
    },
    total_predictions: parseInt(row.total_predictions) || 0,
  };
}

module.exports = router;
