# Database Structure: Direct-Selling (MLM) Management System

PostgreSQL 15+. Money is `NUMERIC(14,2)`. All tables have `created_at`, `updated_at` (omitted below for brevity unless relevant). Primary keys are `BIGINT GENERATED ALWAYS AS IDENTITY` (or UUID if preferred).

---

## 1. Table Groups

| Group | Tables |
|---|---|
| Auth and masters | roles, users, refresh_tokens, company_info, locations, packages, package_items |
| Members and network | members, member_bank, kyc_documents, binary_volume, rank_master, member_ranks |
| E-Pin | epin_requests, epins |
| Inventory | product_categories, products, suppliers, couriers, purchase_orders, purchase_order_items, stock_inward, stock_inward_items, stock_returns, stock_ledger, stock_transfers, stock_transfer_items, pcr |
| Orders | orders, order_items, dispatches, joining_package_deliveries, package_returns |
| Compensation | bonus_plans, commission_ledger, payout_cycles, payouts, tds_records, bank_transfers |
| Schemes | schemes, scheme_qualifiers |
| Communication | notifications, tickets, ticket_messages, messages, announcements, documents, faqs |
| System | audit_logs, sequences |

---

## 2. ER Overview (key relationships)

```
roles 1─* users 1─1 members *─1 members (sponsor_id)
members *─1 members (parent_id, binary placement L/R)
members 1─* kyc_documents        members 1─1 member_bank
packages 1─* package_items *─1 products
epins *─1 packages               epins *─1 members (issued_to / used_by)
locations (WAREHOUSE|DEPO|FRANCHISE) 1─* stock_ledger *─1 products
purchase_orders 1─* purchase_order_items ─▶ stock_inward ─▶ stock_ledger
stock_transfers (from_location ─▶ to_location) 1─* stock_transfer_items
members 1─* orders 1─* order_items ; orders 1─1 dispatches
orders ─▶ commission_ledger ◀─ bonus_plans
members 1─* commission_ledger ─▶ payouts *─1 payout_cycles ─▶ bank_transfers
schemes 1─* scheme_qualifiers *─1 members
```

---

## 3. DDL

### 3.1 Auth and Masters

```sql
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,   -- SUPER_ADMIN, ADMIN, DISTRIBUTOR, DEPO, FRANCHISE
  name        TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id       BIGINT NOT NULL REFERENCES roles(id),
  login_id      TEXT UNIQUE NOT NULL,
  email         CITEXT UNIQUE,
  mobile        TEXT,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, BLOCKED
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE company_info (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, address TEXT, gstin TEXT, pan TEXT,
  email TEXT, phone TEXT, logo_url TEXT, settings JSONB DEFAULT '{}'
);

CREATE TABLE locations (            -- location master + stock holders
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type      TEXT NOT NULL,          -- WAREHOUSE, DEPO, FRANCHISE
  name      TEXT NOT NULL,
  state     TEXT, city TEXT, pincode TEXT, address TEXT,
  owner_user_id BIGINT REFERENCES users(id),  -- depo/franchise login
  active    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE packages (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      TEXT NOT NULL,
  price     NUMERIC(14,2) NOT NULL,
  bv        NUMERIC(14,2) NOT NULL DEFAULT 0,   -- business volume
  active    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE package_items (
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,                    -- FK added after products
  qty        INT NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id, product_id)
);
```

### 3.2 Members and Network

```sql
CREATE TABLE members (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_code   TEXT UNIQUE NOT NULL,            -- public distributor ID
  user_id       BIGINT UNIQUE NOT NULL REFERENCES users(id),
  sponsor_id    BIGINT REFERENCES members(id),   -- generation tree
  parent_id     BIGINT REFERENCES members(id),   -- binary tree
  position      CHAR(1) CHECK (position IN ('L','R')),
  path          LTREE NOT NULL,                  -- binary materialized path
  depth         INT NOT NULL DEFAULT 0,
  sponsor_path  LTREE,                           -- generation path
  package_id    BIGINT REFERENCES packages(id),
  full_name     TEXT NOT NULL,
  dob           DATE, gender TEXT,
  address       TEXT, state TEXT, city TEXT, pincode TEXT,
  pan_no        TEXT,                            -- encrypt at app level
  aadhaar_no    TEXT,                            -- encrypt at app level
  kyc_status    TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
  status        TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, INACTIVE, BLOCKED
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, position)                   -- one L and one R child per node
);
CREATE INDEX idx_members_path ON members USING GIST (path);
CREATE INDEX idx_members_sponsor_path ON members USING GIST (sponsor_path);
CREATE INDEX idx_members_sponsor ON members(sponsor_id);
CREATE INDEX idx_members_state_city ON members(state, city);

CREATE TABLE member_bank (
  member_id  BIGINT PRIMARY KEY REFERENCES members(id),
  account_name TEXT, account_no TEXT, ifsc TEXT, bank_name TEXT, branch TEXT
);

CREATE TABLE kyc_documents (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id),
  doc_type    TEXT NOT NULL,                -- PAN, AADHAAR, BANK_PROOF
  file_url    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  remarks     TEXT,
  reviewed_by BIGINT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);

-- running left/right volume per member for binary matching
CREATE TABLE binary_volume (
  member_id        BIGINT PRIMARY KEY REFERENCES members(id),
  left_volume      NUMERIC(14,2) NOT NULL DEFAULT 0,
  right_volume     NUMERIC(14,2) NOT NULL DEFAULT 0,
  left_carry       NUMERIC(14,2) NOT NULL DEFAULT 0,
  right_carry      NUMERIC(14,2) NOT NULL DEFAULT 0,
  left_count       INT NOT NULL DEFAULT 0,
  right_count      INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rank_master (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, level INT NOT NULL, criteria JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE member_ranks (
  member_id BIGINT NOT NULL REFERENCES members(id),
  rank_id   BIGINT NOT NULL REFERENCES rank_master(id),
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, rank_id)
);
```

