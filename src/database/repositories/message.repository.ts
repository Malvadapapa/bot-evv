import { Database } from '../db.js';

export interface StoredMessage {
  id: string;
  groupJid: string;
  senderJid: string;
  senderName: string;
  content: string;
  timestamp: number;
  rawQuoted?: string;
  createdAt?: number;
}

export class MessageRepository {
  constructor(private db: Database) {}

  public save(msg: StoredMessage): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO messages (
        id, group_jid, sender_jid, sender_name, content, timestamp, raw_quoted, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      msg.id,
      msg.groupJid,
      msg.senderJid,
      msg.senderName,
      msg.content,
      msg.timestamp,
      msg.rawQuoted || null,
      msg.createdAt || Date.now()
    );
  }

  public getMessagesSince(groupJid: string, sinceTimestamp: number, limit: number = 200): StoredMessage[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, sender_jid as senderJid, sender_name as senderName,
             content, timestamp, raw_quoted as rawQuoted, created_at as createdAt
      FROM messages
      WHERE group_jid = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    return stmt.all(groupJid, sinceTimestamp, limit) as unknown as StoredMessage[];
  }

  public getMessagesForDay(groupJid: string, startTimestamp: number, endTimestamp: number): StoredMessage[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, sender_jid as senderJid, sender_name as senderName,
             content, timestamp, raw_quoted as rawQuoted, created_at as createdAt
      FROM messages
      WHERE group_jid = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(groupJid, startTimestamp, endTimestamp) as unknown as StoredMessage[];
  }

  public getContextAround(
    groupJid: string,
    targetTimestamp: number,
    beforeCount: number = 3,
    afterCount: number = 3
  ): { before: StoredMessage[]; after: StoredMessage[] } {
    const beforeStmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, sender_jid as senderJid, sender_name as senderName,
             content, timestamp, raw_quoted as rawQuoted, created_at as createdAt
      FROM messages
      WHERE group_jid = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const beforeRaw = beforeStmt.all(groupJid, targetTimestamp, beforeCount) as unknown as StoredMessage[];
    const before = beforeRaw.reverse();

    const afterStmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, sender_jid as senderJid, sender_name as senderName,
             content, timestamp, raw_quoted as rawQuoted, created_at as createdAt
      FROM messages
      WHERE group_jid = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    const after = afterStmt.all(groupJid, targetTimestamp, afterCount) as unknown as StoredMessage[];

    return { before, after };
  }

  public getLastHumanMessageTimestamp(groupJid: string, botCleanJid: string): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT timestamp
      FROM messages
      WHERE group_jid = ? AND sender_jid != ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(groupJid, botCleanJid) as { timestamp: number } | undefined;
    return row?.timestamp || 0;
  }

  public getRecentMessages(groupJid: string, limit: number = 6): StoredMessage[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, sender_jid as senderJid, sender_name as senderName,
             content, timestamp, raw_quoted as rawQuoted, created_at as createdAt
      FROM messages
      WHERE group_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(groupJid, limit) as unknown as StoredMessage[];
    return rows.reverse();
  }

  public findUserJidByName(groupJid: string, namePart: string): string | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT sender_jid
      FROM messages
      WHERE group_jid = ? AND LOWER(sender_name) LIKE ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(groupJid, `%${namePart.toLowerCase()}%`) as { sender_jid: string } | undefined;
    return row?.sender_jid || null;
  }

  public getMessageCountBySender(senderJid: string): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM messages
      WHERE sender_jid = ?
    `);
    const row = stmt.get(senderJid) as { count: number } | undefined;
    return row?.count || 0;
  }
}
