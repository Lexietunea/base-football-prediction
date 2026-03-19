require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  console.log('🌱  Seeding database...\n');

  try {
    // ── CLEAR OLD DATA ────────────────────────────────────────
    await pool.query('DELETE FROM predictions');
    await pool.query('DELETE FROM matches');
    await pool.query('DELETE FROM teams');
    await pool.query('DELETE FROM leagues');
    console.log('🧹  Cleared old data');

    // ── LEAGUES ───────────────────────────────────────────────
    const { rows: leagues } = await pool.query(`
      INSERT INTO leagues (name, country) VALUES
        ('Champions League',  'Europe'),
        ('Premier League',    'England'),
        ('La Liga',           'Spain'),
        ('Bundesliga',        'Germany'),
        ('Serie A',           'Italy'),
        ('Ligue 1',           'France')
      ON CONFLICT (name) DO UPDATE SET country = EXCLUDED.country
      RETURNING id, name;
    `);
    console.log('✅  Inserted ' + leagues.length + ' leagues');

    const leagueId = {};
    leagues.forEach(l => leagueId[l.name] = l.id);

    // ── TEAMS ─────────────────────────────────────────────────
    const teamData = [
      ['Real Madrid','RMA','La Liga'],['Barcelona','BAR','La Liga'],['Atletico Madrid','ATL','La Liga'],
      ['Arsenal','ARS','Premier League'],['Liverpool','LFC','Premier League'],
      ['Manchester City','MCI','Premier League'],['Manchester United','MUN','Premier League'],
      ['Chelsea','CHE','Premier League'],['Tottenham','TOT','Premier League'],['Newcastle','NEW','Premier League'],
      ['Bayern Munich','BAY','Bundesliga'],['Borussia Dortmund','BVB','Bundesliga'],['Bayer Leverkusen','LEV','Bundesliga'],
      ['Inter Milan','INT','Serie A'],['AC Milan','MIL','Serie A'],['Juventus','JUV','Serie A'],
      ['Paris Saint-Germain','PSG','Ligue 1'],['Monaco','MON','Ligue 1'],
    ];

    for (const [name, short, league] of teamData) {
      await pool.query(
        `INSERT INTO teams (name, short_name, league_id) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET short_name=EXCLUDED.short_name`,
        [name, short, leagueId[league]]
      );
    }

    const { rows: teams } = await pool.query('SELECT id, name FROM teams');
    const teamId = {};
    teams.forEach(t => teamId[t.name] = t.id);
    console.log('✅  Inserted ' + teams.length + ' teams');

    // ── UPCOMING MATCHES (next 14 days) ──────────────────────
    const now = new Date();
    const kick = (days, hour, min) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      d.setHours(hour, min || 0, 0, 0);
      return d.toISOString();
    };

    const upcoming = [
      ['Arsenal','Liverpool','Premier League',kick(1,12,30),'Emirates Stadium'],
      ['Real Madrid','Barcelona','La Liga',kick(1,21,0),'Santiago Bernabeu'],
      ['Bayern Munich','Borussia Dortmund','Bundesliga',kick(2,18,30),'Allianz Arena'],
      ['Inter Milan','Juventus','Serie A',kick(2,20,45),'San Siro'],
      ['Manchester City','Chelsea','Premier League',kick(3,15,0),'Etihad Stadium'],
      ['Atletico Madrid','Barcelona','La Liga',kick(3,21,0),'Metropolitano'],
      ['Paris Saint-Germain','Monaco','Ligue 1',kick(4,21,0),'Parc des Princes'],
      ['AC Milan','Inter Milan','Serie A',kick(4,20,45),'San Siro'],
      ['Real Madrid','Manchester City','Champions League',kick(5,21,0),'Santiago Bernabeu'],
      ['Arsenal','Bayern Munich','Champions League',kick(5,21,0),'Emirates Stadium'],
      ['Liverpool','Manchester United','Premier League',kick(6,17,30),'Anfield'],
      ['Bayer Leverkusen','Bayern Munich','Bundesliga',kick(6,18,30),'BayArena'],
      ['Barcelona','Paris Saint-Germain','Champions League',kick(7,21,0),'Camp Nou'],
      ['Borussia Dortmund','Inter Milan','Champions League',kick(7,21,0),'Signal Iduna Park'],
      ['Tottenham','Arsenal','Premier League',kick(8,16,30),'Tottenham Hotspur Stadium'],
      ['Juventus','AC Milan','Serie A',kick(8,20,45),'Allianz Stadium'],
      ['Manchester City','Liverpool','Premier League',kick(10,15,0),'Etihad Stadium'],
      ['Real Madrid','Atletico Madrid','La Liga',kick(10,21,0),'Santiago Bernabeu'],
      ['Chelsea','Tottenham','Premier League',kick(12,12,30),'Stamford Bridge'],
      ['Bayern Munich','Paris Saint-Germain','Champions League',kick(12,21,0),'Allianz Arena'],
    ];

    for (const [home, away, league, kickoff, venue] of upcoming) {
      await pool.query(
        `INSERT INTO matches (home_team_id,away_team_id,league_id,kickoff_time,status,venue) VALUES ($1,$2,$3,$4,'upcoming',$5)`,
        [teamId[home], teamId[away], leagueId[league], kickoff, venue]
      );
    }
    console.log('✅  Inserted ' + upcoming.length + ' upcoming matches (next 14 days)');

    // ── COMPLETED MATCHES (last 7 days) ──────────────────────
    const past = (days, hour) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      d.setHours(hour || 20, 0, 0, 0);
      return d.toISOString();
    };

    const completed = [
      ['Liverpool','Chelsea','Premier League',past(1),2,1],
      ['Barcelona','Real Madrid','La Liga',past(2),1,3],
      ['Bayern Munich','Bayer Leverkusen','Bundesliga',past(3),2,2],
      ['Paris Saint-Germain','Monaco','Ligue 1',past(4),3,0],
      ['Arsenal','Manchester United','Premier League',past(5),2,0],
    ];

    for (const [home, away, league, kickoff, hs, as_] of completed) {
      const result = hs > as_ ? 'home' : as_ > hs ? 'away' : 'draw';
      await pool.query(
        `INSERT INTO matches (home_team_id,away_team_id,league_id,kickoff_time,status,home_score,away_score,result) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7)`,
        [teamId[home], teamId[away], leagueId[league], kickoff, hs, as_, result]
      );
    }
    console.log('✅  Inserted ' + completed.length + ' completed matches');

    // ── USERS ─────────────────────────────────────────────────
    await pool.query(`
      INSERT INTO users (username, points, predictions_made, correct_predictions) VALUES
        ('0xVictor_J',480,32,18),('0xBarcaVision',410,28,15),
        ('0xKlopp_era',395,30,14),('0xManUtd_DNA',310,25,11),('0xDerby_Mode',275,22,9)
      ON CONFLICT (username) DO NOTHING;
    `);
    console.log('✅  Inserted sample users');

    console.log('\n🎉  Seed complete!');
    console.log('    📅  ' + upcoming.length + ' upcoming matches over next 14 days');
    console.log('    ✅  ' + completed.length + ' completed matches for results\n');

  } catch (err) {
    console.error('❌  Seed failed:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

seed();