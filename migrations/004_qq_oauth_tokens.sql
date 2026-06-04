CREATE TABLE IF NOT EXISTS qq_oauth_tokens (
  id BIGSERIAL PRIMARY KEY,
  qq TEXT NOT NULL UNIQUE REFERENCES qq_bindings(qq) ON DELETE CASCADE,
  bungie_membership_id TEXT NOT NULL,
  membership_type SMALLINT NOT NULL,
  membership_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qq_oauth_tokens_qq_format_chk CHECK (qq ~ '^[0-9]{5,15}$')
);

CREATE INDEX IF NOT EXISTS qq_oauth_tokens_membership_idx ON qq_oauth_tokens (membership_type, membership_id);
CREATE INDEX IF NOT EXISTS qq_oauth_tokens_refresh_expires_idx ON qq_oauth_tokens (refresh_expires_at);
