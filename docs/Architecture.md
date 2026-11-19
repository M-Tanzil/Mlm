# Architecture: Direct-Selling (MLM) Management System

Binary + Generation compensation plan | Distributor Panel, Admin Panel, Inventory, Depo/Franchise, E-Pin, KYC

> Scope decision: this is a **management system only**. No public marketing website; web design/public pages from the original scope are excluded.

> Source: project scope document (Scope of Project, Detailed Features, Compensation Plan, Inventory, Depo/Franchise, Email/SMS). Tech stack below is a **proposal** (MERN) since the document does not specify one.

---

## 1. System Overview

A web platform where distributors join through packages or E-Pins, build a binary tree under a sponsor, order products, and earn commissions. Admins manage members, KYC, inventory, schemes and payouts. Depos and franchises handle stock and repurchase.

```
 ┌────────────┐  ┌────────────┐  ┌─────────────────┐
 │ Distributor│  │   Admin    │  │ Depo / Franchise│
 │   Panel    │  │   Panel    │  │      Panel      │
 └─────┬──────┘  └─────┬──────┘  └────────┬────────┘
       └───────────────┴──────────┬───────┘
                                  ▼
                       ┌────────────────────┐
                       │  API Gateway / BFF │  (Express, JWT, RBAC)
                       └─────────┬──────────┘
   ┌──────────┬──────────┬───────┴───┬───────────┬───────────┬──────────┐
   ▼          ▼          ▼           ▼           ▼           ▼          ▼
 Auth &    Member &   Compensation  Inventory  Orders &   E-Pin     Notification
 RBAC      Network    Engine        & Depo     Repurchase Service   (Email/SMS)
   │          │          │           │           │           │          │
   └──────────┴──────────┴─────┬─────┴───────────┴───────────┴──────────┘
                               ▼
                  PostgreSQL  +  Redis  +  File Storage
```

---

## 2. Proposed Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite, Tailwind CSS, React Router, Redux Toolkit | Responsive distributor panel, reusable admin tables |
| Tree UI | react-d3-tree or D3.js | Binary and Generation tree views |
| Backend | Node.js + Express (modular monolith) | Simple deploy, fits scope size |
| Database | PostgreSQL hosted on **Supabase** | Managed Postgres; relational, transactional; right fit for commissions, stock and payouts |
| Cache / Queue | Redis + BullMQ | Commission runs, Email/SMS queues |
| Auth | JWT (access + refresh), bcrypt, RBAC | Roles: Super Admin, Admin, Distributor, Depo, Franchise |
| Email / SMS | SMTP via SES or SendGrid; SMS gateway (5000 free SMS in scope) | Real-time transactional messages |

> Not yet decided: file storage for KYC documents and gallery (default: private server directory via Multer, can move to S3 later) and hosting/deployment (Web Hosting is in scope).

---

## 3. Modules

### 3.1 Distributor Back Office (responsive)
- **My Desktop:** downline count, payout, E-Pin received, last login, recent joinings, directs, current month business, news
- **Sign Up:** joining with sponsor ID, placement (left/right), package or E-Pin
- **My Network:** binary tree, generation tree, directs, downline details and counts
- **My Commission:** details, TDS, reconciliation report (plan-wise)
- **Achievement:** award targets and achievement details
- **E-Pin:** request, request details, received E-Pins, change password
- **Product Ordering:** place order, order details, order status
- **Communication Center:** compose message, refer friend, support ticket, my documents
- **My Details:** profile, welcome letter, receipt, PAN, Aadhaar, KYC status, repurchase details
- **Settings:** change password, landing page

### 3.2 Admin Back Office (Super Admin / Admin)
- **Master:** company info, location master, package master, role master, user master
- **View Member:** joining, downline, counts, state/city-wise count, trees, directs, line of sponsor, password details
- **Edit Member:** profile, PAN/Aadhaar/KYC confirmation, package delivery, package return confirmation
- **Achievement:** create scheme and offer, qualifier details
- **Payout:** commission calculation, details, statement, summary, TDS, reconciliation (plan-wise), bank transfer report
- **E-Pin:** create voucher, generate, issue, block, report, stock, change password
- **Announcements (in-app only, no public website):** news, events, achievers, photo gallery shown inside the panels
- **Utilities:** help desk, message, SMS, email, notification, support ticket, document upload, FAQ
- **Settings:** change password, welcome letter, receipt

