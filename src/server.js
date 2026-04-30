// ============================================================
// BASE FOOTBALL PREDICTIONS — API SERVER
// ============================================================
// Node.js + Express backend
//
// QUICK START:
//   1. npm install
//   2. cp .env.example .env  (fill in your Postgres/Supabase URL)
//   3. npm run migrate       (sets up database tables)
//   4. npm run seed          (adds sample matches)
//   5. npm run dev           (starts server with auto-reload)
//
// Then visit http://localhost:3001/health to confirm it's live
// ============================================================

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const matchRoutes      = require('./routes/matches');
const predictRoutes    = require('./routes/predictions');
const resultsRoutes    = require('./routes/results');
const leaderboardRoutes= require('./routes/leaderboard');
const userRoutes       = require('./routes/users');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger }= require('./middleware/requestLogger');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(requestLogger);

// ── ROUTES ──────────────────────────────────────────────────
app.use('/matches',     matchRoutes);
app.use('/predict',     predictRoutes);
app.use('/results',     resultsRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/users',       userRoutes);
// ── SERVE FRONTEND PAGES ─────────────────────────────
const path = require('path');
app.get('/',              (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.get('/index.html',    (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.get('/creators.html', (req, res) => res.sendFile(path.join(__dirname, '../creators.html')));
app.get('/matches.html',  (req, res) => res.sendFile(path.join(__dirname, '../matches.html')));
app.get('/earnings.html', (req, res) => res.sendFile(path.join(__dirname, '../earnings.html')));
app.get('/shared.css',    (req, res) => res.sendFile(path.join(__dirname, '../shared.css')));
app.get('/shared.js',     (req, res) => res.sendFile(path.join(__dirname, '../shared.js')));
app.get('/penalty-shootout.html', (req, res) => res.sendFile(path.join(__dirname, '../penalty-shootout.html')));
// ── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    app:       '⚽ Base Football Predictions API',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── 404 HANDLER ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── ERROR HANDLER ────────────────────────────────────────────
app.use(errorHandler);

// ── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n⚽  Base Football Predictions API');
  console.log(`    Running  → http://localhost:${PORT}`);
  console.log(`    Health   → http://localhost:${PORT}/health`);
  console.log(`    Database → PostgreSQL / Supabase\n`);
});

module.exports = app;