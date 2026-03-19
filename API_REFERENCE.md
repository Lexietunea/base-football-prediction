# ⚽ Base Football Predictions — API Reference

## Setup (5 steps)

```bash
# 1. Install Node.js from nodejs.org

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Open .env and fill in your DATABASE_URL

# 4. Create tables
npm run migrate

# 5. Add sample data
npm run seed

# 6. Start the server
npm run dev
```

Visit `http://localhost:3001/health` — you should see the API is live.

---

## File Structure

```
base-football-predictions/
├── src/
│   ├── server.js              ← Entry point, starts the server
│   ├── db/
│   │   ├── index.js           ← Database connection
│   │   ├── migrate.js         ← Creates all tables (run once)
│   │   └── seed.js            ← Sample data
│   ├── routes/
│   │   ├── matches.js         ← GET /matches
│   │   ├── predictions.js     ← POST /predict
│   │   ├── results.js         ← POST /results
│   │   ├── leaderboard.js     ← GET /leaderboard
│   │   └── users.js           ← User registration + wallet
│   └── middleware/
│       ├── errorHandler.js    ← Catches all errors
│       └── requestLogger.js   ← Logs every API call
├── package.json
└── .env.example
```

---

## Endpoints

### GET /matches
Fetch upcoming fixtures.

```
GET /matches
GET /matches?status=upcoming
GET /matches?status=completed
GET /matches?league=Premier League
GET /matches?limit=10&offset=0
GET /matches/:id
```

**Response:**
```json
{
  "success": true,
  "count": 10,
  "matches": [
    {
      "id": 1,
      "kickoff_time": "2026-03-10T20:00:00Z",
      "status": "upcoming",
      "home_team": { "id": 4, "name": "Arsenal",   "short": "ARS" },
      "away_team": { "id": 5, "name": "Liverpool",  "short": "LFC" },
      "league":    { "id": 2, "name": "Premier League", "country": "England" },
      "score":     { "home": null, "away": null, "result": null },
      "total_predictions": 142
    }
  ]
}
```

---

### POST /predict
Submit a prediction for a match.

```
POST /predict
Content-Type: application/json

{
  "user_id": 1,
  "match_id": 3,
  "predicted_result": "home",
  "predicted_home_score": 2,
  "predicted_away_score": 1
}
```

`predicted_result` must be: `"home"` | `"away"` | `"draw"`
`predicted_home_score` and `predicted_away_score` are optional (earn bonus points if exact).

**Response:**
```json
{
  "success": true,
  "message": "Prediction submitted: Arsenal vs Liverpool → HOME",
  "prediction": {
    "id": 55,
    "user_id": 1,
    "match_id": 3,
    "predicted_result": "home",
    "predicted_score": "2 - 1",
    "match": {
      "home_team": "Arsenal",
      "away_team": "Liverpool",
      "kickoff_time": "2026-03-10T20:00:00Z"
    }
  }
}
```

---

### POST /results ⚠️ Admin only
Update a match result and automatically award points to predictors.

```
POST /results
Content-Type: application/json

{
  "match_id": 3,
  "home_score": 2,
  "away_score": 1,
  "admin_key": "your-secret-from-.env"
}
```

**What happens automatically:**
1. Match is updated to `completed` with the final score
2. Every prediction for that match is checked
3. **+3 points** awarded for correct result (win/draw/loss)
4. **+5 bonus points** awarded for exact correct score
5. All user point totals updated instantly

**Response:**
```json
{
  "success": true,
  "message": "Result recorded: Arsenal 2 – 1 Liverpool",
  "result": {
    "score": "2 – 1",
    "result": "home",
    "predictions_resolved": 142,
    "correct_predictions": 89,
    "total_points_awarded": 312
  }
}
```

---

### GET /leaderboard
Top users ranked by prediction points.

```
GET /leaderboard
GET /leaderboard?limit=10
GET /leaderboard?league=Champions League
GET /leaderboard/weekly
GET /leaderboard/user/:userId
```

**Response:**
```json
{
  "success": true,
  "leaderboard": [
    {
      "rank": 1,
      "username": "0xVictor_J",
      "wallet_address": "0x4f2a...c8b1",
      "points": 480,
      "predictions_made": 32,
      "correct_predictions": 18,
      "accuracy_pct": 56.3,
      "avg_points": 15.0
    }
  ]
}
```

---

### POST /users/register
Create a new fan account. Wallet is optional.

```
POST /users/register
Content-Type: application/json

{
  "username": "0xNewFan",
  "wallet_address": "0x4f2a...c8b1"
}
```

---

### POST /users/connect-wallet
Connect a Base wallet to an existing account for future rewards.

```
POST /users/connect-wallet
Content-Type: application/json

{
  "user_id": 1,
  "wallet_address": "0x4f2a...c8b1"
}
```

---

### GET /users/:id
Full user profile with stats and recent predictions.

---

## Scoring System

| What you predict correctly | Points |
|---|---|
| Win / Draw / Loss result | **+3 pts** |
| Exact final score | **+5 pts** (bonus, on top of the 3) |

---

## Calling This From Your Frontend

Add this to your `base-football.html`:

```javascript
const API = 'http://localhost:3001';

// Load upcoming matches
async function loadMatches() {
  const res  = await fetch(`${API}/matches?status=upcoming`);
  const data = await res.json();
  return data.matches; // array of match objects
}

// Submit a prediction
async function submitPrediction(userId, matchId, result, homeScore, awayScore) {
  const res = await fetch(`${API}/predict`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id:               userId,
      match_id:              matchId,
      predicted_result:      result,       // 'home' | 'away' | 'draw'
      predicted_home_score:  homeScore,    // optional
      predicted_away_score:  awayScore,    // optional
    }),
  });
  return res.json();
}

// Load leaderboard
async function loadLeaderboard() {
  const res  = await fetch(`${API}/leaderboard?limit=10`);
  const data = await res.json();
  return data.leaderboard;
}
```

---

## Deploy to Production

| Service | What it hosts | Cost |
|---|---|---|
| **Railway** (railway.app) | Node.js API + Postgres | Free tier |
| **Supabase** (supabase.com) | Postgres only | Free tier |
| **Render** (render.com) | Node.js API | Free tier |
| **Vercel** (vercel.com) | Frontend HTML | Free |

After deploying, change `API` in your frontend from `http://localhost:3001` to your live URL.
