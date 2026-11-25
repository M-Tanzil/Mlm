-- 006: indexes on foreign keys and filters that list / detail pages use (Task #27-29). Additive and safe to re-run: no data changes.
-- Postgres does not index foreign keys by itself. Measured on 200k-600k synthetic rows (tests/perf-indexes.mjs): 10x-77x faster lookups.
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);                       -- order detail, cancel, delete cascade
CREATE INDEX IF NOT EXISTS idx_orders_location_status ON orders(location_id, status, created_at DESC);  -- depo / admin order lists
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);             -- ticket conversation
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);            -- my in-app notifications
CREATE INDEX IF NOT EXISTS idx_jpd_member_package ON joining_package_deliveries(member_id, package_id);  -- duplicate-delivery check
CREATE INDEX IF NOT EXISTS idx_package_returns_delivery ON package_returns(delivery_id, status); -- live-return check, return status per delivery
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_location, status);       -- depo incoming transfers
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_location, status);
CREATE INDEX IF NOT EXISTS idx_pcr_location ON pcr(location_id, status);                         -- depo stock requests
CREATE INDEX IF NOT EXISTS idx_stock_inward_po ON stock_inward(po_id);                           -- PO receiving
CREATE INDEX IF NOT EXISTS idx_stock_inward_supplier_invoice ON stock_inward(supplier_id, invoice_no);  -- duplicate supplier invoice check