### 3.3 Inventory Module
Product category, product adding, supplier, courier and transport, purchase order, stock inward (PO-wise and supplier-wise), stock return, stock report, stock transfer, stock acceptance, make resale, order dispatch.

### 3.4 Depo and Franchise Module
PCR, stock inward, stock transfer, stock acceptance, joining package delivery. Franchise is used for **repurchase + E-Pin** flows.

### 3.5 Cross-cutting
Email integration (real-time, per transaction and per occasion), SMS integration (same), joining package return, scheme and offer (periodic awards), bank transfer report.

---

## 4. Compensation Engine (Binary + Generation)

Bonuses in scope:

| # | Bonus | Trigger (to be confirmed with client) |
|---|---|---|
| 1 | Retail Bonus | Retail sale margin |
| 2 | First Order Bonus | Member's first order |
| 3 | First Track Bonus | Early-achievement window |
| 4 | E-Voucher Point | Points credited per business |
| 5 | Performance Bonus | Binary matching / volume |
| 6 | Leadership Development Bonus | Rank-based |
| 7 | Royalty Bonus | Rank-based pool |
| 8 | Travel Allowance Bonus | Rank/target |
| 9 | Vehicle Allowance Bonus | Rank/target |
| 10 | House Allowance Bonus | Rank/target |
| 11 | Depo Commission | Depo sales |
| 12 | Franchise Commission | Franchise sales |

**Design:**
- Each bonus is a **strategy plugin** (`calculate(period, member) -> ledger entries`) registered in a bonus registry. Adding or changing a plan does not touch the core.
- **Event-driven:** order/joining events enqueue jobs (BullMQ). Real-time bonuses (First Order, Retail) post immediately; periodic ones (Performance, Royalty, Allowances) run on a scheduled cutoff (daily/weekly/monthly).
- **Append-only ledger:** every credit/debit is an immutable row; wallet balance = sum of ledger. Payout is a state machine: `CALCULATED -> APPROVED -> TDS_DEDUCTED -> PAID`.
- **Binary volume:** each node stores `leftVolume`, `rightVolume`, `carryForward`; matching is computed per cycle with caps.
- **Reconciliation report:** re-derives payouts from raw events and compares to the ledger.

---

## 5. Network (Tree) Design

- Each member has `sponsorId` (generation tree) and `parentId + position (L/R)` (binary tree).
- Store a **materialized path** (e.g. `/root/A/B/C`) plus `depth` so downline queries are a prefix lookup instead of recursive traversal.
- Tree views are lazy-loaded: fetch 3-4 levels, expand on click.
- Placement rules: one left and one right child per node; spillover policy configurable (auto-place in weaker leg or manual).
- Cache downline counts in Redis; invalidate on new joining.

---

## 6. Data Model (core entities)

```
User(id, role, loginId, passwordHash, status)
Member(id, userId, sponsorId, parentId, position, path, depth,
       packageId, kycStatus, pan, aadhaar, bank{...}, joinedAt)
Package(id, name, price, bv, products[], active)
KycDocument(id, memberId, type, fileUrl, status, reviewedBy)

EPin(id, code, packageId, status[GENERATED|ISSUED|USED|BLOCKED],
     issuedTo, usedBy, createdBy)
EPinRequest(id, memberId, qty, status)

Product(id, categoryId, sku, name, price, bv, gst)
Category(id, name)
Supplier(id, name, contact, gstin)
Courier(id, name)
PurchaseOrder(id, supplierId, items[], status)
StockLedger(id, locationId, productId, qty, type[INWARD|RETURN|TRANSFER|SALE|RESALE],
            refId, createdAt)
Location(id, type[WAREHOUSE|DEPO|FRANCHISE], name, state, city)
StockTransfer(id, fromLocation, toLocation, items[], status[SENT|ACCEPTED])

Order(id, memberId, locationId, items[], total, bv, status, type[JOINING|REPURCHASE])
Dispatch(id, orderId, courierId, trackingNo, status)

BonusPlan(id, code, config{}, active)
CommissionLedger(id, memberId, bonusCode, amount, period, sourceRef, status)
Payout(id, memberId, gross, tds, net, status, bankRef, cycleId)

Scheme(id, name, target, reward, from, to)
SchemeQualifier(id, schemeId, memberId, achievedAt)

Notification(id, memberId, channel[EMAIL|SMS|INAPP], template, status)
Ticket(id, memberId, subject, status, messages[])
News / Event / Gallery / Faq / Document
AuditLog(id, actorId, action, entity, before, after, at)
```

