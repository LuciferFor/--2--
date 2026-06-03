export interface CacheStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  getBuffer(key: string): Promise<Buffer | null>;
  setBuffer(key: string, value: Buffer, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

interface Entry {
  value: string | Buffer;
  expiresAt: number;
}

export class MemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, Entry>();

  async getJson<T>(key: string): Promise<T | null> {
    const value = this.get(key);
    if (typeof value !== "string") {
      return null;
    }
    return JSON.parse(value) as T;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const value = this.get(key);
    return Buffer.isBuffer(value) ? value : null;
  }

  async setBuffer(key: string, value: Buffer, ttlSeconds: number): Promise<void> {
    this.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }

  private get(key: string): string | Buffer | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  private set(key: string, value: string | Buffer, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }
}
