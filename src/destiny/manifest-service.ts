import type { AppConfig } from "../config.js";
import type { Store } from "../db/store.js";
import { NotFoundError, UpstreamError } from "../lib/errors.js";
import { asRecord, asString } from "../lib/json.js";
import { BUNGIE_ROOT, COMMON_MANIFEST_ENTITY_TYPES } from "./constants.js";
import type { BungieClient } from "./bungie-client.js";

export interface DestinyDefinition {
  hash?: number;
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
  };
  [key: string]: unknown;
}

export interface ManifestResponse {
  version: string;
  jsonWorldComponentContentPaths?: Record<string, Record<string, string>>;
}

export class ManifestService {
  constructor(
    private readonly client: BungieClient,
    private readonly store: Store,
    private readonly config: Pick<AppConfig, "MANIFEST_LOCALE" | "BUNGIE_API_BASE_URL">
  ) {}

  async refresh(options: { preload?: boolean } = {}): Promise<void> {
    const manifest = await this.client.get<ManifestResponse>("/Destiny2/Manifest/");
    const paths = asRecord(manifest.jsonWorldComponentContentPaths)[this.config.MANIFEST_LOCALE] as
      | Record<string, string>
      | undefined;

    if (!paths) {
      throw new UpstreamError("Manifest locale is not available", {
        locale: this.config.MANIFEST_LOCALE
      });
    }

    const current = await this.store.getManifestVersion(this.config.MANIFEST_LOCALE);
    await this.store.upsertManifestVersion({
      locale: this.config.MANIFEST_LOCALE,
      version: manifest.version,
      jsonWorldComponentContentPaths: paths
    });

    if (options.preload && current?.version !== manifest.version) {
      await this.preloadCommonDefinitions(paths);
    }
  }

  async getDefinition<T extends DestinyDefinition = DestinyDefinition>(
    entityType: string,
    hashIdentifier: string | number | undefined | null
  ): Promise<T | null> {
    if (hashIdentifier === undefined || hashIdentifier === null) {
      return null;
    }

    const hash = String(hashIdentifier);
    const cached = await this.store.getManifestDefinition<T>(this.config.MANIFEST_LOCALE, entityType, hash);
    if (cached) {
      return cached;
    }

    try {
      const definition = await this.client.get<T>(`/Destiny2/Manifest/${entityType}/${hash}/`);
      await this.store.upsertManifestDefinition(this.config.MANIFEST_LOCALE, entityType, hash, definition);
      return definition;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      return null;
    }
  }

  async getDisplayName(
    entityType: string,
    hashIdentifier: string | number | undefined | null,
    fallback = "Unknown"
  ): Promise<string> {
    const definition = await this.getDefinition(entityType, hashIdentifier);
    return asString(definition?.displayProperties?.name, fallback);
  }

  async getIconPath(
    entityType: string,
    hashIdentifier: string | number | undefined | null
  ): Promise<string | null> {
    const definition = await this.getDefinition(entityType, hashIdentifier);
    const icon = definition?.displayProperties?.icon;
    return typeof icon === "string" && icon.length > 0 ? icon : null;
  }

  private async preloadCommonDefinitions(paths: Record<string, string>): Promise<void> {
    for (const entityType of COMMON_MANIFEST_ENTITY_TYPES) {
      const path = paths[entityType];
      if (!path) {
        continue;
      }

      await this.preloadDefinitionMap(entityType, path);
    }
  }

  private async preloadDefinitionMap(entityType: string, path: string): Promise<void> {
    const url = new URL(path, BUNGIE_ROOT);
    const response = await fetch(url);
    if (!response.ok) {
      throw new UpstreamError("Failed to download manifest definition map", {
        entityType,
        status: response.status
      });
    }

    const definitions = (await response.json()) as Record<string, DestinyDefinition>;
    for (const [hashIdentifier, definition] of Object.entries(definitions)) {
      await this.store.upsertManifestDefinition(this.config.MANIFEST_LOCALE, entityType, hashIdentifier, definition);
    }
  }
}
