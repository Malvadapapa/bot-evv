import { Database } from '../db.js';

export class JobExecutionRepository {
  constructor(private db: Database) {}

  public isJobExecuted(jobKey: string): boolean {
    const stmt = this.db.sqlite.prepare(`
      SELECT 1 FROM job_executions WHERE job_key = ? LIMIT 1
    `);
    const row = stmt.get(jobKey);
    return Boolean(row);
  }

  public recordJobExecution(jobKey: string, groupJid: string, executedAt: number = Date.now()): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO job_executions (job_key, group_jid, executed_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(jobKey, groupJid, executedAt);
  }
}