**DB notes (PostgreSQL):**
- Use an ORM/query layer such as Prisma, Drizzle or Knex for migrations and typed queries.
- Wrap every ledger write, stock movement and payout state change in a transaction.
- Tree path: use `ltree` (or a text path with a `text_pattern_ops` index) for fast downline lookups.
- Use `NUMERIC(14,2)` for money, never floats; add unique constraints on `CommissionLedger(sourceRef, bonusCode)` and `EPin(code)`.
- Flexible blobs (bonus plan config, bank details) go in `JSONB` columns.

---

## 7. Key Flows

**Joining**
1. Sign up with sponsor ID, placement, and E-Pin or package.
2. Validate E-Pin (unused, not blocked) -> mark USED.
3. Create Member, set path, update parent's leg.
4. Create joining Order -> stock deduct from depo -> Joining Package Delivery.
5. Emit `MEMBER_JOINED` -> bonuses, welcome letter, email and SMS.

**Repurchase / Product Order**
Member places order -> pick depo/franchise -> stock reserved -> payment -> `ORDER_PAID` event -> BV added up the tree -> bonuses queued -> dispatch -> status updates by email/SMS.

**Stock (Inventory)**
PO -> Stock Inward (PO-wise or supplier-wise) -> Warehouse stock -> Stock Transfer to Depo -> Depo Stock Acceptance -> sale/dispatch. Every step writes a `StockLedger` row.

**Payout cycle**
Cutoff -> run bonus plugins -> admin review -> TDS -> approve -> bank transfer report export -> mark PAID -> notify.

**KYC**
Upload PAN/Aadhaar/bank proof -> admin confirm/reject -> payout enabled only when KYC is approved.

**Joining Package Return**
Admin confirms return -> reverse stock -> reverse BV and related bonuses via compensating ledger entries (never delete).

---

## 8. Security and Compliance

- JWT with short-lived access tokens and rotating refresh tokens; bcrypt hashing; login rate limiting and lockout.
- RBAC middleware per route; Super Admin only for masters, payout approval, and role management.
- Encrypt PAN, Aadhaar and bank details at rest; mask in UI and logs; signed, expiring URLs for KYC files.
- Audit log on every admin action and payout state change.
- Input validation (Zod/Joi), helmet, CORS allow-list, CSRF protection if cookies are used.
- TDS handling per Indian rules; keep payout and TDS statements for audit.
- Regulatory caution: direct-selling businesses in India are subject to the Consumer Protection (Direct Selling) Rules, 2021. Confirm compliance requirements with the client.

---

## 9. Non-Functional

- **Scalability:** tree queries via materialized path and indexes; heavy jobs in queues; reads cached in Redis.
- **Reliability:** idempotent jobs (unique `sourceRef` on ledger), retries with backoff, daily DB backups.
- **Observability:** structured logs, health endpoint, error tracking (Sentry), job dashboard.
- **Performance targets:** tree expand under 500 ms, dashboard under 1 s for 100k members (to validate).

---

## 10. Suggested Repository Layout

```
/client                  React app (distributor, admin, depo/franchise routes)
  /src/features/{auth,network,commission,epin,orders,inventory,kyc,support,...}
/server
  /src/modules/{auth,member,network,package,epin,kyc,inventory,depo,
                order,commission,payout,scheme,notification,announcement,support}
  /src/jobs               BullMQ workers (bonus plugins, notifications)
  /src/core               config, db, middleware, logger, errors
/docs                     Architecture.md, API.md, ER diagram
/server/prisma (or /migrations)   PostgreSQL schema and migrations
```

Each backend module: `routes -> controller -> service -> repository -> model`.

---

## 11. Delivery Phases

