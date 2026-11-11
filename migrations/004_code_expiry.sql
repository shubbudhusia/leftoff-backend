-- Verification/login codes expire 24h after they're sent (the email says so).
-- The backend works without this column (falls back to an in-memory issue
-- time that resets on restart); adding it makes expiry survive restarts.
alter table extension_users
  add column if not exists verification_code_sent_at timestamptz;
