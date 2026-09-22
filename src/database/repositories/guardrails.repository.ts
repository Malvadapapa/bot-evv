import { Database } from '../db.js';

export interface GroupJoinRequest {
  id: string;
  groupJid: string;
  groupName: string;
  invitedByJid: string;
  invitedByPhone: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
}

export interface CommandAuditEntry {
  id: string;
  userJid: string;
  userName: string;
  userPhone: string;
  groupJid: string;
  command: string;
  timestamp: number;
  result: 'allowed' | 'blocked';
  blockReason?: string;
}

export interface UserAlias {
  id?: number;
  userPhone: string;
  userJid: string;
  alias: string;
  addedBy: string;
  createdAt: number;
}

export class GuardrailsRepository {
  constructor(private db: Database) {}

  // ============================================================
  // 1. Configuración Dinámica (system_config)
  // ============================================================

  public getConfig(key: string, defaultValue: string = ''): string {
    const stmt = this.db.sqlite.prepare(`
      SELECT value FROM system_config WHERE key = ? LIMIT 1
    `);
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  }

  public setConfig(key: string, value: string): void {
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(key, value, now);
  }

  public getAllConfig(): Record<string, string> {
    const stmt = this.db.sqlite.prepare(`SELECT key, value FROM system_config`);
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  // ============================================================
  // 2. Administradores (admin_users)
  // ============================================================

  public addAdmin(phone: string, jid: string = '', addedBy: string = 'system'): void {
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanJid = jid || `${cleanPhone}@s.whatsapp.net`;
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO admin_users (phone, jid, added_by, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET jid = excluded.jid
    `);
    stmt.run(cleanPhone, cleanJid, addedBy, now);
  }

  public removeAdmin(phone: string): boolean {
    const cleanPhone = phone.replace(/\D/g, '');
    const stmt = this.db.sqlite.prepare(`
      DELETE FROM admin_users WHERE phone = ? OR phone LIKE ?
    `);
    const result = stmt.run(cleanPhone, `%${cleanPhone}`);
    return (result.changes ?? 0) > 0;
  }

  public getAllAdmins(): Array<{ phone: string; jid: string | null; addedBy: string; createdAt: number }> {
    const stmt = this.db.sqlite.prepare(`
      SELECT phone, jid, added_by as addedBy, created_at as createdAt
      FROM admin_users
      ORDER BY created_at ASC
    `);
    return stmt.all() as any[];
  }

  public isAdmin(phoneOrJid: string): boolean {
    if (!phoneOrJid) return false;
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    const stmt = this.db.sqlite.prepare(`
      SELECT 1 FROM admin_users
      WHERE phone = ? OR jid = ? OR phone LIKE ? OR ? LIKE '%' || phone
      LIMIT 1
    `);
    const row = stmt.get(cleanPhone, phoneOrJid, `%${cleanPhone}`, cleanPhone);
    return Boolean(row);
  }

  // ============================================================
  // 3. Grupos Autorizados (authorized_groups)
  // ============================================================

  public isGroupAuthorized(groupJid: string): boolean {
    if (!groupJid) return false;
    const stmt = this.db.sqlite.prepare(`
      SELECT 1 FROM authorized_groups WHERE group_jid = ? LIMIT 1
    `);
    return Boolean(stmt.get(groupJid));
  }

  public authorizeGroup(groupJid: string, groupName: string, authorizedBy: string = 'system', introSent: boolean = false): void {
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO authorized_groups (group_jid, group_name, authorized_at, authorized_by, intro_sent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(group_jid) DO UPDATE SET
        group_name = excluded.group_name,
        intro_sent = CASE WHEN excluded.intro_sent = 1 THEN 1 ELSE authorized_groups.intro_sent END
    `);
    stmt.run(groupJid, groupName, now, authorizedBy, introSent ? 1 : 0);
  }

  public deauthorizeGroup(groupJid: string): void {
    const stmt = this.db.sqlite.prepare(`
      DELETE FROM authorized_groups WHERE group_jid = ?
    `);
    stmt.run(groupJid);
  }

  public isIntroSent(groupJid: string): boolean {
    const stmt = this.db.sqlite.prepare(`
      SELECT intro_sent as introSent FROM authorized_groups WHERE group_jid = ? LIMIT 1
    `);
    const row = stmt.get(groupJid) as { introSent: number } | undefined;
    return Boolean(row && row.introSent === 1);
  }

  public markIntroSent(groupJid: string): void {
    const stmt = this.db.sqlite.prepare(`
      UPDATE authorized_groups SET intro_sent = 1 WHERE group_jid = ?
    `);
    stmt.run(groupJid);
  }

  public getAllAuthorizedGroups(): Array<{ groupJid: string; groupName: string; introSent: boolean }> {
    const stmt = this.db.sqlite.prepare(`
      SELECT group_jid as groupJid, group_name as groupName, intro_sent as introSent
      FROM authorized_groups
    `);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({ ...r, introSent: Boolean(r.introSent) }));
  }

