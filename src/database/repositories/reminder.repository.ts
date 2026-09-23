import { Database } from '../db.js';

export interface ScheduledReminder {
  id: string;
  groupJid: string;
  createdByJid: string;
  createdByName: string;
  targetJid?: string | null;
  targetName?: string | null;
  message: string;
  targetTimestamp: number;
  status: 'pending' | 'sent' | 'cancelled';
  createdAt: number;
  sentAt?: number | null;
}

export class ReminderRepository {
  constructor(private db: Database) {}

  public createReminder(reminder: ScheduledReminder): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO scheduled_reminders (
        id, group_jid, created_by_jid, created_by_name,
        target_jid, target_name, message, target_timestamp,
        status, created_at, sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      reminder.id,
      reminder.groupJid,
      reminder.createdByJid,
      reminder.createdByName,
      reminder.targetJid || null,
      reminder.targetName || null,
      reminder.message,
      reminder.targetTimestamp,
      reminder.status || 'pending',
      reminder.createdAt || Date.now(),
      reminder.sentAt || null
    );
  }

  public countActiveByUser(userJid: string): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM scheduled_reminders
      WHERE created_by_jid = ? AND status = 'pending'
    `);
    const row = stmt.get(userJid) as { count: number } | undefined;
    return row?.count || 0;
  }

  public getDueReminders(nowTimestamp: number = Date.now()): ScheduledReminder[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        group_jid as groupJid,
        created_by_jid as createdByJid,
        created_by_name as createdByName,
        target_jid as targetJid,
        target_name as targetName,
        message,
        target_timestamp as targetTimestamp,
        status,
        created_at as createdAt,
        sent_at as sentAt
      FROM scheduled_reminders
      WHERE status = 'pending' AND target_timestamp <= ?
      ORDER BY target_timestamp ASC
    `);

    return stmt.all(nowTimestamp) as unknown as ScheduledReminder[];
  }

  public markAsSent(id: string, sentAt: number = Date.now()): boolean {
    const stmt = this.db.sqlite.prepare(`
      UPDATE scheduled_reminders
      SET status = 'sent', sent_at = ?
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(sentAt, id);
    return (result.changes ?? 0) > 0;
  }

  public cancelReminder(
    id: string,
    cancelledByJid?: string,
    isAdmin: boolean = false
  ): { success: boolean; error?: string } {
    const reminder = this.getById(id);
    if (!reminder) {
      return { success: false, error: 'Recordatorio no encontrado.' };
    }
    if (reminder.status !== 'pending') {
      return { success: false, error: `El recordatorio ya figura como ${reminder.status}.` };
    }

    if (!isAdmin && cancelledByJid && reminder.createdByJid !== cancelledByJid) {
      return { success: false, error: 'Solo el creador o un administrador pueden cancelar este recordatorio.' };
    }

    const stmt = this.db.sqlite.prepare(`
      UPDATE scheduled_reminders
      SET status = 'cancelled'
      WHERE id = ?
    `);
    stmt.run(id);
    return { success: true };
  }

  public getActiveRemindersByGroup(groupJid: string): ScheduledReminder[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        group_jid as groupJid,
        created_by_jid as createdByJid,
        created_by_name as createdByName,
        target_jid as targetJid,
        target_name as targetName,
        message,
        target_timestamp as targetTimestamp,
        status,
        created_at as createdAt,
        sent_at as sentAt
      FROM scheduled_reminders
      WHERE group_jid = ? AND status = 'pending'
      ORDER BY target_timestamp ASC
    `);

    return stmt.all(groupJid) as unknown as ScheduledReminder[];
  }

  public getAllActiveReminders(): ScheduledReminder[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        group_jid as groupJid,
        created_by_jid as createdByJid,
        created_by_name as createdByName,
        target_jid as targetJid,
        target_name as targetName,
        message,
        target_timestamp as targetTimestamp,
        status,
        created_at as createdAt,
        sent_at as sentAt
      FROM scheduled_reminders
      WHERE status = 'pending'
      ORDER BY target_timestamp ASC
    `);

    return stmt.all() as unknown as ScheduledReminder[];
  }

  public getById(id: string): ScheduledReminder | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        group_jid as groupJid,
        created_by_jid as createdByJid,
        created_by_name as createdByName,
        target_jid as targetJid,
        target_name as targetName,
        message,
        target_timestamp as targetTimestamp,
        status,
        created_at as createdAt,
        sent_at as sentAt
      FROM scheduled_reminders
      WHERE id = ?
      LIMIT 1
    `);

    const row = stmt.get(id) as unknown as ScheduledReminder | undefined;
    return row || null;
  }
}
