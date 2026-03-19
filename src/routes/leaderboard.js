// ============================================================
// LEADERBOARD ROUTE (src/routes/leaderboard.js)
// ============================================================
// GET /leaderboard          → top users by points (global)
// GET /leaderboard?league=Premier League → top predictors for a league
// GET /leaderboard/weekly   → top predictors this week only
// ============================================================

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// ── GET /leaderboard ──────────────────────────────────────────
// Global leaderboard — top users ranked by total points
router.get('/', async (req, res, next) => {
  try {
    const { limit = 20, offset = 0, league } = req.query;

    // If filtering by league — only count points from that league's matches
    if (league) {
      const { rows } = await query(`
        SELECT
          u.id,
          u.username,
          u.wallet_address,
          u.predictions_made,
          u.correct_predictions,
          COALESCE(SUM(p.points_earned), 0)     AS points,
          COUNT(p.id)                            AS league_predictions,
          ROUND(
            COALESCE(SUM(p.points_earned), 0)::NUMERIC /
            NULLIF(COUNT(p.id), 0), 2
          )                                      AS avg_points_per_prediction

        FROM users u
        LEFT JOIN predictions p ON p.user_id = u.id
        LEFT JOIN matches     m ON m.id = p.match_id
        LEFT JOIN leagues     l ON l.id = m.league_id AND l.name ILIKE $1

        WHERE l.id IS NOT NULL OR p.id IS NULL
        GROUP BY u.id
        ORDER BY points DESC, league_predictions DESC
        LIMIT $2 OFFSET $3
      `, [`%${league}%`, parseInt(limit), parseInt(offset)]);

      return res.json({
        success: true,
        league,
        leaderboard: rows.map((u, idx) => formatUser(u, idx + parseInt(offset) + 1)),
      });
    }

    // Global leaderboard
    const { rows } = await query(`
      SELECT
        u.id,
        u.username,
        u.wallet_address,
        u.points,
        u.predictions_made,
        u.correct_predictions,
        ROUND(
          u.correct_predictions::NUMERIC /
          NULLIF(u.predictions_made, 0) * 100, 1
        ) AS accuracy_pct,
        ROUND(
          u.points::NUMERIC /
          NULLIF(u.predictions_made, 0), 2
        ) AS avg_points_per_prediction

      FROM users u
      ORDER BY u.points DESC, u.correct_predictions DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);

    res.json({
      success:     true,
      leaderboard: rows.map((u, idx) => formatUser(u, idx + parseInt(offset) + 1)),
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /leaderboard/weekly ───────────────────────────────────
// Points earned only in the last 7 days
router.get('/weekly', async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;

    const { rows } = await query(`
      SELECT
        u.id,
        u.username,
        u.wallet_address,
        COALESCE(SUM(p.points_earned), 0)  AS weekly_points,
        COUNT(p.id)                         AS weekly_predictions,
        COUNT(CASE WHEN p.is_correct THEN 1 END) AS weekly_correct

      FROM users u
      LEFT JOIN predictions p ON p.user_id = u.id
        AND p.created_at >= NOW() - INTERVAL '7 days'

      GROUP BY u.id
      HAVING COALESCE(SUM(p.points_earned), 0) > 0
      ORDER BY weekly_points DESC
      LIMIT $1
    `, [parseInt(limit)]);

    res.json({
      success:     true,
      period:      'Last 7 days',
      leaderboard: rows.map((u, idx) => ({
        rank:               idx + 1,
        username:           u.username,
        wallet_address:     u.wallet_address,
        weekly_points:      parseInt(u.weekly_points),
        weekly_predictions: parseInt(u.weekly_predictions),
        weekly_correct:     parseInt(u.weekly_correct),
      })),
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /leaderboard/user/:userId ─────────────────────────────
// Where does a specific user rank?
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT rank, id, username, points, predictions_made, correct_predictions
      FROM (
        SELECT
          RANK() OVER (ORDER BY points DESC) AS rank,
          id, username, points, predictions_made, correct_predictions
        FROM users
      ) ranked
      WHERE id = $1
    `, [req.params.userId]);

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const u = rows[0];
    res.json({
      success:  true,
      rank:     parseInt(u.rank),
      username: u.username,
      points:   u.points,
      predictions_made:    u.predictions_made,
      correct_predictions: u.correct_predictions,
      accuracy_pct: u.predictions_made > 0
        ? Math.round((u.correct_predictions / u.predictions_made) * 100)
        : 0,
    });

  } catch (err) {
    next(err);
  }
});

// ── HELPER ───────────────────────────────────────────────────
function formatUser(u, rank) {
  return {
    rank,
    id:                  u.id,
    username:            u.username,
    wallet_address:      u.wallet_address || null,
    points:              parseInt(u.points) || 0,
    predictions_made:    parseInt(u.predictions_made) || 0,
    correct_predictions: parseInt(u.correct_predictions) || 0,
    accuracy_pct:        parseFloat(u.accuracy_pct) || 0,
    avg_points:          parseFloat(u.avg_points_per_prediction) || 0,
  };
}

module.exports = router;
