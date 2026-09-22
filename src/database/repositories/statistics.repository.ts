import { Database } from '../db.js';

export interface UserActivityStat {
  groupJid: string;
  userJid: string;
  userName: string;
  messageCount: number;
  lastMessageAt: number;
}

export class StatisticsRepository {
  constructor(private db: Database) {}

  public recordMessage(groupJid: string, userJid: string, userName: string, timestamp: number): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO user_statistics (group_jid, user_jid, user_name, message_count, last_message_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(group_jid, user_jid) DO UPDATE SET
        message_count = message_count + 1,
        user_name = excluded.user_name,
        last_message_at = excluded.last_message_at
    `);
    stmt.run(groupJid, userJid, userName, timestamp);
  }

  public getTopActiveUsers(groupJid: string, limit: number = 10): UserActivityStat[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT group_jid as groupJid, user_jid as userJid, user_name as userName,
             message_count as messageCount, last_message_at as lastMessageAt
      FROM user_statistics
      WHERE group_jid = ?
      ORDER BY message_count DESC
      LIMIT ?
    `);
    return stmt.all(groupJid, limit) as unknown as UserActivityStat[];
  }

  public getInactiveMembers(
    groupJid: string,
    thresholdMs: number,
    limit: number = 20
  ): UserActivityStat[] {
    const cutoffTime = Date.now() - thresholdMs;
    const stmt = this.db.sqlite.prepare(`
      SELECT group_jid as groupJid, user_jid as userJid, user_name as userName,
             message_count as messageCount, last_message_at as lastMessageAt
      FROM user_statistics
      WHERE group_jid = ? AND last_message_at < ?
      ORDER BY last_message_at ASC
      LIMIT ?
    `);
    return stmt.all(groupJid, cutoffTime, limit) as unknown as UserActivityStat[];
  }
}
