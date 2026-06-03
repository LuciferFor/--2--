import { Redis } from "ioredis";
import type { CacheStore } from "./cache.js";

export class RedisCacheStore implements CacheStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status === "wait") {
      await this.redis.connect();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    await this.connect();
    const value = await this.redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.connect();
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    await this.connect();
    const value = await this.redis.getBuffer(key);
    return value && value.length > 0 ? value : null;
  }

  async setBuffer(key: string, value: Buffer, ttlSeconds: number): Promise<void> {
    await this.connect();
    await this.redis.set(key, value, "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.connect();
    await this.redis.del(key);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
