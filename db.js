// db.js — SQLite persistence layer using Node's built-in node:sqlite (Node 22+, experimental).
// Data survives server restarts (stored in data.db).
//
// DATA_DIR lets you point this at a mounted persistent volume when deploying (e.g. Railway).
// Without it, data.db just lives next to this file — fine for local use, but on most hosts
// the app's own directory is wiped on every redeploy, taking your data with it.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'data.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    lot_id TEXT NOT NULL,
    lbs_used REAL NOT NULL,
    note TEXT,
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lot_id) REFERENCES lots(id)
  );
`);

const SEED_LOTS = [
  { id: 'l1', origin: 'Ethiopia Yirgacheffe', variety: 'Heirloom, washed', supplier: 'Café Imports', supplier_contact: 'orders@cafeimports.com', lead_time_days: 21, lbs_on_hand: 180, cost_per_lb: 6.5, buffer_weeks: 3 },
  { id: 'l2', origin: 'Colombia Huila', variety: 'Caturra, washed', supplier: 'Falcon Coffees', supplier_contact: 'sales@falconcoffees.com', lead_time_days: 28, lbs_on_hand: 400, cost_per_lb: 5.25, buffer_weeks: 3 },
  { id: 'l3', origin: 'Brazil Cerrado', variety: 'Mundo Novo, natural', supplier: 'InterAmerican Coffee', supplier_contact: 'orders@intercoffee.com', lead_time_days: 14, lbs_on_hand: 60, cost_per_lb: 4.1, buffer_weeks: 2 },
  { id: 'l4', origin: 'Guatemala Huehuetenango', variety: 'Bourbon, washed', supplier: 'Café Imports', supplier_contact: 'orders@cafeimports.com', lead_time_days: 21, lbs_on_hand: 250, cost_per_lb: 5.75, buffer_weeks: 3 },
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

function reseed() {
  db.exec('DELETE FROM usage_logs;');
  db.exec('DELETE FROM lots;');
  const insertLot = db.prepare(
    `INSERT INTO lots (id, origin, variety, supplier, supplier_contact, lead_time_days, lbs_on_hand, cost_per_lb, buffer_weeks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  SEED_LOTS.forEach((l) =>
    insertLot.run(l.id, l.origin, l.variety, l.supplier, l.supplier_contact, l.lead_time_days, l.lbs_on_hand, l.cost_per_lb, l.buffer_weeks)
  );

  const insertUsage = db.prepare(
    `INSERT INTO usage_logs (id, lot_id, lbs_used, note, logged_at) VALUES (?, ?, ?, ?, datetime('now', ?))`
  );
  SEED_USAGE.forEach(([lotId, lbs, daysAgo], i) =>
    insertUsage.run('u' + Date.now() + i, lotId, lbs, 'Roast session', `-${daysAgo} days`)
  );
}

// Seed on first run only (table empty), so restarts don't wipe real data.
const lotCount = db.prepare('SELECT COUNT(*) AS c FROM lots').get().c;
if (lotCount === 0) reseed();

module.exports = { db, reseed };
