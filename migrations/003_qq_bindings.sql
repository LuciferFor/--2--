CREATE TABLE IF NOT EXISTS qq_bindings (
  id BIGSERIAL PRIMARY KEY,
  qq TEXT NOT NULL UNIQUE,
  membership_type INTEGER NOT NULL,
  membership_id TEXT NOT NULL,
  bungie_name TEXT,
  display_name TEXT,
  display_name_code SMALLINT,
  notes TEXT,
  last_resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qq_bindings_qq_format_chk CHECK (qq ~ '^[0-9]{5,15}$')
);

CREATE INDEX IF NOT EXISTS qq_bindings_membership_idx ON qq_bindings (membership_type, membership_id);
CREATE INDEX IF NOT EXISTS qq_bindings_bungie_name_idx ON qq_bindings (LOWER(bungie_name));
