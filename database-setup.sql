-- ============ LEFTOFF DATABASE SCHEMA ============
-- This SQL creates all necessary tables for complete user & payment tracking

-- 1. Users Installation & Profile
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(20),
  country VARCHAR(100),
  city VARCHAR(100),
  installation_date TIMESTAMP DEFAULT NOW(),
  extension_version VARCHAR(50),
  browser VARCHAR(50),
  browser_version VARCHAR(50),
  os VARCHAR(50),
  referral_source VARCHAR(255),
  device_type VARCHAR(50),
  language VARCHAR(50),
  user_status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, CHURNED
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Trial Tracking
CREATE TABLE IF NOT EXISTS trial_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  trial_start_date TIMESTAMP DEFAULT NOW(),
  trial_end_date TIMESTAMP,
  days_used INTEGER,
  days_remaining INTEGER,
  trial_status VARCHAR(50), -- ACTIVE, EXPIRED, CONVERTED
  videos_added_in_trial INTEGER DEFAULT 0,
  videos_watched_in_trial INTEGER DEFAULT 0,
  total_watch_time_hours DECIMAL(10, 2) DEFAULT 0,
  last_activity_date TIMESTAMP,
  active_days_in_trial INTEGER DEFAULT 0,
  engagement_score VARCHAR(50), -- LOW, MEDIUM, HIGH, VERY_HIGH
  trial_reminder_1_sent TIMESTAMP,
  trial_reminder_2_sent TIMESTAMP,
  conversion_likelihood VARCHAR(50), -- LOW, MEDIUM, HIGH, VERY_HIGH
  converted BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. User Activity & Engagement
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  total_videos_queued INTEGER DEFAULT 0,
  total_videos_watched INTEGER DEFAULT 0,
  abandoned_videos INTEGER DEFAULT 0,
  watch_rate_percentage DECIMAL(5, 2) DEFAULT 0,
  total_watch_time_hours DECIMAL(10, 2) DEFAULT 0,
  average_session_time_minutes DECIMAL(10, 2) DEFAULT 0,
  last_active_date TIMESTAMP,
  days_since_last_activity INTEGER,
  weekly_active_status VARCHAR(50), -- ACTIVE, INACTIVE
  top_category VARCHAR(255),
  feature_analytics_used BOOLEAN DEFAULT FALSE,
  feature_queue_used BOOLEAN DEFAULT FALSE,
  feature_notifications_used BOOLEAN DEFAULT FALSE,
  dark_mode_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Payments & Subscriptions
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  payment_id VARCHAR(255) UNIQUE,
  transaction_id VARCHAR(255), -- Razorpay or Stripe ID
  purchase_date TIMESTAMP DEFAULT NOW(),
  plan_type VARCHAR(50), -- MONTHLY, YEARLY, TRIAL
  billing_cycle VARCHAR(50),
  amount DECIMAL(10, 2),
  currency VARCHAR(10) DEFAULT 'INR', -- INR or USD
  tax DECIMAL(10, 2),
  total_paid DECIMAL(10, 2),
  payment_status VARCHAR(50), -- COMPLETED, FAILED, PENDING, REFUNDED
  payment_method VARCHAR(50), -- CARD, UPI, PAYPAL, etc
  payment_gateway VARCHAR(50), -- RAZORPAY, STRIPE
  plan_start_date TIMESTAMP,
  plan_end_date TIMESTAMP,
  auto_renewal_enabled BOOLEAN DEFAULT TRUE,
  days_until_expiry INTEGER,
  renewal_date TIMESTAMP,
  cancellation_date TIMESTAMP,
  cancellation_reason TEXT,
  lifetime_value DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Monthly Payment History
CREATE TABLE IF NOT EXISTS monthly_payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  month VARCHAR(50), -- "January 2024"
  plan_type VARCHAR(50),
  amount DECIMAL(10, 2),
  tax DECIMAL(10, 2),
  total DECIMAL(10, 2),
  payment_date TIMESTAMP,
  payment_status VARCHAR(50),
  transaction_id VARCHAR(255),
  days_active_in_month INTEGER,
  videos_watched_in_month INTEGER,
  currency VARCHAR(10) DEFAULT 'INR',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. Analytics Dashboard Cache
CREATE TABLE IF NOT EXISTS dashboard_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type VARCHAR(255), -- total_users, active_users, conversions, etc
  metric_value INTEGER,
  metric_value_decimal DECIMAL(10, 2),
  country VARCHAR(100), -- For filtering by region
  currency VARCHAR(10),
  date_recorded DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. Extension Events (for detailed tracking)
CREATE TABLE IF NOT EXISTS extension_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100), -- video_added, video_watched, payment, trial_started, etc
  event_data JSONB, -- Store flexible event data
  event_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_country ON users(country);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_trial_user_id ON trial_tracking(user_id);
CREATE INDEX idx_activity_user_id ON user_activity(user_id);
CREATE INDEX idx_events_user_id ON extension_events(user_id);
CREATE INDEX idx_events_date ON extension_events(event_date);
CREATE INDEX idx_monthly_history_user ON monthly_payment_history(user_id);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Create policies (adjust based on your auth setup)
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can view own payments" ON payments
  FOR SELECT USING (auth.uid()::text = user_id::text);
