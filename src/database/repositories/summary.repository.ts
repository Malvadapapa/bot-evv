import { Database } from '../db.js';

export interface SummaryCheckpoint {
  groupJid: string;
  cycleDate: string;
  accumulatedSummary: string | null;
  lastMessageId: string | null;
  lastMessageTimestamp: number;
  updatedAt: number;
}

export class SummaryRepository {
  constructor(private db: Database) {}

  public getCheckpoint(groupJid: string): SummaryCheckpoint | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT group_jid as groupJid, cycle_date as cycleDate,
             accumulated_summary as accumulatedSummary,
             last_message_id as lastMessageId,
             last_message_timestamp as lastMessageTimestamp,
             updated_at as updatedAt
      FROM summary_checkpoints
      WHERE group_jid = ?
    `);
    const row = stmt.get(groupJid) as unknown as SummaryCheckpoint | undefined;
    return row || null;
  }

  public saveCheckpoint(cp: SummaryCheckpoint): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO summary_checkpoints (
        group_jid, cycle_date, accumulated_summary, last_message_id, last_message_timestamp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      cp.groupJid,
      cp.cycleDate,
      cp.accumulatedSummary,
      cp.lastMessageId,
      cp.lastMessageTimestamp,
      cp.updatedAt || Date.now()
    );
  }

  public resetCheckpoint(groupJid: string, newCycleDate: string): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO summary_checkpoints (
        group_jid, cycle_date, accumulated_summary, last_message_id, last_message_timestamp, updated_at
      ) VALUES (?, ?, NULL, NULL, 0, ?)
    `);
    stmt.run(groupJid, newCycleDate, Date.now());
  }

  public resetAllForNewDay(newCycleDate: string): void {
    const stmt = this.db.sqlite.prepare(`
      UPDATE summary_checkpoints
      SET cycle_date = ?, accumulated_summary = NULL, last_message_id = NULL, last_message_timestamp = 0, updated_at = ?
      WHERE cycle_date != ?
    `);
    stmt.run(newCycleDate, Date.now(), newCycleDate);
  }
}
