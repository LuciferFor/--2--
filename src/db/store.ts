export interface PlayerCacheRecord {
  bungieName: string;
  displayName: string;
  displayNameCode: number;
  membershipType: number;
  membershipId: string;
  iconPath?: string;
}

export interface ManifestVersionRecord {
  locale: string;
  version: string;
  jsonWorldComponentContentPaths: Record<string, unknown>;
}

export interface PageOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlayerRow extends PlayerCacheRecord {
  id: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueryLogRow {
  id: number;
  route: string;
  cacheHit: boolean;
  ipHash?: string;
  createdAt: string;
}

export interface QqBindingRecord {
  qq: string;
  membershipType: number;
  membershipId: string;
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
  notes?: string;
}

export interface QqBindingRow extends QqBindingRecord {
  id: number;
  lastResolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditLogRow {
  id: number;
  actor: string;
  action: string;
  target?: string;
  ipHash?: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface MetricsPoint {
  bucket: string;
  total: number;
  cacheHits: number;
}

export interface MetricsSummary {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  topRoutes: Array<{ route: string; total: number }>;
  points: MetricsPoint[];
}

export interface ManifestStatus {
  versions: Array<{
    locale: string;
    version: string;
    updatedAt: string;
    definitionCount: number;
  }>;
}

export interface Store {
  upsertPlayer(player: PlayerCacheRecord): Promise<void>;
  logQuery(route: string, cacheHit: boolean, ipHash?: string): Promise<void>;
  listPlayers(query: string | undefined, options: PageOptions): Promise<PaginatedResult<PlayerRow>>;
  createQqBinding(binding: QqBindingRecord): Promise<QqBindingRow | null>;
  upsertQqBinding(binding: QqBindingRecord): Promise<QqBindingRow>;
  getQqBinding(qq: string): Promise<QqBindingRow | null>;
  listQqBindings(query: string | undefined, options: PageOptions): Promise<PaginatedResult<QqBindingRow>>;
  deleteQqBinding(qq: string): Promise<boolean>;
  touchQqBinding(qq: string): Promise<void>;
  listQueryLogs(
    filters: { route?: string; cacheHit?: boolean },
    options: PageOptions
  ): Promise<PaginatedResult<QueryLogRow>>;
  getMetrics(filters: { from?: Date; to?: Date; interval: "hour" | "day" }): Promise<MetricsSummary>;
  getManifestVersion(locale: string): Promise<ManifestVersionRecord | null>;
  getManifestStatus(): Promise<ManifestStatus>;
  upsertManifestVersion(record: ManifestVersionRecord): Promise<void>;
  getManifestDefinition<T>(locale: string, entityType: string, hashIdentifier: string): Promise<T | null>;
  upsertManifestDefinition<T>(
    locale: string,
    entityType: string,
    hashIdentifier: string,
    definition: T
  ): Promise<void>;
  logAdminAudit(entry: {
    actor: string;
    action: string;
    target?: string;
    ipHash?: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
  listAdminAuditLogs(options: PageOptions): Promise<PaginatedResult<AdminAuditLogRow>>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class NullStore implements Store {
  private readonly versions = new Map<string, ManifestVersionRecord>();
  private readonly definitions = new Map<string, unknown>();
  private readonly players: PlayerRow[] = [];
  private readonly queryLogs: QueryLogRow[] = [];
  private readonly qqBindings: QqBindingRow[] = [];
  private readonly auditLogs: AdminAuditLogRow[] = [];

  async upsertPlayer(player: PlayerCacheRecord): Promise<void> {
    const existing = this.players.find(
      (row) => row.membershipType === player.membershipType && row.membershipId === player.membershipId
    );
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, player, { lastSeenAt: now, updatedAt: now });
      return;
    }
    this.players.push({
      id: this.players.length + 1,
      ...player,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  async logQuery(route: string, cacheHit: boolean, ipHash?: string): Promise<void> {
    this.queryLogs.push({
      id: this.queryLogs.length + 1,
      route,
      cacheHit,
      ipHash,
      createdAt: new Date().toISOString()
    });
  }

  async listPlayers(query: string | undefined, options: PageOptions): Promise<PaginatedResult<PlayerRow>> {
    const normalized = query?.toLowerCase();
    const rows = normalized
      ? this.players.filter((player) => player.bungieName.toLowerCase().includes(normalized))
      : this.players;
    return paginate(rows, options);
  }

  async createQqBinding(binding: QqBindingRecord): Promise<QqBindingRow | null> {
    if (this.qqBindings.some((row) => row.qq === binding.qq)) {
      return null;
    }
    const row = this.makeQqBindingRow(binding);
    this.qqBindings.push(row);
    return row;
  }

  async upsertQqBinding(binding: QqBindingRecord): Promise<QqBindingRow> {
    const existing = this.qqBindings.find((row) => row.qq === binding.qq);
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, binding, {
        bungieName: binding.bungieName,
        displayName: binding.displayName,
        displayNameCode: binding.displayNameCode,
        notes: binding.notes,
        updatedAt: now
      });
      return existing;
    }
    const row = this.makeQqBindingRow(binding);
    this.qqBindings.push(row);
    return row;
  }

  async getQqBinding(qq: string): Promise<QqBindingRow | null> {
    return this.qqBindings.find((row) => row.qq === qq) ?? null;
  }

  async listQqBindings(query: string | undefined, options: PageOptions): Promise<PaginatedResult<QqBindingRow>> {
    const normalized = query?.toLowerCase();
    const rows = normalized
      ? this.qqBindings.filter((binding) => {
          return (
            binding.qq.includes(normalized) ||
            binding.membershipId.includes(normalized) ||
            binding.bungieName?.toLowerCase().includes(normalized) ||
            binding.displayName?.toLowerCase().includes(normalized)
          );
        })
      : this.qqBindings;
    return paginate([...rows].reverse(), options);
  }

  async deleteQqBinding(qq: string): Promise<boolean> {
    const index = this.qqBindings.findIndex((row) => row.qq === qq);
    if (index < 0) {
      return false;
    }
    this.qqBindings.splice(index, 1);
    return true;
  }

  async touchQqBinding(qq: string): Promise<void> {
    const existing = this.qqBindings.find((row) => row.qq === qq);
    if (existing) {
      existing.lastResolvedAt = new Date().toISOString();
    }
  }

  async listQueryLogs(
    filters: { route?: string; cacheHit?: boolean },
    options: PageOptions
  ): Promise<PaginatedResult<QueryLogRow>> {
    const rows = this.queryLogs.filter((row) => {
      const routeMatch = filters.route ? row.route.includes(filters.route) : true;
      const cacheMatch = filters.cacheHit === undefined ? true : row.cacheHit === filters.cacheHit;
      return routeMatch && cacheMatch;
    });
    return paginate(rows, options);
  }

  async getMetrics(): Promise<MetricsSummary> {
    const totalRequests = this.queryLogs.length;
    const cacheHits = this.queryLogs.filter((row) => row.cacheHit).length;
    return {
      totalRequests,
      cacheHits,
      cacheHitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 10000) / 100 : 0,
      topRoutes: [],
      points: []
    };
  }

  async getManifestVersion(locale: string): Promise<ManifestVersionRecord | null> {
    return this.versions.get(locale) ?? null;
  }

  async getManifestStatus(): Promise<ManifestStatus> {
    return {
      versions: [...this.versions.values()].map((version) => ({
        locale: version.locale,
        version: version.version,
        updatedAt: new Date().toISOString(),
        definitionCount: [...this.definitions.keys()].filter((key) => key.startsWith(`${version.locale}:`)).length
      }))
    };
  }

  async upsertManifestVersion(record: ManifestVersionRecord): Promise<void> {
    this.versions.set(record.locale, record);
  }

  async getManifestDefinition<T>(locale: string, entityType: string, hashIdentifier: string): Promise<T | null> {
    return (this.definitions.get(this.key(locale, entityType, hashIdentifier)) as T | undefined) ?? null;
  }

  async upsertManifestDefinition<T>(
    locale: string,
    entityType: string,
    hashIdentifier: string,
    definition: T
  ): Promise<void> {
    this.definitions.set(this.key(locale, entityType, hashIdentifier), definition);
  }

  async logAdminAudit(entry: {
    actor: string;
    action: string;
    target?: string;
    ipHash?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    this.auditLogs.push({
      id: this.auditLogs.length + 1,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      ipHash: entry.ipHash,
      details: entry.details ?? {},
      createdAt: new Date().toISOString()
    });
  }

  async listAdminAuditLogs(options: PageOptions): Promise<PaginatedResult<AdminAuditLogRow>> {
    return paginate([...this.auditLogs].reverse(), options);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.versions.clear();
    this.definitions.clear();
    this.players.length = 0;
    this.queryLogs.length = 0;
    this.qqBindings.length = 0;
    this.auditLogs.length = 0;
  }

  private makeQqBindingRow(binding: QqBindingRecord): QqBindingRow {
    const now = new Date().toISOString();
    return {
      id: this.qqBindings.length + 1,
      ...binding,
      createdAt: now,
      updatedAt: now
    };
  }

  private key(locale: string, entityType: string, hashIdentifier: string): string {
    return `${locale}:${entityType}:${hashIdentifier}`;
  }
}

function paginate<T>(rows: T[], options: PageOptions): PaginatedResult<T> {
  const start = (options.page - 1) * options.pageSize;
  return {
    items: rows.slice(start, start + options.pageSize),
    total: rows.length,
    page: options.page,
    pageSize: options.pageSize
  };
}
