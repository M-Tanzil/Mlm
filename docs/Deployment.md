# Deployment guide

How to take the system from a fresh checkout to a running production setup, and what to check before going live.

## 1. What runs where

| Piece | What it is | Notes |
|---|---|---|
| API | `server/` — `npm start` (Express, port `PORT`, default 5000) | Stateless, so it can run more than once behind a load balancer. |
| Worker | `server/` — `npm run worker` | Needed only when `USE_QUEUE=true` (email/SMS retries, bonus and payout jobs). Needs Redis. |
| Client | `client/` — `npm run build` → static files in `client/dist/` | Serve from any static host. |
| Database | Supabase Postgres (`ltree` and `citext` extensions enabled) | Shared; never reset it. |
| Redis | Upstash or self-hosted | Only for BullMQ (queues). The API works without it when `USE_QUEUE` is not `true`. |
| Uploads | `server/uploads/` on disk (product images, company logo) | See "Uploaded files" below. |

## 2. Environment variables (`server/.env`)

Copy `server/.env.example` and fill it in. **Never commit `.env`** (it is git-ignored) and never put real values in `.env.example`.

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes | `production` in production (switches logging to `combined`). |
| `PORT` | no | API port, default 5000. |
| `TRUST_PROXY` | behind a proxy | `1` when one reverse proxy / load balancer sits in front of the API, so the login rate limit sees the real client IP. Leave blank when the API is reached directly. |
| `CLIENT_URL` | yes | Exact origin of the web app, e.g. `https://app.example.com`. It is the only origin CORS allows. |
| `DATABASE_URL` | yes | Pooled Supabase connection (port 6543). Keep `&connection_limit=5&pool_timeout=30&connect_timeout=30` (or tune), otherwise the pooler can drop connections. |
| `DIRECT_URL` | for migrations | Direct connection (port 5432), used by `prisma` commands. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | yes | Long random strings (32+ characters), different from each other. **In production the API refuses to start** if either is missing, short, still the example value, or the same as the other; it also refuses without `DATABASE_URL` or `CLIENT_URL` (and `REDIS_URL` when `USE_QUEUE=true`). The message names the variable, never its value. In development it only warns. |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | no | Default `15m` / `7d`. |
| `REDIS_URL` | when queues are used | `rediss://…` for Upstash. |
| `USE_QUEUE` | no | `true` = email/SMS go through BullMQ with 3 retries (run the worker). Otherwise they are sent straight from the API with no automatic retry; failed rows can be resent from Email & SMS in the admin panel. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | for email | Uses `nodemailer` (installed). Blank = email stays off and rows show as FAILED with the reason. |
| `SMS_API_URL`, `SMS_API_KEY` | for SMS | The gateway receives `POST {to, message}` with `Authorization: Bearer <key>`. A real provider may need an adapter in `notification.service.js`. |

Client (`client/.env`): `VITE_API_URL` (default `/api`). In development Vite proxies `/api` and `/uploads` to `VITE_API_TARGET` (default `http://localhost:5000`).

## 3. Database migrations

Run these once, in order, in the Supabase SQL editor (each is safe to re-run):

1. `server/prisma/sql/001_init.sql`
2. `002_enable_rls.sql`
3. `003_initial_data.sql` (add the Super Admin with a bcrypt hash)
4. `004_stock_inward_rejected_qty.sql` — adds `stock_inward_items.rejected_qty`
5. `005_support_announcements.sql` — ticket category / assignment / resolution, announcement audience / schedule
6. `006_performance_indexes.sql` — indexes on foreign keys and list filters (10x–77x faster lookups on large tables)

Then `npx prisma generate` in `server/`. Migrations are additive only; there is no down-migration, so take a Supabase backup first.

## 4. Build and start

```
cd server && npm ci && npm start          # API
cd server && npm run worker               # only if USE_QUEUE=true
cd client && npm ci && npm run build      # upload client/dist/ to the static host
```

Health check: `GET /api/health` → `{"status":"ok","db":"up"}` (503 when the database is unreachable). Point the load balancer / uptime monitor at it.

## 5. Reverse proxy

The browser calls `/api/*` and loads images from `/uploads/*` on the **same origin as the web app**. Route both paths to the API:

```
/api/      → API (port 5000)
/uploads/  → API (port 5000)
/          → client/dist (single-page app: unknown paths return index.html)
```

If the API is on a different domain instead, build the client with `VITE_API_URL=https://api.example.com/api`, and note that product images are stored as `/uploads/…` paths, so `/uploads` still has to be reachable from the web app's origin.

Terminate HTTPS at the proxy. If the API sits behind it, tell Express to trust it (`app.set('trust proxy', 1)`) before adding anything that uses the client IP.

## 6. Uploaded files

Uploads are written to `server/uploads/` on the API's disk. On most hosts that disk is wiped on every deploy and is not shared between instances. Before going live either mount a persistent volume at `server/uploads/` or move uploads to object storage. Until then, product images disappear on redeploy.

## 7. Pre-go-live checklist

- [ ] All five SQL files applied; a Supabase backup taken.
- [ ] `NODE_ENV=production`, strong `JWT_*` secrets, `CLIENT_URL` set to the real origin.
- [ ] `.env` is not in git (`git ls-files | grep .env` shows only the two `.env.example` files).
- [ ] The default Super Admin password has been changed.
- [ ] Persistent storage for `uploads/` decided.
- [ ] Email and SMS configured, or knowingly left off.
- [ ] `/api/health` monitored; logs shipped somewhere (the API logs to stdout).
- [ ] HTTPS in front of everything.
- [ ] The open items in "Known gaps" below accepted or fixed.

## 8. Running the API test suite

`server/tests/` contains 14 API test files (about 630 checks) covering inventory, depo/franchise, orders, joining packages, schemes, notifications, support, announcements and the security hardening (production error output, startup config check, login rate limit, normal login/refresh), including race conditions. `node tests/perf-indexes.mjs` re-measures the index benefit on synthetic data (it only uses temporary tables and rolls back).

```
cd server
node tests/run-all.mjs            # everything
node tests/run-all.mjs task19     # one file
```

The runner starts its own server on port 5059 and a fake SMS gateway on 5058. **The tests write to the database in `server/.env`.** All test rows are named `ZZTEST…` and removed afterwards, but they use up sequence numbers (PO, GRN, ORD, …), leaving gaps in real numbering. Run them against a development database, not production.

## 9. Known gaps (as of this writing)

- Login rate limit (10 failed logins per login ID per IP, 50 per IP, per 15 minutes) is kept in the API process's memory: it resets on restart, and with several API servers each keeps its own count. Move it to Redis when scaling out. Override with `LOGIN_MAX_PER_ID` / `LOGIN_MAX_PER_IP`.
- Login answers faster for an unknown login ID than for a wrong password (the password hash is only checked for real users), which lets someone test which IDs exist. This is in the auth module, which belongs to Tanzil.
- Access and refresh tokens are stateless: a refresh token cannot be revoked individually (blocking the user does stop refresh).
- `npm audit`: `zod` (high, memory use on very large arrays; mitigated by the 1 MB body limit and per-route array limits) and `tar`/`@mapbox/node-pre-gyp` (installer-time only, via `bcrypt`). Fixing them needs major version upgrades.
- Dates for schemes use the database's UTC date, not IST.
