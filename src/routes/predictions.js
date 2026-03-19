// ============================================================
// PREDICTIONS ROUTE (src/routes/predictions.js)
// ============================================================
// POST /predict             → submit a prediction
// GET  /predict/user/:userId → get all predictions by a user
// GET  /predict/match/:matchId → all predictions for a match
// ============================================================

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// ── POST /predict ────────────────────────────────────────────
// Submit a prediction for a match
//
// Request body:
// {
//   "user_id": 1,
//   "match_id": 3,
//   "predicted_result": "home",      // 'home' | 'away' | 'draw'
//   "predicted_home_score": 2,       // optional — for bonus points
//   "predicted_away_score": 1        // optional — for bonus points
// }
router.post('/', async (req, res, next) => {
  try {
    const {
      user_id,
      match_id,
      predicted_result,
      predicted_home_score,
      predicted_away_score,
    } = req.body;

    // ── VALIDATION ────────────────────────────────────────────
    if (!user_id)         return res.status(400).json({ success: false, error: 'user_id is required' });
    if (!match_id)        return res.status(400).json({ success: false, error: 'match_id is required' });
    if (!predicted_result)return res.status(400).json({ success: false, error: 'predicted_result is required' });

    const validResults = ['home', 'away', 'draw'];
    if (!validResults.includes(predicted_result)) {
      return res.status(400).json({
        success: false,
        error: `predicted_result must be one of: ${validResults.join(', ')}`
      });
    }

    // ── CHECK USER EXISTS ─────────────────────────────────────
    const { rows: userRows } = await query(
      'SELECT id, username FROM users WHERE id = $1', [user_id]
    );
    if (!userRows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // ── CHECK MATCH EXISTS AND IS STILL UPCOMING ──────────────
    const { rows: matchRows } = await query(
      `SELECT id, status, kickoff_time,
              ht.name AS home_team, at.name AS away_team
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.id = $1`,
      [match_id]
    );

    if (!matchRows.length) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    const match = matchRows[0];

    // Can't predict a match that's already started or finished
    if (match.status !== 'upcoming') {
      return res.status(409).json({
        success: false,
        error: `Cannot predict — match is already "${match.status}"`,
      });
    }

    // Can't predict a match that kicks off in less than 1 minute
    const kickoff = new Date(match.kickoff_time);
    const now     = new Date();
    if (kickoff - now < 60000) {
      return res.status(409).json({
        success: false,
        error: 'Predictions are closed — match kicks off in less than 1 minute',
      });
    }

    // ── INSERT PREDICTION ─────────────────────────────────────
    // ON CONFLICT: if user already predicted this match, UPDATE it
    const { rows: predRows } = await query(`
      INSERT INTO predictions
        (user_id, match_id, predicted_result, predicted_home_score, predicted_away_score)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, match_id) DO UPDATE SET
        predicted_result      = EXCLUDED.predicted_result,
        predicted_home_score  = EXCLUDED.predicted_home_score,
        predicted_away_score  = EXCLUDED.predicted_away_score
      RETURNING *;
    `, [user_id, match_id, predicted_result, predicted_home_score ?? null, predicted_away_score ?? null]);

    // Update user's prediction count
    await query(`
      UPDATE users
      SET predictions_made = predictions_made + 1,
          updated_at        = NOW()
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1 FROM predictions
          WHERE user_id = $1 AND match_id = $2 AND id != $3
        );
    `, [user_id, match_id, predRows[0].id]);

    res.status(201).json({
      success: true,
      message: `Prediction submitted: ${match.home_team} vs ${match.away_team} → ${predicted_result.toUpperCase()}`,
      prediction: {
        id:                   predRows[0].id,
        user_id,
        match_id,
        predicted_result,
        predicted_home_score: predRows[0].predicted_home_score,
        predicted_away_score: predRows[0].predicted_away_score,
        match: {
          home_team:   match.home_team,
          away_team:   match.away_team,
          kickoff_time:match.kickoff_time,
        },
        submitted_at: predRows[0].created_at,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /predict/user/:userId ─────────────────────────────────
// All predictions made by a specific user
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { status } = req.query; // optionally filter by match status

    let conditions = ['p.user_id = $1'];
    let params     = [req.params.userId];

    if (status) {
      conditions.push(`m.status = $2`);
      params.push(status);
    }

    const { rows } = await query(`
      SELECT
        p.id,
        p.predicted_result,
        p.predicted_home_score,
        p.predicted_away_score,
        p.points_earned,
        p.is_correct,
        p.created_at,

        m.id           AS match_id,
        m.kickoff_time,
        m.status       AS match_status,
        m.home_score,
        m.away_score,
        m.result       AS actual_result,

        ht.name        AS home_team,
        at.name        AS away_team,
        l.name         AS league

      FROM predictions p
      JOIN matches m  ON m.id  = p.match_id
      JOIN teams   ht ON ht.id = m.home_team_id
      JOIN teams   at ON at.id = m.away_team_id
      JOIN leagues l  ON l.id  = m.league_id

      WHERE ${conditions.join(' AND ')}
      ORDER BY m.kickoff_time DESC
    `, params);

    const predictions = rows.map(r => ({
      id:             r.id,
      predicted:      r.predicted_result,
      predicted_score:r.predicted_home_score !== null
        ? `${r.predicted_home_score} - ${r.predicted_away_score}`
        : null,
      points_earned:  r.points_earned,
      is_correct:     r.is_correct,
      submitted_at:   r.created_at,
      match: {
        id:           r.match_id,
        home_team:    r.home_team,
        away_team:    r.away_team,
        league:       r.league,
        kickoff_time: r.kickoff_time,
        status:       r.match_status,
        actual_result:r.actual_result,
        score:        r.home_score !== null ? `${r.home_score} - ${r.away_score}` : null,
      },
    }));

    res.json({ success: true, count: predictions.length, predictions });

  } catch (err) {
    next(err);
  }
});

// ── GET /predict/match/:matchId ───────────────────────────────
// All predictions for a specific match (useful for live view)
router.get('/match/:matchId', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        p.predicted_result,
        COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
      FROM predictions p
      WHERE p.match_id = $1
      GROUP BY p.predicted_result
      ORDER BY count DESC
    `, [req.params.matchId]);

    res.json({ success: true, breakdown: rows });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
