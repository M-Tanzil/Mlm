-- 005: support ticket categories / assignment / resolution, and announcement audience / schedule (Task #26).
-- Additive and safe to re-run: new columns are nullable or have defaults, so every existing row stays valid.
--   tickets.category      what the ticket is about (list of allowed values lives in the application)
--   tickets.assigned_to   support staff user handling the ticket
--   tickets.resolved_at / resolution   set when the ticket is RESOLVED or CLOSED, cleared if it is reopened
--   announcements.audience     ALL, DISTRIBUTOR or DEPO (DEPO covers depo and franchise logins)
--   announcements.starts_at / expires_at   visible window; NULL = no limit on that side
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS assigned_to BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution TEXT;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_window_check') THEN
    ALTER TABLE announcements
      ADD CONSTRAINT announcements_window_check CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_member ON tickets(member_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
