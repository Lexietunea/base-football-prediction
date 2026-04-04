// ============================================================
// POSTS ROUTE (src/routes/posts.js)
// ============================================================
// GET  /api/posts          → load all posts (newest first)
// POST /api/posts          → create a new post
// GET  /api/posts/:id      → get a single post
// POST /api/posts/:id/like → like a post
// POST /api/posts/:id/replies → add a reply
// GET  /api/posts/:id/replies → get replies
// ============================================================

const express   = require('express');
const router    = express.Router();
const { query } = require('../db');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');

// ── MEDIA UPLOAD SETUP ───────────────────────────────────────
// Store uploaded images/videos in /uploads folder
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp',
                     'video/mp4','video/webm','video/ogg','video/quicktime'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ── ENSURE POSTS TABLE EXISTS ─────────────────────────────────
async function ensurePostsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS posts (
        id            SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        username      VARCHAR(100),
        content       TEXT,
        team_tag      VARCHAR(100),
        league_tag    VARCHAR(100),
        media         JSONB DEFAULT '[]',
        likes         INTEGER DEFAULT 0,
        liked_by      JSONB DEFAULT '[]',
        post_type     VARCHAR(20) DEFAULT 'text',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS post_replies (
        id            SERIAL PRIMARY KEY,
        post_id       INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        wallet_address VARCHAR(42) NOT NULL,
        username      VARCHAR(100),
        content       TEXT NOT NULL,
        likes         INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_posts_created    ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_wallet     ON posts(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_posts_league     ON posts(league_tag);
      CREATE INDEX IF NOT EXISTS idx_replies_post_id  ON post_replies(post_id);
    `);
  } catch (e) {
    console.error('Posts table setup error:', e.message);
  }
}
ensurePostsTable();

// ── GET /api/posts ────────────────────────────────────────────
// Load all posts newest first
router.get('/', async (req, res, next) => {
  try {
    const { league, limit = 50, offset = 0 } = req.query;

    let conditions = ['1=1'];
    let params     = [];
    let i          = 1;

    if (league && league !== 'all') {
      conditions.push(`league_tag = $${i++}`);
      params.push(league);
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const { rows } = await query(`
      SELECT
        p.*,
        (SELECT COUNT(*) FROM post_replies r WHERE r.post_id = p.id) AS reply_count
      FROM posts p
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, params);

    res.json({ success: true, posts: rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/posts ───────────────────────────────────────────
// Create a new post — wallet required
router.post('/', upload.array('media', 4), async (req, res, next) => {
  try {
    const { wallet_address, username, content, team_tag, league_tag } = req.body;

    // Wallet required
    if (!wallet_address) {
      return res.status(401).json({ success: false, error: 'Wallet address required' });
    }

    // Must have content or media
    if (!content?.trim() && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ success: false, error: 'Post must have text or media' });
    }

    // Build media array from uploaded files
    const media = (req.files || []).map(f => ({
      type: f.mimetype.startsWith('video') ? 'video' : 'image',
      url:  `/uploads/${f.filename}`,
      name: f.originalname,
    }));

    // Determine post type
    const hasVideo = media.some(m => m.type === 'video');
    const hasImage = media.some(m => m.type === 'image');
    const postType = hasVideo ? 'video' : hasImage ? 'image' : 'text';

    const { rows } = await query(`
      INSERT INTO posts
        (wallet_address, username, content, team_tag, league_tag, media, post_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      wallet_address.toLowerCase(),
      username || `${wallet_address.slice(0,6)}…${wallet_address.slice(-4)}`,
      content?.trim() || '',
      team_tag || 'Base Football',
      league_tag || 'All Leagues',
      JSON.stringify(media),
      postType,
    ]);

    res.status(201).json({ success: true, post: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/posts/:id/like ──────────────────────────────────
router.post('/:id/like', async (req, res, next) => {
  try {
    const { wallet_address } = req.body;
    const { id } = req.params;

    if (!wallet_address) return res.status(401).json({ success: false, error: 'Wallet required' });

    // Get current post
    const { rows } = await query('SELECT liked_by, likes FROM posts WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Post not found' });

    const likedBy = rows[0].liked_by || [];
    const addr    = wallet_address.toLowerCase();
    const already = likedBy.includes(addr);

    let newLikedBy, newLikes;
    if (already) {
      newLikedBy = likedBy.filter(a => a !== addr);
      newLikes   = Math.max(0, rows[0].likes - 1);
    } else {
      newLikedBy = [...likedBy, addr];
      newLikes   = rows[0].likes + 1;
    }

    await query(
      'UPDATE posts SET likes = $1, liked_by = $2 WHERE id = $3',
      [newLikes, JSON.stringify(newLikedBy), id]
    );

    res.json({ success: true, liked: !already, likes: newLikes });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/posts/:id/replies ────────────────────────────────
router.get('/:id/replies', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM post_replies WHERE post_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, replies: rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/posts/:id/replies ───────────────────────────────
router.post('/:id/replies', async (req, res, next) => {
  try {
    const { wallet_address, username, content } = req.body;
    const { id } = req.params;

    if (!wallet_address) return res.status(401).json({ success: false, error: 'Wallet required' });
    if (!content?.trim()) return res.status(400).json({ success: false, error: 'Reply cannot be empty' });

    const { rows } = await query(`
      INSERT INTO post_replies (post_id, wallet_address, username, content)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [
      id,
      wallet_address.toLowerCase(),
      username || `${wallet_address.slice(0,6)}…${wallet_address.slice(-4)}`,
      content.trim()
    ]);

    res.status(201).json({ success: true, reply: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;