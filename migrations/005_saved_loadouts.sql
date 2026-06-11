CREATE TABLE IF NOT EXISTS saved_loadouts (
  id BIGSERIAL PRIMARY KEY,
  qq TEXT NOT NULL REFERENCES qq_bindings(qq) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class_name TEXT,
  character_id TEXT,
  source TEXT NOT NULL DEFAULT 'current_equipped',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  stat_mods JSONB NOT NULL DEFAULT '[]'::jsonb,
  fragments JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  last_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_loadouts_qq_format_chk CHECK (qq ~ '^[0-9]{5,15}$'),
  CONSTRAINT saved_loadouts_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT saved_loadouts_source_nonempty_chk CHECK (length(trim(source)) > 0),
  CONSTRAINT saved_loadouts_unique_name UNIQUE (qq, name)
);

CREATE INDEX IF NOT EXISTS saved_loadouts_qq_idx ON saved_loadouts (qq, updated_at DESC);
CREATE INDEX IF NOT EXISTS saved_loadouts_class_idx ON saved_loadouts (qq, class_name);
