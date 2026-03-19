// ============================================================
// RESULTS ROUTE (src/routes/results.js)
// ============================================================
// POST /results             → update a match result + award points
// GET  /results             → list all completed matches
//
// This is the most important route — it's what runs after a
// match finishes. It:
//   1. Updates the match score and result
//   2. Checks every prediction against the real result
//   3. Awards points to correct predictors
//   4. Updates each user's total points and leaderboard score
// ============================================================

const express = require('express');
const router  = express.Router();
const { query, pool } = require('../db');

// ── POST /results ────────────────────────────────────────────
// Called when a match finishes (manually or via a webhook)
//
// Request body:
// {
//   "match_id": 1,
//   "home_score": 2,
//   "away_score": 1,
//   "admin_key": "your-secret-admin-key"  ← protects this endpoint
// }
router.post('/', async (req, res, next) => {
  const client = await pool.connect(); // use a transaction — all or nothing

  try {
    const { match_id, home_score, away_score, admin_key } = req.body;

    // ── ADMIN PROTECTION ─────────────────────────────────────
    // Only you can call this endpoint
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Forbidden — invalid admin key' });
    }

    // ── VALIDATION ────────────────────────────────────────────
    if (!match_id)              return res.status(400).json({ success: false, error: 'match_id is required' });
    if (home_score === undefined) return res.status(400).json({ success: false, error: 'home_score is required' });
    if (away_score === undefined) return res.status(400).json({ success: false, error: 'away_score is required' });
    if (isNaN(home_score) || isNaN(away_score)) {
      return res.status(400).json({ success: false, error: 'Scores must be numbers' });
    }

    // ── DETERMINE RESULT ──────────────────────────────────────
    let result;
    if (home_score > away_score)      result = 'home';
    else if (away_score > home_score) result = 'away';
    else                              result = 'draw';

    // ── BEGIN TRANSACTION ─────────────────────────────────────
    await client.query('BEGIN');

    // 1. Check the match exists and isn't already completed
    const { rows: matchRows } = await client.query(
      `SELECT m.*, ht.name AS home_team, at.name AS away_team
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.id = $1`,
      [match_id]
    );

    if (!matchRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    if (matchRows[0].status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Match is already marked as completed' });
    }

    const match = matchRows[0];

    // 2. Update the match record
    await client.query(`
      UPDATE matches SET
        home_score   = $1,
        away_score   = $2,
        result       = $3,
        status       = 'completed',
        updated_at   = NOW()
      WHERE id = $4
    `, [home_score, away_score, result, match_id]);

    // 3. Fetch all predictions for this match
    const { rows: predictions } = await client.query(
      `SELECT id, user_id, predicted_result, predicted_home_score, predicted_away_score
       FROM predictions WHERE match_id = $1`,
      [match_id]
    );

    // 4. Score each prediction
    let totalPointsAwarded = 0;
    let correctCount       = 0;

    for (const pred of predictions) {
      let points    = 0;
      let isCorrect = false;

      // +3 points for correct result (win/draw/loss)
      if (pred.predicted_result === result) {
        points   += 3;
        isCorrect = true;
        correctCount++;
      }

      // +5 BONUS points for exact score prediction
      if (
        pred.predicted_home_score === home_score &&
        pred.predicted_away_score === away_score
      ) {
        points += 5;
      }

      totalPointsAwarded += points;

      // Update the prediction record
      await client.query(`
        UPDATE predictions SET
          points_earned = $1,
          is_correct    = $2
        WHERE id = $3
      `, [points, isCorrect, pred.id]);

      // Update the user's total points and correct prediction count
      if (points > 0) {
        await client.query(`
          UPDATE users SET
            points                = points + $1,
            correct_predictions   = correct_predictions + $2,
            updated_at            = NOW()
          WHERE id = $3
        `, [points, isCorrect ? 1 : 0, pred.user_id]);
      }
    }

    // ── COMMIT TRANSACTION ────────────────────────────────────
    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Result recorded: ${match.home_team} ${home_score} – ${away_score} ${match.away_team}`,
      result: {
        match_id,
        home_team:  match.home_team,
        away_team:  match.away_team,
        score:      `${home_score} – ${away_score}`,
        result,
        predictions_resolved: predictions.length,
        correct_predictions:  correctCount,
        total_points_awarded: totalPointsAwarded,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ── GET /results ──────────────────────────────────────────────
// All completed matches with scores
router.get('/', async (req, res, next) => {
  try {
    const { league, limit = 10 } = req.query;

    let conditions = [`m.status = 'completed'`];
    let params     = [];
    let i          = 1;

    if (league) {
      conditions.push(`l.name ILIKE $${i++}`);
      params.push(`%${league}%`);
    }

    params.push(parseInt(limit));

    const { rows } = await query(`
      SELECT
        m.id,
        m.kickoff_time,
        m.home_score,
        m.away_score,
        m.result,
        ht.name  AS home_team,
        at.name  AS away_team,
        l.name   AS league,
        COUNT(p.id)                                             AS total_predictions,
        COUNT(CASE WHEN p.is_correct = true THEN 1 END)        AS correct_predictions
      FROM matches m
      JOIN teams   ht ON ht.id = m.home_team_id
      JOIN teams   at ON at.id = m.away_team_id
      JOIN leagues l  ON l.id  = m.league_id
      LEFT JOIN predictions p ON p.match_id = m.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY m.id, ht.id, at.id, l.id
      ORDER BY m.kickoff_time DESC
      LIMIT $${i}
    `, params);

    const results = rows.map(r => ({
      id:          r.id,
      kickoff:     r.kickoff_time,
      home_team:   r.home_team,
      away_team:   r.away_team,
      league:      r.league,
      score:       `${r.home_score} – ${r.away_score}`,
      result:      r.result,
      stats: {
        total_predictions:   parseInt(r.total_predictions) || 0,
        correct_predictions: parseInt(r.correct_predictions) || 0,
        accuracy_pct: r.total_predictions > 0
          ? Math.round((r.correct_predictions / r.total_predictions) * 100)
          : 0,
      },
    }));

    res.json({ success: true, count: results.length, results });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
