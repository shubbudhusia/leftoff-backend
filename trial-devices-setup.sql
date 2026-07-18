-- ============ ANONYMOUS DEVICE TRIALS ============
-- Tracks trials by device fingerprint so "try first, sign up later"
-- can't be reset by uninstalling/reinstalling the extension.
-- The server is authoritative: the FIRST recorded trial dates always win.

CREATE TABLE IF NOT EXISTS trial_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint VARCHAR(64) UNIQUE NOT NULL,     -- SHA-256 hash of device traits (anonymous)
  trial_start_date TIMESTAMP DEFAULT NOW(),
  trial_end_date TIMESTAMP NOT NULL,
  first_seen TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW(),
  check_count INTEGER DEFAULT 1,               -- how many times this device phoned home
  converted_email VARCHAR(255),                -- set when the device later signs up
  extension_version VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_devices_fingerprint ON trial_devices(fingerprint);
CREATE INDEX IF NOT EXISTS idx_trial_devices_end_date ON trial_devices(trial_end_date);
