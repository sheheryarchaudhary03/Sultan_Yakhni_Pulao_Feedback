-- Sultan Yakhni Pulao feedback: core schema.
-- Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- admins
CREATE TABLE admin_users (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       text        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,50}$'),
  password_hash  text        NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_admin_users_updated BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only a SHA-256 of the session token is stored, never the token itself.
CREATE TABLE admin_sessions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id  bigint      NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     bytea       NOT NULL UNIQUE,
  ip_address     inet,
  user_agent     text        CHECK (length(user_agent) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Sign-in lockouts and submission limits, shared by every app instance.
CREATE TABLE rate_limit_hits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket      text        NOT NULL CHECK (length(bucket) <= 30),
  key_hash    text        NOT NULL CHECK (length(key_hash) <= 64),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_lookup ON rate_limit_hits (bucket, key_hash, created_at);

-- ------------------------------------------------------------ responses
-- One row per submitted form. Every answer lives in `answers` (question key ->
-- option value, star count or list of values, as defined in questions.json);
-- the columns beside it are copies the dashboard filters and sorts on.
CREATE TABLE responses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code   text        NOT NULL UNIQUE CHECK (reference_code ~ '^SYP-[0-9]{6}-[A-Z0-9]{5}$'),
  branch           text        NOT NULL CHECK (branch ~ '^[a-z0-9-]{1,60}$'),
  service          text        NOT NULL CHECK (service IN ('dine_in', 'takeaway', 'delivery')),
  language         text        NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur')),
  food_rating      smallint    NOT NULL CHECK (food_rating BETWEEN 1 AND 5),
  would_return     text        CHECK (would_return IN ('yes', 'maybe', 'no')),
  needs_attention  boolean     NOT NULL DEFAULT false,
  issues           jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  answers          jsonb       NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  wants_offers     boolean     NOT NULL DEFAULT false,
  customer_name    text        CHECK (length(customer_name) <= 80),
  customer_phone   text        CHECK (length(customer_phone) <= 20),
  other_item       text        CHECK (length(other_item) <= 80),
  comments         text        CHECK (length(comments) <= 1000),
  status           text        NOT NULL DEFAULT 'new'
                               CHECK (status IN ('new', 'reviewed', 'actioned', 'archived')),
  admin_note       text        CHECK (length(admin_note) <= 2000),
  ip_hash          text        CHECK (length(ip_hash) <= 64),
  user_agent       text        CHECK (length(user_agent) <= 500),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT wants_offers OR customer_phone IS NOT NULL)
);
CREATE INDEX idx_responses_submitted ON responses (submitted_at DESC);
CREATE INDEX idx_responses_branch ON responses (branch, submitted_at DESC);
CREATE INDEX idx_responses_service ON responses (service);
CREATE INDEX idx_responses_status ON responses (status);
CREATE INDEX idx_responses_attention ON responses (submitted_at DESC) WHERE needs_attention;
CREATE TRIGGER trg_responses_updated BEFORE UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