### 3.3 E-Pin

```sql
CREATE TABLE epin_requests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id),
  package_id  BIGINT NOT NULL REFERENCES packages(id),
  qty         INT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, APPROVED, REJECTED
  processed_by BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE epins (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  package_id  BIGINT NOT NULL REFERENCES packages(id),
  status      TEXT NOT NULL DEFAULT 'GENERATED', -- GENERATED, ISSUED, USED, BLOCKED
  request_id  BIGINT REFERENCES epin_requests(id),
  issued_to   BIGINT REFERENCES members(id),
  issued_at   TIMESTAMPTZ,
  used_by     BIGINT REFERENCES members(id),
  used_at     TIMESTAMPTZ,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epins_status ON epins(status, issued_to);
```

### 3.4 Inventory

```sql
CREATE TABLE product_categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, active BOOLEAN DEFAULT true
);

CREATE TABLE products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES product_categories(id),
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  mrp         NUMERIC(14,2) NOT NULL,
  dp_price    NUMERIC(14,2) NOT NULL,        -- distributor price
  bv          NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  hsn_code    TEXT,
  image_url   TEXT,
  active      BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE package_items
  ADD CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products(id);

CREATE TABLE suppliers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, contact_person TEXT, mobile TEXT, email TEXT,
  gstin TEXT, address TEXT, active BOOLEAN DEFAULT true
);

CREATE TABLE couriers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, contact TEXT, tracking_url_template TEXT, active BOOLEAN DEFAULT true
);

CREATE TABLE purchase_orders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_no       TEXT UNIQUE NOT NULL,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN, PARTIAL, CLOSED, CANCELLED
  total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE purchase_order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INT NOT NULL, rate NUMERIC(14,2) NOT NULL,
  received_qty INT NOT NULL DEFAULT 0
);

CREATE TABLE stock_inward (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inward_no TEXT UNIQUE NOT NULL,
  mode TEXT NOT NULL,                        -- PO_WISE, SUPPLIER_WISE
  po_id BIGINT REFERENCES purchase_orders(id),
  supplier_id BIGINT REFERENCES suppliers(id),
  location_id BIGINT NOT NULL REFERENCES locations(id),
  invoice_no TEXT, received_by BIGINT REFERENCES users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE stock_inward_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inward_id BIGINT NOT NULL REFERENCES stock_inward(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INT NOT NULL, batch_no TEXT, expiry_date DATE
);

CREATE TABLE stock_returns (            -- return to supplier
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_no TEXT UNIQUE NOT NULL,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  location_id BIGINT NOT NULL REFERENCES locations(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INT NOT NULL, reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- single source of truth for stock: balance = SUM(qty_change)
CREATE TABLE stock_ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  qty_change  INT NOT NULL,               -- + in, - out
  txn_type    TEXT NOT NULL,              -- INWARD, RETURN, TRANSFER_OUT, TRANSFER_IN,
                                          -- SALE, JOINING_DISPATCH, RESALE, PKG_RETURN, ADJUST
  ref_type    TEXT, ref_id BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_ledger ON stock_ledger(location_id, product_id);

CREATE TABLE stock_transfers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_no TEXT UNIQUE NOT NULL,
  from_location BIGINT NOT NULL REFERENCES locations(id),
  to_location   BIGINT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'SENT',   -- SENT, ACCEPTED, REJECTED
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ, accepted_by BIGINT REFERENCES users(id)
);
CREATE TABLE stock_transfer_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty_sent INT NOT NULL, qty_accepted INT
);

CREATE TABLE pcr (                      -- depo/franchise purchase/credit request
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(id),
  items JSONB NOT NULL,                 -- [{product_id, qty}]
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.5 Orders and Dispatch

```sql
CREATE TABLE orders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no    TEXT UNIQUE NOT NULL,
  member_id   BIGINT NOT NULL REFERENCES members(id),
  location_id BIGINT NOT NULL REFERENCES locations(id),  -- fulfilling depo/franchise
  type        TEXT NOT NULL,            -- JOINING, REPURCHASE, RESALE
  subtotal    NUMERIC(14,2) NOT NULL,
  gst_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total       NUMERIC(14,2) NOT NULL,
  total_bv    NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_mode TEXT,                    -- WALLET, EPIN, ONLINE, CASH (TBC)
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  status      TEXT NOT NULL DEFAULT 'PLACED', -- PLACED, CONFIRMED, DISPATCHED, DELIVERED, CANCELLED
  epin_id     BIGINT REFERENCES epins(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_member ON orders(member_id, created_at DESC);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INT NOT NULL, price NUMERIC(14,2) NOT NULL,
  bv NUMERIC(14,2) NOT NULL DEFAULT 0, gst_percent NUMERIC(5,2) DEFAULT 0
);

