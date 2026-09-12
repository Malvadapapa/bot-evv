import { Database } from '../db.js';

export interface StoredMention {
  id: string;
  groupJid: string;
  messageId: string;
  mentionedUserJid: string;
  mentionedByUserJid: string;
  mentionedByName: string;
  messageContent: string;
  timestamp: number;
  createdAt?: number;
}

export class MentionRepository {
  constructor(private db: Database) {}

  public save(mention: StoredMention): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO mentions (
        id, group_jid, message_id, mentioned_user_jid, mentioned_by_user_jid,
        mentioned_by_name, message_content, timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      mention.id,
      mention.groupJid,
      mention.messageId,
      mention.mentionedUserJid,
      mention.mentionedByUserJid,
      mention.mentionedByName,
      mention.messageContent,
      mention.timestamp,
      mention.createdAt || Date.now()
    );
  }

  public getUserMentions(
    userJid: string,
    page: number = 1,
    pageSize: number = 5
  ): { mentions: StoredMention[]; total: number; totalPages: number } {
    const countStmt = this.db.sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM mentions
      WHERE mentioned_user_jid = ?
    `);
    const countRow = countStmt.get(userJid) as { count: number };
    const total = countRow?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const offset = Math.max(0, (page - 1) * pageSize);
    const selectStmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, message_id as messageId,
             mentioned_user_jid as mentionedUserJid, mentioned_by_user_jid as mentionedByUserJid,
             mentioned_by_name as mentionedByName, message_content as messageContent,
             timestamp, created_at as createdAt
      FROM mentions
      WHERE mentioned_user_jid = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);
    const mentions = selectStmt.all(userJid, pageSize, offset) as unknown as StoredMention[];

    return { mentions, total, totalPages };
  }

  public getLatestUserMention(groupJid: string, userJid: string): StoredMention | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT id, group_jid as groupJid, message_id as messageId,
             mentioned_user_jid as mentionedUserJid, mentioned_by_user_jid as mentionedByUserJid,
             mentioned_by_name as mentionedByName, message_content as messageContent,
             timestamp, created_at as createdAt
      FROM mentions
      WHERE group_jid = ? AND mentioned_user_jid = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(groupJid, userJid) as unknown as StoredMention | undefined;
    return row || null;
  }
}
