import { Database } from '../db.js';

export class NewsRepository {
  constructor(private db: Database) {}

  public isNewsPublished(id: string): boolean {
    const stmt = this.db.sqlite.prepare(`
      SELECT 1 FROM published_news WHERE id = ? LIMIT 1
    `);
    const row = stmt.get(id);
    return Boolean(row);
  }

  public recordNewsPublished(id: string, title: string, source: string, publishedAt: number = Date.now()): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO published_news (id, title, source, published_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, title, source, publishedAt);
  }
}