CREATE TABLE dispatches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id),
  courier_id BIGINT REFERENCES couriers(id),
  tracking_no TEXT, dispatched_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE joining_package_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  package_id BIGINT NOT NULL REFERENCES packages(id),
  location_id BIGINT REFERENCES locations(id),
  courier_id BIGINT REFERENCES couriers(id), tracking_no TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING, DISPATCHED, DELIVERED
  delivered_at TIMESTAMPTZ
);

CREATE TABLE package_returns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  delivery_id BIGINT REFERENCES joining_package_deliveries(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED',  -- REQUESTED, CONFIRMED, REJECTED
  confirmed_by BIGINT REFERENCES users(id), confirmed_at TIMESTAMPTZ
);
```

### 3.6 Compensation and Payout

```sql
CREATE TABLE bonus_plans (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      TEXT UNIQUE NOT NULL,   -- RETAIL, FIRST_ORDER, FIRST_TRACK, E_VOUCHER,
                                    -- PERFORMANCE, LEADERSHIP, ROYALTY, TRAVEL,
                                    -- VEHICLE, HOUSE, DEPO_COMM, FRANCHISE_COMM
  name      TEXT NOT NULL,
  frequency TEXT NOT NULL,          -- REALTIME, DAILY, WEEKLY, MONTHLY
  config    JSONB NOT NULL DEFAULT '{}',   -- rates, caps, levels
  active    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE payout_cycles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_from DATE NOT NULL, period_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN, CALCULATED, APPROVED, PAID
  approved_by BIGINT REFERENCES users(id), approved_at TIMESTAMPTZ
);

-- append-only: never UPDATE/DELETE amounts; reverse with a negative row
CREATE TABLE commission_ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id),
  bonus_code  TEXT NOT NULL REFERENCES bonus_plans(code),
  amount      NUMERIC(14,2) NOT NULL,         -- negative for reversals
  cycle_id    BIGINT REFERENCES payout_cycles(id),
  source_type TEXT, source_ref TEXT NOT NULL, -- idempotency key
  from_member_id BIGINT REFERENCES members(id),
  level       INT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, bonus_code, source_ref)
);
CREATE INDEX idx_comm_member_cycle ON commission_ledger(member_id, cycle_id);

CREATE TABLE payouts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cycle_id    BIGINT NOT NULL REFERENCES payout_cycles(id),
  member_id   BIGINT NOT NULL REFERENCES members(id),
  gross       NUMERIC(14,2) NOT NULL,
  tds         NUMERIC(14,2) NOT NULL DEFAULT 0,
  admin_charge NUMERIC(14,2) NOT NULL DEFAULT 0,
  net         NUMERIC(14,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'CALCULATED', -- CALCULATED, HELD_KYC, APPROVED, PAID
  UNIQUE (cycle_id, member_id)
);

CREATE TABLE tds_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payout_id BIGINT NOT NULL REFERENCES payouts(id),
  member_id BIGINT NOT NULL REFERENCES members(id),
  pan_no TEXT, rate NUMERIC(5,2), amount NUMERIC(14,2), fin_year TEXT
);

