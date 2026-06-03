import pg from "pg";
import type { ManifestVersionRecord, PlayerCacheRecord, Store } from "./store.js";

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10
    });
  }

  async upsertPlayer(player: PlayerCacheRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO players (
          bungie_name,
          display_name,
          display_name_code,
          membership_type,
          membership_id,
          icon_path
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (membership_type, membership_id)
        DO UPDATE SET
          bungie_name = EXCLUDED.bungie_name,
          display_name = EXCLUDED.display_name,
          display_name_code = EXCLUDED.display_name_code,
          icon_path = EXCLUDED.icon_path,
          last_seen_at = NOW(),
          updated_at = NOW()
      `,
      [
        player.bungieName,
        player.displayName,
        player.displayNameCode,
        player.membershipType,
        player.membershipId,
        player.iconPath ?? null
      ]
    );
  }

  async logQuery(route: string, cacheHit: boolean, ipHash?: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO query_logs (route, cache_hit, ip_hash) VALUES ($1, $2, $3)",
      [route, cacheHit, ipHash ?? null]
    );
  }

  async getManifestVersion(locale: string): Promise<ManifestVersionRecord | null> {
    const result = await this.pool.query(
      `
        SELECT locale, version, json_world_component_content_paths
        FROM manifest_versions
        WHERE locale = $1
      `,
      [locale]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      locale: row.locale,
      version: row.version,
      jsonWorldComponentContentPaths: row.json_world_component_content_paths
    };
  }

  async upsertManifestVersion(record: ManifestVersionRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO manifest_versions (locale, version, json_world_component_content_paths)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (locale)
        DO UPDATE SET
          version = EXCLUDED.version,
          json_world_component_content_paths = EXCLUDED.json_world_component_content_paths,
          updated_at = NOW()
      `,
      [record.locale, record.version, JSON.stringify(record.jsonWorldComponentContentPaths)]
    );
  }

  async getManifestDefinition<T>(locale: string, entityType: string, hashIdentifier: string): Promise<T | null> {
    const result = await this.pool.query(
      `
        SELECT definition
        FROM manifest_definitions
        WHERE locale = $1
          AND entity_type = $2
          AND hash_identifier = $3
      `,
      [locale, entityType, hashIdentifier]
    );

    return (result.rows[0]?.definition as T | undefined) ?? null;
  }

  async upsertManifestDefinition<T>(
    locale: string,
    entityType: string,
    hashIdentifier: string,
    definition: T
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO manifest_definitions (locale, entity_type, hash_identifier, definition)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (locale, entity_type, hash_identifier)
        DO UPDATE SET definition = EXCLUDED.definition, updated_at = NOW()
      `,
      [locale, entityType, hashIdentifier, JSON.stringify(definition)]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
