import { Database } from '../db.js';

export interface HoroscopeCacheEntry {
  cacheKey: string;
  dataJson: string;
  fetchedAt: number;
  expiresAt: number;
}

export class HoroscopeRepository {
  constructor(private db: Database) {}

  public getCached(cacheKey: string): string | null {
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      SELECT data_json as dataJson
      FROM horoscope_cache
      WHERE cache_key = ? AND expires_at > ?
      LIMIT 1
    `);
    const row = stmt.get(cacheKey, now) as { dataJson: string } | undefined;
    return row ? row.dataJson : null;
  }

  public setCached(cacheKey: string, dataJson: string, ttlMs: number = 6 * 60 * 60 * 1000): void {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO horoscope_cache (cache_key, data_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(cacheKey, dataJson, now, expiresAt);
  }

  public clearExpired(): void {
    const stmt = this.db.sqlite.prepare(`
      DELETE FROM horoscope_cache WHERE expires_at <= ?
    `);
    stmt.run(Date.now());
  }
}