CREATE TABLE bank_transfers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payout_id BIGINT NOT NULL REFERENCES payouts(id),
  account_no TEXT, ifsc TEXT, amount NUMERIC(14,2) NOT NULL,
  utr_no TEXT, status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
  paid_at TIMESTAMPTZ
);
```

### 3.7 Schemes and Achievements

```sql
CREATE TABLE schemes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, description TEXT,
  target_type TEXT NOT NULL,          -- BV, DIRECTS, NEW_JOINING, REPURCHASE
  target_value NUMERIC(14,2) NOT NULL,
  reward TEXT NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE scheme_qualifiers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheme_id BIGINT NOT NULL REFERENCES schemes(id),
  member_id BIGINT NOT NULL REFERENCES members(id),
  progress NUMERIC(14,2) NOT NULL DEFAULT 0,
  qualified BOOLEAN NOT NULL DEFAULT false,
  qualified_at TIMESTAMPTZ,
  UNIQUE (scheme_id, member_id)
);
```

### 3.8 Communication and System

```sql
CREATE TABLE notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  channel TEXT NOT NULL,              -- EMAIL, SMS, INAPP
  template TEXT, subject TEXT, body TEXT, recipient TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED, SENT, FAILED
  error TEXT, sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
  priority TEXT DEFAULT 'NORMAL', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ticket_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_user_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (               -- member <-> admin / member compose
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES users(id),
  to_user_id BIGINT NOT NULL REFERENCES users(id),
  subject TEXT, body TEXT, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE announcements (          -- in-app news, events, achievers, gallery
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL,                 -- NEWS, EVENT, ACHIEVER, GALLERY
  title TEXT NOT NULL, body TEXT, media_url TEXT,
  event_date DATE, published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL, file_url TEXT NOT NULL,
  audience TEXT DEFAULT 'ALL', uploaded_by BIGINT REFERENCES users(id)
);
CREATE TABLE faqs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question TEXT NOT NULL, answer TEXT NOT NULL, sort_order INT DEFAULT 0
);

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id),
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  before JSONB, after JSONB, ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sequences (               -- human-readable numbers (member code, PO no, order no)
  name TEXT PRIMARY KEY, prefix TEXT, next_value BIGINT NOT NULL DEFAULT 1
);
```

---

## 4. Useful Queries and Views

```sql
-- Entire binary downline of member 42
SELECT m.* FROM members m
JOIN members me ON me.id = 42
WHERE m.path <@ me.path AND m.id <> me.id;

-- Stock on hand per location/product
CREATE VIEW v_stock AS
SELECT location_id, product_id, SUM(qty_change) AS qty
FROM stock_ledger GROUP BY location_id, product_id;

-- Member commission balance (not yet paid)
CREATE VIEW v_member_commission AS
SELECT member_id, bonus_code, SUM(amount) AS total
FROM commission_ledger GROUP BY member_id, bonus_code;
```

---

## 5. Design Rules

- **Ledgers are append-only** (`stock_ledger`, `commission_ledger`). Corrections and returns are new, opposite rows.
- **Idempotency:** `commission_ledger UNIQUE(member_id, bonus_code, source_ref)` prevents double bonuses when a job retries.
- **Transactions:** joining, order payment, stock transfer acceptance and payout approval each run in one DB transaction.
- **Tree integrity:** `UNIQUE(parent_id, position)` enforces max two binary children; set `path` as `parent.path || id` on insert.
- **Sensitive data:** encrypt PAN, Aadhaar and bank numbers at the application layer; never log them.
- **Money:** `NUMERIC(14,2)` only, no floats.
- **Soft state, not deletes:** use `status` columns; hard deletes only for non-financial data.
- **Indexes:** GiST on `path`, composite on ledgers, partial indexes on `status` where queues scan (e.g. `epins`, `notifications`).
- **Migrations:** manage with Prisma Migrate or Knex; keep seed scripts for roles, bonus plans and super admin.

---

## 6. Assumptions to Confirm

- Order payment modes and wallet requirement (a `wallets` table may be needed if members hold a balance).
- Whether `members.path` uses the binary tree only or both trees need separate paths (both are included above).
- Exact bonus configuration shape in `bonus_plans.config` once formulas are provided.
- GST handling (intra vs inter-state split) and invoice numbering.

---

## 7. Supabase Notes

- Hosted on Supabase PostgreSQL. Enable `ltree` and `citext` extensions (Dashboard -> Database -> Extensions) before running the DDL.
- **Enable RLS on all tables** with no policies. The app talks to Postgres only through the Express backend, so the public anon key must not be able to read data via Supabase's auto REST API.
- Run migrations with the direct connection string; use the pooled connection string for the running app.
- Use separate Supabase projects (or local Postgres) for each student's development, and one for staging/prod.
- Keep the schema as migration files in Git (`/server/prisma` or `/migrations`); never edit tables manually in the dashboard.
- Supabase Auth is **not** used; `users` and `refresh_tokens` tables above handle authentication.
