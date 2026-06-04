import pg from "pg";
import type {
  AdminAuditLogRow,
  ManifestStatus,
  ManifestVersionRecord,
  MetricsSummary,
  PageOptions,
  PaginatedResult,
  PlayerCacheRecord,
  PlayerRow,
  QqBindingRecord,
  QqBindingRow,
  QqOAuthTokenRecord,
  QqOAuthTokenRow,
  QueryLogRow,
  Store
} from "./store.js";

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

  async listPlayers(query: string | undefined, options: PageOptions): Promise<PaginatedResult<PlayerRow>> {
    const where = query ? "WHERE LOWER(bungie_name) LIKE LOWER($1) OR membership_id = $2" : "";
    const params = query ? [`%${query}%`, query] : [];
    const countResult = await this.pool.query(`SELECT COUNT(*)::int AS total FROM players ${where}`, params);
    const result = await this.pool.query(
      `
        SELECT id, bungie_name, display_name, display_name_code, membership_type, membership_id,
               icon_path, last_seen_at, created_at, updated_at
        FROM players
        ${where}
        ORDER BY last_seen_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, options.pageSize, offset(options)]
    );

    return {
      items: result.rows.map(mapPlayerRow),
      total: countResult.rows[0]?.total ?? 0,
      page: options.page,
      pageSize: options.pageSize
    };
  }

  async createQqBinding(binding: QqBindingRecord): Promise<QqBindingRow | null> {
    const result = await this.pool.query(
      `
        INSERT INTO qq_bindings (
          qq,
          membership_type,
          membership_id,
          bungie_name,
          display_name,
          display_name_code,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (qq) DO NOTHING
        RETURNING id, qq, membership_type, membership_id, bungie_name, display_name,
                  display_name_code, notes, last_resolved_at, created_at, updated_at
      `,
      [
        binding.qq,
        binding.membershipType,
        binding.membershipId,
        binding.bungieName ?? null,
        binding.displayName ?? null,
        binding.displayNameCode ?? null,
        binding.notes ?? null
      ]
    );

    return result.rows[0] ? mapQqBindingRow(result.rows[0]) : null;
  }

  async upsertQqBinding(binding: QqBindingRecord): Promise<QqBindingRow> {
    const result = await this.pool.query(
      `
        INSERT INTO qq_bindings (
          qq,
          membership_type,
          membership_id,
          bungie_name,
          display_name,
          display_name_code,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (qq)
        DO UPDATE SET
          membership_type = EXCLUDED.membership_type,
          membership_id = EXCLUDED.membership_id,
          bungie_name = EXCLUDED.bungie_name,
          display_name = EXCLUDED.display_name,
          display_name_code = EXCLUDED.display_name_code,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING id, qq, membership_type, membership_id, bungie_name, display_name,
                  display_name_code, notes, last_resolved_at, created_at, updated_at
      `,
      [
        binding.qq,
        binding.membershipType,
        binding.membershipId,
        binding.bungieName ?? null,
        binding.displayName ?? null,
        binding.displayNameCode ?? null,
        binding.notes ?? null
      ]
    );

    return mapQqBindingRow(result.rows[0]);
  }

  async getQqBinding(qq: string): Promise<QqBindingRow | null> {
    const result = await this.pool.query(
      `
        SELECT qb.id, qb.qq, qb.membership_type, qb.membership_id, qb.bungie_name, qb.display_name,
               qb.display_name_code, qb.notes, qb.last_resolved_at, qb.created_at, qb.updated_at,
               qot.bungie_membership_id AS oauth_bungie_membership_id,
               qot.access_expires_at AS oauth_access_expires_at,
               qot.refresh_expires_at AS oauth_refresh_expires_at,
               qot.revoked_at AS oauth_revoked_at,
               qot.updated_at AS oauth_updated_at
        FROM qq_bindings qb
        LEFT JOIN qq_oauth_tokens qot ON qot.qq = qb.qq
        WHERE qb.qq = $1
      `,
      [qq]
    );

    return result.rows[0] ? mapQqBindingRow(result.rows[0]) : null;
  }

  async listQqBindings(query: string | undefined, options: PageOptions): Promise<PaginatedResult<QqBindingRow>> {
    const where = query
      ? `WHERE qb.qq LIKE $1 OR qb.membership_id = $2 OR LOWER(COALESCE(qb.bungie_name, '')) LIKE LOWER($3) OR LOWER(COALESCE(qb.display_name, '')) LIKE LOWER($4)`
      : "";
    const params = query ? [`%${query}%`, query, `%${query}%`, `%${query}%`] : [];
    const countResult = await this.pool.query(`SELECT COUNT(*)::int AS total FROM qq_bindings qb ${where}`, params);
    const result = await this.pool.query(
      `
        SELECT qb.id, qb.qq, qb.membership_type, qb.membership_id, qb.bungie_name, qb.display_name,
               qb.display_name_code, qb.notes, qb.last_resolved_at, qb.created_at, qb.updated_at,
               qot.bungie_membership_id AS oauth_bungie_membership_id,
               qot.access_expires_at AS oauth_access_expires_at,
               qot.refresh_expires_at AS oauth_refresh_expires_at,
               qot.revoked_at AS oauth_revoked_at,
               qot.updated_at AS oauth_updated_at
        FROM qq_bindings qb
        LEFT JOIN qq_oauth_tokens qot ON qot.qq = qb.qq
        ${where}
        ORDER BY qb.updated_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, options.pageSize, offset(options)]
    );

    return {
      items: result.rows.map(mapQqBindingRow),
      total: countResult.rows[0]?.total ?? 0,
      page: options.page,
      pageSize: options.pageSize
    };
  }

  async deleteQqBinding(qq: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM qq_bindings WHERE qq = $1", [qq]);
    return (result.rowCount ?? 0) > 0;
  }

  async touchQqBinding(qq: string): Promise<void> {
    await this.pool.query("UPDATE qq_bindings SET last_resolved_at = NOW() WHERE qq = $1", [qq]);
  }

  async upsertQqOAuthToken(token: QqOAuthTokenRecord): Promise<QqOAuthTokenRow> {
    const result = await this.pool.query(
      `
        INSERT INTO qq_oauth_tokens (
          qq,
          bungie_membership_id,
          membership_type,
          membership_id,
          access_token_encrypted,
          refresh_token_encrypted,
          access_expires_at,
          refresh_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (qq)
        DO UPDATE SET
          bungie_membership_id = EXCLUDED.bungie_membership_id,
          membership_type = EXCLUDED.membership_type,
          membership_id = EXCLUDED.membership_id,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          access_expires_at = EXCLUDED.access_expires_at,
          refresh_expires_at = EXCLUDED.refresh_expires_at,
          revoked_at = NULL,
          updated_at = NOW()
        RETURNING id, qq, bungie_membership_id, membership_type, membership_id,
                  access_token_encrypted, refresh_token_encrypted, access_expires_at,
                  refresh_expires_at, revoked_at, created_at, updated_at
      `,
      [
        token.qq,
        token.bungieMembershipId,
        token.membershipType,
        token.membershipId,
        token.accessTokenEncrypted,
        token.refreshTokenEncrypted ?? null,
        token.accessExpiresAt,
        token.refreshExpiresAt ?? null
      ]
    );

    return mapQqOAuthTokenRow(result.rows[0]);
  }

  async getQqOAuthToken(qq: string): Promise<QqOAuthTokenRow | null> {
    const result = await this.pool.query(
      `
        SELECT id, qq, bungie_membership_id, membership_type, membership_id,
               access_token_encrypted, refresh_token_encrypted, access_expires_at,
               refresh_expires_at, revoked_at, created_at, updated_at
        FROM qq_oauth_tokens
        WHERE qq = $1
      `,
      [qq]
    );

    return result.rows[0] ? mapQqOAuthTokenRow(result.rows[0]) : null;
  }

  async revokeQqOAuthToken(qq: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE qq_oauth_tokens
        SET revoked_at = COALESCE(revoked_at, NOW()),
            updated_at = NOW()
        WHERE qq = $1
          AND revoked_at IS NULL
      `,
      [qq]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listQueryLogs(
    filters: { route?: string; cacheHit?: boolean },
    options: PageOptions
  ): Promise<PaginatedResult<QueryLogRow>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.route) {
      params.push(`%${filters.route}%`);
      clauses.push(`route LIKE $${params.length}`);
    }
    if (filters.cacheHit !== undefined) {
      params.push(filters.cacheHit);
      clauses.push(`cache_hit = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const countResult = await this.pool.query(`SELECT COUNT(*)::int AS total FROM query_logs ${where}`, params);
    const result = await this.pool.query(
      `
        SELECT id, route, cache_hit, ip_hash, created_at
        FROM query_logs
        ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, options.pageSize, offset(options)]
    );

    return {
      items: result.rows.map(mapQueryLogRow),
      total: countResult.rows[0]?.total ?? 0,
      page: options.page,
      pageSize: options.pageSize
    };
  }

  async getMetrics(filters: { from?: Date; to?: Date; interval: "hour" | "day" }): Promise<MetricsSummary> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.from) {
      params.push(filters.from);
      clauses.push(`created_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      clauses.push(`created_at <= $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const bucketExpr = filters.interval === "day" ? "date_trunc('day', created_at)" : "date_trunc('hour', created_at)";

    const [summary, topRoutes, points] = await Promise.all([
      this.pool.query(
        `
          SELECT COUNT(*)::int AS total_requests,
                 COALESCE(SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END), 0)::int AS cache_hits
          FROM query_logs
          ${where}
        `,
        params
      ),
      this.pool.query(
        `
          SELECT route, COUNT(*)::int AS total
          FROM query_logs
          ${where}
          GROUP BY route
          ORDER BY total DESC
          LIMIT 10
        `,
        params
      ),
      this.pool.query(
        `
          SELECT ${bucketExpr} AS bucket,
                 COUNT(*)::int AS total,
                 COALESCE(SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END), 0)::int AS cache_hits
          FROM query_logs
          ${where}
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
        params
      )
    ]);

    const totalRequests = summary.rows[0]?.total_requests ?? 0;
    const cacheHits = summary.rows[0]?.cache_hits ?? 0;
    return {
      totalRequests,
      cacheHits,
      cacheHitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 10000) / 100 : 0,
      topRoutes: topRoutes.rows.map((row) => ({ route: row.route, total: row.total })),
      points: points.rows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        total: row.total,
        cacheHits: row.cache_hits
      }))
    };
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

  async getManifestStatus(): Promise<ManifestStatus> {
    const result = await this.pool.query(
      `
        SELECT mv.locale,
               mv.version,
               mv.updated_at,
               COUNT(md.hash_identifier)::int AS definition_count
        FROM manifest_versions mv
        LEFT JOIN manifest_definitions md ON md.locale = mv.locale
        GROUP BY mv.locale, mv.version, mv.updated_at
        ORDER BY mv.updated_at DESC
      `
    );

    return {
      versions: result.rows.map((row) => ({
        locale: row.locale,
        version: row.version,
        updatedAt: row.updated_at.toISOString(),
        definitionCount: row.definition_count
      }))
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

  async logAdminAudit(entry: {
    actor: string;
    action: string;
    target?: string;
    ipHash?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO admin_audit_logs (actor, action, target, ip_hash, details)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [entry.actor, entry.action, entry.target ?? null, entry.ipHash ?? null, JSON.stringify(entry.details ?? {})]
    );
  }

  async listAdminAuditLogs(options: PageOptions): Promise<PaginatedResult<AdminAuditLogRow>> {
    const countResult = await this.pool.query("SELECT COUNT(*)::int AS total FROM admin_audit_logs");
    const result = await this.pool.query(
      `
        SELECT id, actor, action, target, ip_hash, details, created_at
        FROM admin_audit_logs
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [options.pageSize, offset(options)]
    );

    return {
      items: result.rows.map(mapAdminAuditLogRow),
      total: countResult.rows[0]?.total ?? 0,
      page: options.page,
      pageSize: options.pageSize
    };
  }

  async ping(): Promise<boolean> {
    await this.pool.query("SELECT 1");
    return true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function offset(options: PageOptions): number {
  return (options.page - 1) * options.pageSize;
}

function mapPlayerRow(row: Record<string, any>): PlayerRow {
  return {
    id: Number(row.id),
    bungieName: row.bungie_name,
    displayName: row.display_name,
    displayNameCode: row.display_name_code,
    membershipType: row.membership_type,
    membershipId: row.membership_id,
    iconPath: row.icon_path ?? undefined,
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapQueryLogRow(row: Record<string, any>): QueryLogRow {
  return {
    id: Number(row.id),
    route: row.route,
    cacheHit: row.cache_hit,
    ipHash: row.ip_hash ?? undefined,
    createdAt: row.created_at.toISOString()
  };
}

function mapQqBindingRow(row: Record<string, any>): QqBindingRow {
  return {
    id: Number(row.id),
    qq: row.qq,
    membershipType: row.membership_type,
    membershipId: row.membership_id,
    bungieName: row.bungie_name ?? undefined,
    displayName: row.display_name ?? undefined,
    displayNameCode: row.display_name_code ?? undefined,
    notes: row.notes ?? undefined,
    lastResolvedAt: row.last_resolved_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    oauth: row.oauth_bungie_membership_id
      ? {
          authorized: !row.oauth_revoked_at,
          bungieMembershipId: row.oauth_bungie_membership_id,
          accessExpiresAt: row.oauth_access_expires_at?.toISOString(),
          refreshExpiresAt: row.oauth_refresh_expires_at?.toISOString(),
          revokedAt: row.oauth_revoked_at?.toISOString(),
          updatedAt: row.oauth_updated_at?.toISOString()
        }
      : { authorized: false }
  };
}

function mapQqOAuthTokenRow(row: Record<string, any>): QqOAuthTokenRow {
  return {
    id: Number(row.id),
    qq: row.qq,
    bungieMembershipId: row.bungie_membership_id,
    membershipType: row.membership_type,
    membershipId: row.membership_id,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted ?? undefined,
    accessExpiresAt: row.access_expires_at.toISOString(),
    refreshExpiresAt: row.refresh_expires_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapAdminAuditLogRow(row: Record<string, any>): AdminAuditLogRow {
  return {
    id: Number(row.id),
    actor: row.actor,
    action: row.action,
    target: row.target ?? undefined,
    ipHash: row.ip_hash ?? undefined,
    details: row.details ?? {},
    createdAt: row.created_at.toISOString()
  };
}
