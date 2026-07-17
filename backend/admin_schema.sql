-- TreeMind AI — Admin Dashboard schema
-- Run this in the Supabase SQL editor or via pg client.

CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  display_name  TEXT,
  monthly_limit INT NOT NULL DEFAULT 20,
  is_disabled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (user_id, display_name, monthly_limit)
SELECT 'default', 'Default User', 20
WHERE NOT EXISTS (SELECT 1 FROM users WHERE user_id = 'default')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO users (user_id, display_name, monthly_limit)
SELECT 'alpha', 'Alpha', 20
WHERE NOT EXISTS (SELECT 1 FROM users WHERE user_id = 'alpha')
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO app_settings (key, value) VALUES
  ('global_monthly_limit', '20'),
  ('gemini_api_key',       ''),
  ('nvidia_api_key',       ''),
  ('apify_token',          ''),
  ('app_password',         '')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT,
  action     TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION auto_register_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO users (user_id, display_name, monthly_limit)
  VALUES (NEW.user_id, NEW.user_id, 20)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_register_user ON notes;
CREATE TRIGGER trg_auto_register_user
  AFTER INSERT ON notes
  FOR EACH ROW
  EXECUTE FUNCTION auto_register_user();
