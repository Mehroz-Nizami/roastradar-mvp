// db.js — Postgres persistence layer (Neon-compatible) using node-postgres (`pg`).
//
// Replaces the earlier node:sqlite version. SQLite required a persistent local disk,
// which only Railway's paid volume provided for free. Postgres lives on a separate
// managed service (Neon), so the app itself holds no state — meaning it can now run on
// any free host, including ones with ephemeral/wiped-on-redeploy filesystems.
//
// Set DATABASE_URL to your Neon (or any Postgres) connection string.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. Set it to your Neon connection string.');
}

// Determines whether to request SSL based on the actual hostname, not a substring match —
// a plain `.includes('localhost')` check misses 127.0.0.1, ::1, and local Docker hostnames,
// which would wrongly try SSL against a local Postgres that doesn't support it and fail to connect.
function needsSsl(connectionString) {
  if (!connectionString) return false;
  try {
    const { hostname } = new URL(connectionString);
    return !['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

// Translates SQLite-style `?` placeholders (kept so the rest of the app didn't need a
// full query rewrite) into Postgres's `$1, $2, ...` positional placeholders.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  async all(sql, params = []) {
    const { rows } = await pool.query(toPg(sql), params);
    return rows;
  },
  async get(sql, params = []) {
    const { rows } = await pool.query(toPg(sql), params);
    return rows[0];
  },
  async run(sql, params = []) {
    const res = await pool.query(toPg(sql), params);
    return { rowCount: res.rowCount, rows: res.rows };
  },
};

const SEED_LOTS = [
  { id: 'l1', origin: 'Ethiopia Yirgacheffe', variety: 'Heirloom, washed', supplier: 'Cafe Imports', supplier_contact: 'orders@cafeimports.com', lead_time_days: 21, lbs_on_hand: 180, cost_per_lb: 6.5, buffer_weeks: 3 },
  { id: 'l2', origin: 'Colombia Huila', variety: 'Caturra, washed', supplier: 'Falcon Coffees', supplier_contact: 'sales@falconcoffees.com', lead_time_days: 28, lbs_on_hand: 400, cost_per_lb: 5.25, buffer_weeks: 3 },
  { id: 'l3', origin: 'Brazil Cerrado', variety: 'Mundo Novo, natural', supplier: 'InterAmerican Coffee', supplier_contact: 'orders@intercoffee.com', lead_time_days: 14, lbs_on_hand: 60, cost_per_lb: 4.1, buffer_weeks: 2 },
  { id: 'l4', origin: 'Guatemala Huehuetenango', variety: 'Bourbon, washed', supplier: 'Cafe Imports', supplier_contact: 'orders@cafeimports.com', lead_time_days: 21, lbs_on_hand: 250, cost_per_lb: 5.75, buffer_weeks: 3 },
  { id: 'l5', origin: 'Sumatra Mandheling', variety: 'Wet-hulled', supplier: 'Royal Coffee', supplier_contact: 'info@royalcoffee.com', lead_time_days: 35, lbs_on_hand: 90, cost_per_lb: 6.0, buffer_weeks: 4 },
  { id: 'l6', origin: 'Kenya AA', variety: 'SL28/SL34, washed', supplier: 'Falcon Coffees', supplier_contact: 'sales@falconcoffees.com', lead_time_days: 28, lbs_on_hand: 140, cost_per_lb: 7.2, buffer_weeks: 3 },
];

// [lotId, lbsUsed, daysAgo] — spread over the last ~3 weeks so burn-rate math has real history.
const SEED_USAGE = [
  ['l1', 50, 20], ['l1', 50, 15], ['l1', 50, 10], ['l1', 50, 5],
  ['l2', 30, 21], ['l2', 30, 14], ['l2', 30, 7],
  ['l3', 20, 20], ['l3', 20, 16], ['l3', 20, 12], ['l3', 20, 8], ['l3', 20, 4],
  ['l4', 25, 18], ['l4', 25, 12], ['l4', 25, 6],
  ['l5', 20, 15], ['l5', 20, 10], ['l5', 20, 5],
  ['l6', 10, 14], ['l6', 10, 7],
];

async function reseed() {
  await db.run('DELETE FROM usage_logs');
  await db.run('DELETE FROM lots');

  for (const l of SEED_LOTS) {
    await db.run(
      `INSERT INTO lots (id, origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [l.id, l.origin, l.variety, l.supplier, l.supplier_contact, l.lead_time_days, l.lbs_on_hand, l.cost_per_lb, l.buffer_weeks]
    );
  }

  for (let i = 0; i < SEED_USAGE.length; i++) {
    const [lotId, lbs, daysAgo] = SEED_USAGE[i];
    await db.run(
      `INSERT INTO usage_logs (id, lot_id, lbs_used, note, logged_at)
       VALUES (?, ?, ?, ?, now() - (? * INTERVAL '1 day'))`,
      ['u' + Date.now() + i, lotId, lbs, 'Roast session', daysAgo]
    );
  }
}

// Creates tables if needed and seeds on first run only (so restarts don't wipe real data).
// Must be awaited once at server startup before the app starts handling requests.
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      variety TEXT NOT NULL,
      supplier TEXT NOT NULL,
      supplier_contact TEXT NOT NULL,
      lead_time_days INTEGER NOT NULL,
      lbs_on_hand REAL NOT NULL,
      cost_per_lb REAL NOT NULL,
      buffer_weeks REAL NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      lot_id TEXT NOT NULL REFERENCES lots(id),
      lbs_used REAL NOT NULL,
      note TEXT,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { c } = await db.get('SELECT COUNT(*)::int AS c FROM lots');
  if (c === 0) await reseed();
}

module.exports = { db, reseed, init };
