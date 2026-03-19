// ============================================================
// USERS ROUTE (src/routes/users.js)
// ============================================================
// POST /users/register          → create a new fan account
// POST /users/connect-wallet    → link a wallet to an account
// GET  /users/:id               → get a user's profile + stats
// ============================================================

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// ── POST /users/register ──────────────────────────────────────
// Create a new fan account
// Wallet is optional now — they can connect it later for rewards
//
// Body: { "username": "0xVictor_J", "wallet_address": "0x..." }
router.post('/register', async (req, res, next) => {
  try {
    const { username, wallet_address } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters',
      });
    }

    // Check username not already taken
    const { rows: existing } = await query(
      'SELECT id FROM users WHERE username = $1', [username.trim()]
    );
    if (existing.length) {
      return res.status(409).json({ success: false, error: 'Username already taken' });
    }

    // Check wallet not already used (if provided)
    if (wallet_address) {
      const { rows: walletExists } = await query(
        'SELECT id FROM users WHERE wallet_address = $1', [wallet_address.toLowerCase()]
      );
      if (walletExists.length) {
        return res.status(409).json({ success: false, error: 'Wallet address already registered' });
      }
    }

    const { rows } = await query(`
      INSERT INTO users (username, wallet_address)
      VALUES ($1, $2)
      RETURNING id, username, wallet_address, points, predictions_made, correct_predictions, created_at
    `, [username.trim(), wallet_address ? wallet_address.toLowerCase() : null]);

    res.status(201).json({
      success: true,
      message: `Welcome to Base Football, ${rows[0].username}!`,
      user:    rows[0],
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /users/connect-wallet ────────────────────────────────
// Link an existing account to a crypto wallet
// Once connected, users can earn on-chain rewards for predictions
//
// Body: { "user_id": 1, "wallet_address": "0x4f2a...c8b1" }
router.post('/connect-wallet', async (req, res, next) => {
  try {
    const { user_id, wallet_address } = req.body;

    if (!user_id)        return res.status(400).json({ success: false, error: 'user_id is required' });
    if (!wallet_address) return res.status(400).json({ success: false, error: 'wallet_address is required' });

    // Basic Ethereum address validation (starts with 0x, 42 chars)
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethAddressRegex.test(wallet_address)) {
      return res.status(400).json({
        success: false,
        error:   'Invalid Ethereum wallet address format',
      });
    }

    const address = wallet_address.toLowerCase();

    // Check wallet not already used by someone else
    const { rows: walletCheck } = await query(
      'SELECT id, username FROM users WHERE wallet_address = $1', [address]
    );
    if (walletCheck.length && walletCheck[0].id !== parseInt(user_id)) {
      return res.status(409).json({
        success: false,
        error:   'This wallet address is already connected to another account',
      });
    }

    // Update the user's wallet
    const { rows } = await query(`
      UPDATE users SET
        wallet_address = $1,
        updated_at     = NOW()
      WHERE id = $2
      RETURNING id, username, wallet_address, points
    `, [address, user_id]);

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      message: `Wallet connected! ${rows[0].username} is now eligible for on-chain rewards.`,
      user:    rows[0],
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /users/:id ────────────────────────────────────────────
// Full profile with prediction history and stats
router.get('/:id', async (req, res, next) => {
  try {
    // Get user
    const { rows: userRows } = await query(
      `SELECT id, username, wallet_address, points, predictions_made,
              correct_predictions, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );

    if (!userRows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = userRows[0];

    // Their rank among all users
    const { rows: rankRows } = await query(`
      SELECT RANK() OVER (ORDER BY points DESC) AS rank
      FROM users WHERE id = $1
    `, [user.id]);

    // Recent predictions (last 5)
    const { rows: recentPreds } = await query(`
      SELECT
        p.predicted_result,
        p.points_earned,
        p.is_correct,
        m.kickoff_time,
        ht.name AS home_team,
        at.name AS away_team,
        m.home_score,
        m.away_score,
        m.result AS actual_result,
        l.name   AS league
      FROM predictions p
      JOIN matches m  ON m.id  = p.match_id
      JOIN teams   ht ON ht.id = m.home_team_id
      JOIN teams   at ON at.id = m.away_team_id
      JOIN leagues l  ON l.id  = m.league_id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT 5
    `, [user.id]);

    // Points breakdown by league
    const { rows: leagueBreakdown } = await query(`
      SELECT
        l.name AS league,
        COUNT(p.id)                            AS predictions,
        COALESCE(SUM(p.points_earned), 0)      AS points,
        COUNT(CASE WHEN p.is_correct THEN 1 END) AS correct
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      JOIN leagues l ON l.id = m.league_id
      WHERE p.user_id = $1
      GROUP BY l.name
      ORDER BY points DESC
    `, [user.id]);

    res.json({
      success: true,
      user: {
        ...user,
        rank:         parseInt(rankRows[0]?.rank) || null,
        accuracy_pct: user.predictions_made > 0
          ? Math.round((user.correct_predictions / user.predictions_made) * 100)
          : 0,
        wallet_connected: !!user.wallet_address,
      },
      recent_predictions: recentPreds,
      league_breakdown:   leagueBreakdown,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
