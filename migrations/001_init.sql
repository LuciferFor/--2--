CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  bungie_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  display_name_code SMALLINT NOT NULL,
  membership_type INTEGER NOT NULL,
  membership_id TEXT NOT NULL,
  icon_path TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membership_type, membership_id)
);

CREATE INDEX IF NOT EXISTS players_bungie_name_idx ON players (LOWER(bungie_name));

CREATE TABLE IF NOT EXISTS query_logs (
  id BIGSERIAL PRIMARY KEY,
  route TEXT NOT NULL,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manifest_versions (
  locale TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  json_world_component_content_paths JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manifest_definitions (
  locale TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  hash_identifier TEXT NOT NULL,
  definition JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (locale, entity_type, hash_identifier)
);
