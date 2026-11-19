-- Run after 002. Roles + 12 bonus plans.
INSERT INTO roles (code, name) VALUES
  ('SUPER_ADMIN','Super Admin'), ('ADMIN','Admin'), ('DISTRIBUTOR','Distributor'),
  ('DEPO','Depo'), ('FRANCHISE','Franchise')
ON CONFLICT (code) DO NOTHING;

INSERT INTO bonus_plans (code, name, frequency) VALUES
  ('RETAIL','Retail Bonus','REALTIME'), ('FIRST_ORDER','First Order Bonus','REALTIME'),
  ('FIRST_TRACK','First Track Bonus','REALTIME'), ('E_VOUCHER','E-Voucher Point','REALTIME'),
  ('PERFORMANCE','Performance Bonus','WEEKLY'), ('LEADERSHIP','Leadership Development Bonus','MONTHLY'),
  ('ROYALTY','Royalty Bonus','MONTHLY'), ('TRAVEL','Travel Allowance Bonus','MONTHLY'),
  ('VEHICLE','Vehicle Allowance Bonus','MONTHLY'), ('HOUSE','House Allowance Bonus','MONTHLY'),
  ('DEPO_COMM','Depo Commission','MONTHLY'), ('FRANCHISE_COMM','Franchise Commission','MONTHLY')
ON CONFLICT (code) DO NOTHING;

-- Super Admin: generate a bcrypt hash of your password first (e.g. https://bcrypt-generator.com, 12 rounds),
-- paste it below, uncomment and run.
-- INSERT INTO users (role_id, login_id, password_hash)
-- SELECT id, 'superadmin', '<PASTE_BCRYPT_HASH>' FROM roles WHERE code = 'SUPER_ADMIN';
