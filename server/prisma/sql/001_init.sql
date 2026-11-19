-- 001_init: full schema (from docs/Database.md section 3)
-- Run once in Supabase Dashboard -> SQL Editor (after enabling ltree + citext).

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

CREATE VIEW v_stock AS
SELECT location_id, product_id, SUM(qty_change) AS qty
FROM stock_ledger GROUP BY location_id, product_id;

CREATE VIEW v_member_commission AS
SELECT member_id, bonus_code, SUM(amount) AS total
FROM commission_ledger GROUP BY member_id, bonus_code;