1. **Foundation:** auth, RBAC, masters, package master, member + tree, joining with E-Pin.
2. **Commerce:** inventory, depo/franchise, ordering, dispatch, repurchase.
3. **Compensation:** bonus engine, ledger, payout, TDS, reports.
4. **Engagement:** schemes/offers, achievements, email/SMS, support tickets, in-app announcements.
5. **Hardening:** KYC, joining package return, audit, load testing, hosting and handover.

---

## 12. Open Questions (confirm with client)

- Exact formulas, caps and cutoffs for each of the 12 bonuses (the document lists names only).
- Spillover and placement rules; binary matching ratio and carry-forward policy.
- Payment gateway and bank-transfer format for payouts.
- Which marked/circled items in the handwritten notes are in or out of scope (Leadership, Travel, Vehicle allowance bonuses are circled).
- Commercial terms, AMC and support SLA (listed in the table of contents but not in these pages).
- Whether Depo and Franchise get their own login panel.

---

## 13. Supabase Usage

Supabase is used **only as managed PostgreSQL**. Auth stays in our Express API (JWT + bcrypt + RBAC), so Supabase Auth is not used.

- **Connection:** the Express server connects with the Postgres connection string (use the pooled/transaction connection string for the app, the direct one for migrations). Keep it in `.env`, never in the repo.
- **Row Level Security:** Supabase exposes tables through an auto-generated REST API. Since the frontend never calls Supabase directly, **enable RLS on every table with no policies** so the public anon key cannot read anything. The backend connects with the database role and is unaffected.
- **Extensions:** enable `ltree` and `citext` from Dashboard -> Database -> Extensions.
- **Migrations:** keep SQL migrations in the repo (Prisma Migrate or Knex), run against a **dev** Supabase project and a separate **prod** project. Do not edit tables by hand in the dashboard.
- **Files (optional):** Supabase Storage (private bucket) can hold KYC documents instead of a server folder; serve through signed URLs.
- **Redis:** Supabase does not provide Redis. BullMQ needs one: use local Docker Redis for development and a hosted one (e.g. Upstash or Redis on the VPS) for production.
- **Free-tier caution:** free projects pause after inactivity and have size/connection limits; fine for development and demo, upgrade for production.

---

## 14. Team and GitHub Workflow (2 students)

**Repository:** one GitHub repo (monorepo with `/client` and `/server`, see section 10).

**Split of work (suggested, by vertical slice so you rarely touch the same files):**

| Student | Owns |
|---|---|
| Student A | Auth/RBAC, masters, members + tree, E-Pin, joining, KYC, commission engine, payout |
| Student B | Inventory, depo/franchise, orders and dispatch, schemes, notifications, tickets, announcements, reports |

Shared: DB schema decisions, API conventions, UI layout/components (agree these first).

**Branching:**
- `main` = stable, protected (no direct pushes; merge only via Pull Request).
- `develop` = integration branch (optional; skip it if you prefer simple PRs to `main`).
- Feature branches: `feature/<module>-<short-desc>` (e.g. `feature/epin-generate`), fixes: `fix/<desc>`.
- Small, frequent PRs; the **other student reviews** every PR before merge.

**Commit and PR rules:**
- Commit style: `feat: add e-pin generation`, `fix: tree placement bug`, `docs: update schema`.
- Rebase or merge `main` into your branch daily to avoid big conflicts.
- PR template: what changed, how to test, screenshots, DB migration included (yes/no).

**Database collaboration:**
- Migrations are code: one student creates a migration, pushes, the other pulls and runs it. Never change the shared database manually.
- Each student uses their **own dev Supabase project or schema** (or local Postgres via Docker) so experiments do not break the other; one shared **staging/prod** project updated only from `main`.
- Seed script (roles, bonus plans, Super Admin) committed to the repo.

**Secrets:** `.env` in `.gitignore`; commit `.env.example` with placeholder keys. Share real keys privately, never through GitHub. Add GitHub Secrets if you set up CI.

**Tooling:** ESLint + Prettier + Husky pre-commit; GitHub Actions to run lint and tests on every PR; GitHub Projects or Issues board for tasks (one issue per module/feature).

**Weekly rhythm:** short sync to demo merged work, agree next module, resolve API contract changes (document them in `/docs/API.md`).
