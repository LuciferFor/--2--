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

export interface Store {
  upsertPlayer(player: PlayerCacheRecord): Promise<void>;
  logQuery(route: string, cacheHit: boolean, ipHash?: string): Promise<void>;
  getManifestVersion(locale: string): Promise<ManifestVersionRecord | null>;
  upsertManifestVersion(record: ManifestVersionRecord): Promise<void>;
  getManifestDefinition<T>(locale: string, entityType: string, hashIdentifier: string): Promise<T | null>;
  upsertManifestDefinition<T>(
    locale: string,
    entityType: string,
    hashIdentifier: string,
    definition: T
  ): Promise<void>;
  close(): Promise<void>;
}

export class NullStore implements Store {
  private readonly versions = new Map<string, ManifestVersionRecord>();
  private readonly definitions = new Map<string, unknown>();

  async upsertPlayer(): Promise<void> {
    return;
  }

  async logQuery(): Promise<void> {
    return;
  }

  async getManifestVersion(locale: string): Promise<ManifestVersionRecord | null> {
    return this.versions.get(locale) ?? null;
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

  async close(): Promise<void> {
    this.versions.clear();
    this.definitions.clear();
  }

  private key(locale: string, entityType: string, hashIdentifier: string): string {
    return `${locale}:${entityType}:${hashIdentifier}`;
  }
}