  // ============================================================
  // 4. Solicitudes de Ingreso a Grupos (group_join_requests)
  // ============================================================

  public createJoinRequest(request: {
    id: string;
    groupJid: string;
    groupName: string;
    invitedByJid: string;
    invitedByPhone: string;
    expiresAt: number;
  }): void {
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO group_join_requests (
        id, group_jid, group_name, invited_by_jid, invited_by_phone, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    stmt.run(
      request.id,
      request.groupJid,
      request.groupName,
      request.invitedByJid,
      request.invitedByPhone,
      now,
      request.expiresAt
    );
  }

  public getJoinRequest(id: string): GroupJoinRequest | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id, group_jid as groupJid, group_name as groupName,
        invited_by_jid as invitedByJid, invited_by_phone as invitedByPhone,
        status, created_at as createdAt, expires_at as expiresAt,
        resolved_at as resolvedAt, resolved_by as resolvedBy
      FROM group_join_requests
      WHERE id = ? COLLATE NOCASE
      LIMIT 1
    `);
    return (stmt.get(id) as unknown as GroupJoinRequest) || null;
  }

  public getPendingRequestByGroup(groupJid: string): GroupJoinRequest | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id, group_jid as groupJid, group_name as groupName,
        invited_by_jid as invitedByJid, invited_by_phone as invitedByPhone,
        status, created_at as createdAt, expires_at as expiresAt,
        resolved_at as resolvedAt, resolved_by as resolvedBy
      FROM group_join_requests
      WHERE group_jid = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return (stmt.get(groupJid) as unknown as GroupJoinRequest) || null;
  }

  public updateJoinRequestStatus(
    id: string,
    status: 'approved' | 'rejected' | 'expired',
    resolvedBy: string = 'admin'
  ): void {
    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      UPDATE group_join_requests
      SET status = ?, resolved_at = ?, resolved_by = ?
      WHERE id = ? COLLATE NOCASE
    `);
    stmt.run(status, now, resolvedBy, id);
  }

  public getExpiredPendingRequests(now: number = Date.now()): GroupJoinRequest[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id, group_jid as groupJid, group_name as groupName,
        invited_by_jid as invitedByJid, invited_by_phone as invitedByPhone,
        status, created_at as createdAt, expires_at as expiresAt
      FROM group_join_requests
      WHERE status = 'pending' AND expires_at <= ?
    `);
    return stmt.all(now) as unknown as GroupJoinRequest[];
  }

  public getAllPendingRequests(): GroupJoinRequest[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id, group_jid as groupJid, group_name as groupName,
        invited_by_jid as invitedByJid, invited_by_phone as invitedByPhone,
        status, created_at as createdAt, expires_at as expiresAt
      FROM group_join_requests
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `);
    return stmt.all() as unknown as GroupJoinRequest[];
  }

  // ============================================================
  // 5. Rate Limiting de Comandos y Auditoría (command_audit_log)
  // ============================================================

  public logCommand(entry: CommandAuditEntry): void {
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO command_audit_log (
        id, user_jid, user_name, user_phone, group_jid, command, timestamp, result, block_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.userJid,
      entry.userName,
      entry.userPhone,
      entry.groupJid,
      entry.command,
      entry.timestamp,
      entry.result,
      entry.blockReason || null
    );
  }

  public getRecentCommandCount(userJid: string, sinceTimestamp: number): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM command_audit_log
      WHERE user_jid = ? AND timestamp >= ? AND result = 'allowed'
    `);
    const row = stmt.get(userJid, sinceTimestamp) as { cnt: number };
    return row ? row.cnt : 0;
  }

  public getLastAllowedCommandTimestamp(userJid: string): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT timestamp FROM command_audit_log
      WHERE user_jid = ? AND result = 'allowed'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(userJid) as { timestamp: number } | undefined;
    return row ? row.timestamp : 0;
  }

  // ============================================================
  // 6. Batería Social (social_battery_logs)
  // ============================================================

  public recordSocialInteraction(userJid: string, timestamp: number = Date.now()): void {
    const id = `soc-${userJid}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO social_battery_logs (id, user_jid, timestamp)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, userJid, timestamp);
  }

  public getSocialInteractionCount(userJid: string, sinceTimestamp: number): number {
    const stmt = this.db.sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM social_battery_logs
      WHERE user_jid = ? AND timestamp >= ?
    `);
    const row = stmt.get(userJid, sinceTimestamp) as { cnt: number };
    return row ? row.cnt : 0;
  }

  public cleanupOldSocialLogs(beforeTimestamp: number): void {
    const stmt = this.db.sqlite.prepare(`
      DELETE FROM social_battery_logs WHERE timestamp < ?
    `);
    stmt.run(beforeTimestamp);
  }

  // ============================================================
  // 7. Apodos y Palabras de Activación (user_aliases)
  // ============================================================

  public addUserAlias(userPhone: string, userJid: string, alias: string, addedBy: string): void {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const cleanAlias = alias.trim().toLowerCase();
    if (!cleanPhone || !cleanAlias) return;

    const now = Date.now();
    const stmt = this.db.sqlite.prepare(`
      INSERT INTO user_aliases (user_phone, user_jid, alias, added_by, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_phone, alias) DO UPDATE SET
        user_jid = excluded.user_jid,
        added_by = excluded.added_by,
        created_at = excluded.created_at
    `);
    stmt.run(cleanPhone, userJid, cleanAlias, addedBy, now);
  }

  public removeUserAlias(userPhone: string, alias: string): boolean {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const cleanAlias = alias.trim().toLowerCase();
    const stmt = this.db.sqlite.prepare(`
      DELETE FROM user_aliases WHERE user_phone = ? AND alias = ? COLLATE NOCASE
    `);
    const info = stmt.run(cleanPhone, cleanAlias);
    return info.changes > 0;
  }

  public getAliasesByPhone(userPhone: string): string[] {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const stmt = this.db.sqlite.prepare(`
      SELECT alias FROM user_aliases WHERE user_phone = ? ORDER BY alias ASC
    `);
    const rows = stmt.all(cleanPhone) as Array<{ alias: string }>;
    return rows.map((r) => r.alias);
  }

  public getAllAliases(): UserAlias[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        user_phone as userPhone,
        user_jid as userJid,
        alias,
        added_by as addedBy,
        created_at as createdAt
      FROM user_aliases
      ORDER BY user_phone, alias
    `);
    return stmt.all() as unknown as UserAlias[];
  }

  public findUserByAlias(aliasWord: string): UserAlias | null {
    const cleanAlias = aliasWord.trim().toLowerCase();
    const stmt = this.db.sqlite.prepare(`
      SELECT
        id,
        user_phone as userPhone,
        user_jid as userJid,
        alias,
        added_by as addedBy,
        created_at as createdAt
      FROM user_aliases
      WHERE alias = ? COLLATE NOCASE
      LIMIT 1
    `);
    return (stmt.get(cleanAlias) as unknown as UserAlias) || null;
  }

  // ============================================================
  // 8. Dump para Backups
  // ============================================================

  public exportBackupData(): Record<string, any[]> {
    const tables = [
      'system_config',
      'admin_users',
      'authorized_groups',
      'user_aliases',
      'birthdays',
      'user_statistics',
      'messages',
      'mentions',
      'summary_checkpoints'
    ];

    const backupData: Record<string, any[]> = {};
    for (const table of tables) {
      try {
        const rows = this.db.sqlite.prepare(`SELECT * FROM ${table}`).all();
        backupData[table] = rows;
      } catch {
        backupData[table] = [];
      }
    }
    return backupData;
  }
}
