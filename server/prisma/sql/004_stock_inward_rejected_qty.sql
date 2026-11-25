-- 004: record goods rejected at receiving (Task #13). Additive and safe to re-run.
-- stock_inward_items.qty stays the ACCEPTED quantity (the only part that enters stock);
-- rejected_qty is what was refused (damaged, wrong item...). Existing rows get 0.
ALTER TABLE stock_inward_items
  ADD COLUMN IF NOT EXISTS rejected_qty INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_inward_items_rejected_qty_check') THEN
    ALTER TABLE stock_inward_items
      ADD CONSTRAINT stock_inward_items_rejected_qty_check CHECK (rejected_qty >= 0);
  END IF;
END $$;
