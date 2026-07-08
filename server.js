const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, reseed, init } = require('./db');
const { forecastForLot, forecastAllLots, reorderNote } = require('./forecast');

const app = express();
const PORT = process.env.PORT || 3000;
const ROASTER_PASSWORD = process.env.ROASTER_PASSWORD || 'beans2026';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }, // 8-hour session
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// Wraps async route handlers so rejected promises reach Express's error handler
// instead of hanging the request (Express 4 doesn't do this automatically).
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---- Auth routes ----
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ROASTER_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---- Lot routes ----
app.get('/api/lots', requireAuth, ah(async (req, res) => {
  const results = (await forecastAllLots()).map(({ lot, forecast }) => ({ ...lot, forecast }));
  // worst (soonest to run out / at-risk first) sorted for the dashboard
  results.sort((a, b) => {
    if (a.forecast.atRisk !== b.forecast.atRisk) return a.forecast.atRisk ? -1 : 1;
    const aDays = a.forecast.daysUntilEmpty ?? Infinity;
    const bDays = b.forecast.daysUntilEmpty ?? Infinity;
    return aDays - bDays;
  });
  res.json(results);
}));

app.get('/api/lots/:id', requireAuth, ah(async (req, res) => {
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  const forecast = await forecastForLot(lot);
  const usage = await db.all(
    'SELECT * FROM usage_logs WHERE lot_id = ? ORDER BY logged_at DESC LIMIT 20',
    [req.params.id]
  );
  res.json({ ...lot, forecast, usage });
}));

app.post('/api/lots', requireAuth, ah(async (req, res) => {
  const { origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks } =
    req.body || {};
  if (!origin || !variety || !supplier || !supplier_contact || !lead_time_days || lbs_on_hand == null || !cost_per_lb) {
    return res.status(400).json({
      error: 'origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, and cost_per_lb are required',
    });
  }
  const id = 'l' + Date.now() + Math.floor(Math.random() * 1000);
  await db.run(
    `INSERT INTO lots (id, origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks || 3]
  );
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [id]);
  res.json({ ...lot, forecast: await forecastForLot(lot) });
}));

app.patch('/api/lots/:id', requireAuth, ah(async (req, res) => {
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  const { origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks } =
    req.body || {};
  await db.run(
    `UPDATE lots SET origin = ?, variety = ?, supplier = ?, supplier_contact = ?, lead_time_days = ?, lbs_on_hand = ?, cost_per_lb = ?, buffer_weeks = ? WHERE id = ?`,
    [
      origin ?? lot.origin,
      variety ?? lot.variety,
      supplier ?? lot.supplier,
      supplier_contact ?? lot.supplier_contact,
      lead_time_days ?? lot.lead_time_days,
      lbs_on_hand ?? lot.lbs_on_hand,
      cost_per_lb ?? lot.cost_per_lb,
      buffer_weeks ?? lot.buffer_weeks,
      req.params.id,
    ]
  );
  const updated = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  res.json({ ...updated, forecast: await forecastForLot(updated) });
}));

app.delete('/api/lots/:id', requireAuth, ah(async (req, res) => {
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  await db.run('DELETE FROM usage_logs WHERE lot_id = ?', [req.params.id]);
  await db.run('DELETE FROM lots WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ---- Usage logging ----
app.post('/api/lots/:id/usage', requireAuth, ah(async (req, res) => {
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  const { lbs_used, note } = req.body || {};
  if (!lbs_used || lbs_used <= 0) return res.status(400).json({ error: 'lbs_used must be a positive number' });

  const id = 'u' + Date.now() + Math.floor(Math.random() * 1000);
  await db.run('INSERT INTO usage_logs (id, lot_id, lbs_used, note) VALUES (?, ?, ?, ?)', [
    id,
    req.params.id,
    lbs_used,
    note || null,
  ]);
  const newOnHand = Math.max(0, lot.lbs_on_hand - lbs_used);
  await db.run('UPDATE lots SET lbs_on_hand = ? WHERE id = ?', [newOnHand, req.params.id]);

  const updated = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  res.json({ ...updated, forecast: await forecastForLot(updated) });
}));

// ---- Alerts ----
app.get('/api/alerts', requireAuth, ah(async (req, res) => {
  const atRisk = (await forecastAllLots())
    .filter(({ forecast }) => forecast.atRisk)
    .sort((a, b) => (a.forecast.daysUntilEmpty ?? Infinity) - (b.forecast.daysUntilEmpty ?? Infinity))
    .map(({ lot, forecast }) => ({ ...lot, forecast }));
  res.json(atRisk);
}));

// ---- Reorder note ----
app.get('/api/lots/:id/reorder-note', requireAuth, ah(async (req, res) => {
  const lot = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  const forecast = await forecastForLot(lot);
  res.json({ note: reorderNote(lot, forecast) });
}));

app.post('/api/reset', requireAuth, ah(async (req, res) => {
  await reseed();
  res.json({ ok: true });
}));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (!(req.session && req.session.authed)) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Error handler (catches anything ah() forwards via next(err)) ----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await init();
  app.listen(PORT, () => {
    console.log(`RoastRadar MVP running at http://localhost:${PORT}`);
    console.log(`Login password: ${ROASTER_PASSWORD} (set ROASTER_PASSWORD env var to change)`);
  });
}

start().catch((err) => {
  console.error('Failed to start (check DATABASE_URL):', err);
  process.exit(1);
});
