# RoastRadar MVP

Green coffee inventory & reorder-alert tool for small coffee roasters. Real backend — data persists across restarts, login-gated, burn-rate/reorder logic runs server-side.

## What this is (and isn't)

This is a working MVP, not a finished commercial product: single shared login (not multi-user/multi-tenant), one demo roastery's data (not multiple customer accounts), and the forecast is a transparent burn-rate heuristic (trailing 21-day usage ÷ 21, projected forward) — not a trained model. That's a deliberate choice: every "reorder now" flag traces back to a plain-English reason (days until empty vs. supplier lead time), which builds more trust with a small roaster than a black-box prediction would. Turning this into a sellable product would mean adding: multi-tenancy (one account per roastery), integration with a roasting-log app (Cropster etc.) to auto-capture usage instead of manual entry, real email sending for reorder notes, and price/lead-time tracking per supplier over time.

## Requirements

- Node.js 22 or newer (uses the built-in `node:sqlite` module — no external database to install or configure).

## Run it locally

```bash
cd roastradar-mvp
npm install
npm start
```

Then open **http://localhost:3000** in a browser. You'll be redirected to a login page.

- **Password:** `beans2026` (default — change it by setting the `ROASTER_PASSWORD` environment variable before starting the server, e.g. `ROASTER_PASSWORD=yourpassword npm start`)

Data is stored in `data.db` (created automatically on first run) and is seeded with 6 green coffee lots and ~3 weeks of usage history. Use the **Reset demo data** button in the app to wipe and reseed at any time — useful before a live demo.

> **Note on `node:sqlite` and network-mounted folders:** if you're running this from a cloud-synced or network-mounted directory (Dropbox, a mounted drive, etc.), `node:sqlite` can throw a `disk I/O error` because SQLite's file locking doesn't work reliably on some non-local filesystems. If you hit that, run the app from a local disk path, or set `DATA_DIR` to a local path.

## Managing lots

- **New lot** button opens a form to add a green coffee lot (origin, variety, supplier, contact, lead time, lbs on hand, cost/lb, reorder buffer).
- Click a lot card to open it: log a roast (deducts lbs and updates the burn-rate forecast), generate a plain-text reorder note, or delete the lot.
- The dashboard sorts at-risk lots first (worst days-until-empty at the top), and the alert banner summarizes anything that needs reordering now.

## What's real vs. simulated

| Piece | Status |
|---|---|
| Lot inventory, usage logging, forecast, alerts | Real — persisted in SQLite, survives server restarts |
| Login gate | Real — server-side session, not just a client-side check |
| Burn-rate / reorder-forecast logic | Real, runs server-side — but it's a rules-based heuristic (trailing 21-day usage), not ML |
| Reorder note generation | Real — plain text built from live lot + forecast data |
| Email sending | Not built — the reorder note is generated for copy/paste, not sent |
| Multi-tenancy (multiple roasteries) | Not built — this is single-business, single-login |
| Roasting-log integration (Cropster etc.) | Not built — usage is logged manually in this MVP |

## Deploying to Railway

This app is set up to deploy to [Railway](https://railway.com) — $5/month flat (Hobby plan), simplest git-based deploy of the mainstream options. Render's free tier looked tempting but its free instances have an ephemeral filesystem (your SQLite data resets on every restart) and persistent disks are paid-tier only, so it doesn't actually save you anything here. Fly.io dropped free allowances in 2024 and needs a credit card up front. This is your account to create — nobody else can do that step for you.

### Option A — Railway CLI (no GitHub required)

```bash
npm install -g @railway/cli
railway login
cd roastradar-mvp
railway init
railway up
```

### Option B — GitHub (auto-deploys on every push)

1. Push this folder to a new GitHub repo.
2. In the Railway dashboard: New Project → Deploy from GitHub repo → select the repo.

### After the first deploy, either way

1. **Add a volume** so your data survives restarts and redeploys: in the service's Settings → Volumes, add a volume and mount it at `/data`.
2. **Set environment variables** (Settings → Variables):
   - `DATA_DIR` = `/data` (points the database at the volume you just mounted — without this, data resets on every redeploy, same problem as Render's free tier)
   - `ROASTER_PASSWORD` = a real password (don't ship with `beans2026`)
   - `SESSION_SECRET` = any long random string
3. Railway sets `PORT` automatically — the app already reads `process.env.PORT`, nothing to do there.
4. Under Settings → Networking, generate a public domain. That URL is what you share with a prospect or the BD partner.

Node version is pinned via `engines.node` in `package.json`. If Railway's build logs show it picked a Node version older than 22, `node:sqlite` will fail — set `NIXPACKS_NODE_VERSION=22` as an environment variable as a fallback.

## Project structure

```
roastradar-mvp/
├── server.js       — Express app, routes, session/auth
├── db.js           — SQLite schema, seed data
├── forecast.js      — burn-rate/reorder scoring logic (server-side)
├── public/
│   ├── login.html
│   ├── index.html
│   └── app.js       — frontend, calls the real API via fetch
└── package.json
```
