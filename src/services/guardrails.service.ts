import fs from 'node:fs';
import path from 'node:path';
import type { GuardrailsRepository, GroupJoinRequest, CommandAuditEntry, UserAlias } from '../database/repositories/guardrails.repository.js';

export interface SocialBatteryResult {
  allowed: boolean;
  count: number;
  level: 'normal' | 'tired_humor' | 'low_patience' | 'very_brief' | 'exhausted' | 'blocked';
  finalMessage?: string;
  personalityDirective?: string;
}

export interface GuardrailsConfig {
  botInstanceId?: string;
  initialAdminSuffixes?: string[];
  targetGroupJid?: string;
}

export class GuardrailsService {
  private botInstanceId: string;
  private memoryBlockedUsers = new Set<string>();
  private userFlirtTimestamps = new Map<string, number>();

  constructor(
    private guardrailsRepo: GuardrailsRepository,
    config?: GuardrailsConfig
  ) {
    this.botInstanceId = config?.botInstanceId || 'bot-principal';

    // Inicializar configuración dinámica por defecto si no existe
    this.initDefaultConfig();

    // Sembrar administradores iniciales desde .env / config
    if (config?.initialAdminSuffixes && config.initialAdminSuffixes.length > 0) {
      for (const suffix of config.initialAdminSuffixes) {
        const trimmed = suffix.trim();
        const clean = trimmed.replace(/\D/g, '');
        if (clean) {
          let jid: string = `${clean}@s.whatsapp.net`;
          if (trimmed.includes('@')) {
            jid = trimmed;
          } else if (clean.length >= 14 && !clean.startsWith('54')) {
            jid = `${clean}@lid`;
          } else if (clean.length < 8) {
            jid = '';
          }
          this.guardrailsRepo.addAdmin(clean, jid, 'env-initial');
        }
      }
    }

    // Sembrar TARGET_GROUP_JID como grupo autorizado inicial si está configurado
    if (config?.targetGroupJid && config.targetGroupJid.endsWith('@g.us')) {
      if (!this.guardrailsRepo.isGroupAuthorized(config.targetGroupJid)) {
        this.guardrailsRepo.authorizeGroup(
          config.targetGroupJid,
          'Grupo Principal Inicial',
          'env-initial',
          true // intro_sent = 1 para no repetir introducción
        );
      }
    }
  }

  private initDefaultConfig(): void {
    const defaults: Record<string, string> = {
      bot_instance_id: this.botInstanceId,
      commands_per_second: '1',
      commands_per_hour: '30',
      social_battery_limit: '15',
      social_battery_window_hours: '1',
      group_approval_timeout_hours: '12',
      intro_sent_default: 'true'
    };

    for (const [key, val] of Object.entries(defaults)) {
      if (!this.guardrailsRepo.getConfig(key)) {
        this.guardrailsRepo.setConfig(key, val);
      }
    }
  }

  // ============================================================
  // 1. Control de Permisos y Administradores
  // ============================================================

  public isAdmin(phoneOrJid: string): boolean {
    return this.guardrailsRepo.isAdmin(phoneOrJid);
  }

  public getAllAdmins(): Array<{ phone: string; jid: string | null; addedBy: string; createdAt: number }> {
    return this.guardrailsRepo.getAllAdmins();
  }

  public getAllAdminJids(): string[] {
    const admins = this.guardrailsRepo.getAllAdmins();
    return admins.map((a) => a.jid || `${a.phone}@s.whatsapp.net`);
  }

  public addAdmin(phoneOrJid: string, addedBy: string = 'admin'): boolean {
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 6) return false;
    this.guardrailsRepo.addAdmin(cleanPhone, `${cleanPhone}@s.whatsapp.net`, addedBy);
    return true;
  }

  public removeAdmin(phoneOrJid: string): boolean {
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    return this.guardrailsRepo.removeAdmin(cleanPhone);
  }

  // ============================================================
  // 2. Rate Limiting de Comandos (1/s, 30/h)
  // ============================================================

  public checkCommandRateLimit(
    userJid: string,
    userName: string,
    groupJid: string,
    commandText: string
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const cleanPhone = userJid.split('@')[0].replace(/\D/g, '');
    const entryId = `cmd-${userJid}-${now}-${Math.random().toString(36).slice(2, 6)}`;

    // Administradores quedan exentos de rate limiting
    if (this.isAdmin(userJid)) {
      this.guardrailsRepo.logCommand({
        id: entryId,
        userJid,
        userName,
        userPhone: cleanPhone,
        groupJid,
        command: commandText,
        timestamp: now,
        result: 'allowed'
      });
      return { allowed: true };
    }

    // Regla 1: Máximo 1 comando por segundo
    const lastCmdTime = this.guardrailsRepo.getLastAllowedCommandTimestamp(userJid);
    if (now - lastCmdTime < 1000) {
      this.guardrailsRepo.logCommand({
        id: entryId,
        userJid,
        userName,
        userPhone: cleanPhone,
        groupJid,
        command: commandText,
        timestamp: now,
        result: 'blocked',
        blockReason: 'rate_limit_1_per_sec'
      });
      return { allowed: false, reason: 'Demasiado rápido (máx 1 comando/segundo).' };
    }

    // Regla 2: Máximo 30 comandos por hora (ventana móvil de 3600s)
    const oneHourAgo = now - 3600 * 1000;
    const cmdsInLastHour = this.guardrailsRepo.getRecentCommandCount(userJid, oneHourAgo);
    const maxCmdsPerHour = parseInt(this.guardrailsRepo.getConfig('commands_per_hour', '30'), 10) || 30;

    if (cmdsInLastHour >= maxCmdsPerHour) {
      this.guardrailsRepo.logCommand({
        id: entryId,
        userJid,
        userName,
        userPhone: cleanPhone,
        groupJid,
        command: commandText,
        timestamp: now,
        result: 'blocked',
        blockReason: 'rate_limit_30_per_hour'
      });
      return { allowed: false, reason: `Límite por hora alcanzado (${maxCmdsPerHour}/hora).` };
    }

    // Comando permitido
    this.guardrailsRepo.logCommand({
      id: entryId,
      userJid,
      userName,
      userPhone: cleanPhone,
      groupJid,
      command: commandText,
      timestamp: now,
      result: 'allowed'
    });
    return { allowed: true };
  }

  // ============================================================
  // 3. Límite de Preguntas / Batería Social (15/h por usuario)
  // ============================================================

  public checkSocialBattery(userJid: string, _userName: string): SocialBatteryResult {
    const now = Date.now();

    // Administradores quedan exentos de límite de batería social
    if (this.isAdmin(userJid)) {
      return { allowed: true, count: 0, level: 'normal' };
    }

    const oneHourAgo = now - 3600 * 1000;
    // Obtener cantidad de interacciones en la última hora antes de esta
    const previousCount = this.guardrailsRepo.getSocialInteractionCount(userJid, oneHourAgo);
    const currentCount = previousCount + 1;

    // Registrar interacción
    this.guardrailsRepo.recordSocialInteraction(userJid, now);

    // Si supera 15: silencio absoluto
    if (currentCount > 15) {
      return {
        allowed: false,
        count: currentCount,
        level: 'blocked'
      };
    }

    // Interacción 15: última respuesta antes del apagón por 1 hora
    if (currentCount === 15) {
      return {
        allowed: true,
        count: currentCount,
        level: 'exhausted',
        finalMessage: 'Nos vemos dentro de una hora, maestro. Mi batería social necesita cargarse 🔋😴'
      };
    }

    // Interacciones 13 y 14: respuesta muy breve y cansada
    if (currentCount >= 13) {
      return {
        allowed: true,
        count: currentCount,
        level: 'very_brief',
        personalityDirective:
          'BATERÍA SOCIAL MUY BAJA (13-14): Estás exhausto de tanto hablar con esta misma persona. Responde de forma muy escueta, cortante y con sueño (máximo 5 a 10 palabras).'
      };
    }

    // Interacciones 10 a 12: mostrar claramente menor paciencia
    if (currentCount >= 10) {
      return {
        allowed: true,
        count: currentCount,
        level: 'low_patience',
        personalityDirective:
          'BATERÍA SOCIAL BAJA (10-12): Mostrá menor paciencia con humor cordobés (ej: "che loco, me estás exprimiendo", "¿no tenés nada que hacer hoy? 😂", "aflojá un poco"). Breve y directo.'
      };
    }

    // Interacciones 6 a 9: comenzar a mostrar cansancio con humor
    if (currentCount >= 6) {
      return {
        allowed: true,
        count: currentCount,
        level: 'tired_humor',
        personalityDirective:
          'BATERÍA SOCIAL MEDIA (6-9): Tirale al paso un comentario gracioso sobre que te tiene charlando sin parar o que te va a tener que pagar el sueldo.'
      };
    }

    // Interacciones 1 a 5: normal
    return {
      allowed: true,
      count: currentCount,
      level: 'normal'
    };
  }

  // ============================================================
  // 4. Gestión de Grupos Autorizados y Solicitudes de Ingreso
  // ============================================================

  public isGroupAuthorized(groupJid: string): boolean {
    return this.guardrailsRepo.isGroupAuthorized(groupJid);
  }

  public isIntroSent(groupJid: string): boolean {
    return this.guardrailsRepo.isIntroSent(groupJid);
  }

  public markIntroSent(groupJid: string): void {
    this.guardrailsRepo.markIntroSent(groupJid);
  }

  public getPendingRequestByGroup(groupJid: string): GroupJoinRequest | null {
    return this.guardrailsRepo.getPendingRequestByGroup(groupJid);
  }

  public getAllPendingRequests(): GroupJoinRequest[] {
    return this.guardrailsRepo.getAllPendingRequests();
  }

  public authorizeGroup(groupJid: string, groupName: string, authorizedBy: string = 'admin', introSent: boolean = true): void {
    this.guardrailsRepo.authorizeGroup(groupJid, groupName, authorizedBy, introSent);
  }

  public createGroupJoinRequest(
    groupJid: string,
    groupName: string,
    invitedByJid: string
  ): GroupJoinRequest {
    const existing = this.guardrailsRepo.getPendingRequestByGroup(groupJid);
    if (existing) return existing;

    const timeoutHours = parseInt(this.guardrailsRepo.getConfig('group_approval_timeout_hours', '12'), 10) || 12;
    const now = Date.now();
    const expiresAt = now + timeoutHours * 3600 * 1000;
    const id = `SOL-${Math.floor(100 + Math.random() * 900)}`;
    const cleanPhone = invitedByJid.split('@')[0].replace(/\D/g, '') || 'desconocido';

    const req: GroupJoinRequest = {
      id,
      groupJid,
      groupName: groupName || 'Grupo de WhatsApp',
      invitedByJid,
      invitedByPhone: cleanPhone,
      status: 'pending',
      createdAt: now,
      expiresAt
    };

    this.guardrailsRepo.createJoinRequest(req);
    return req;
  }

  public approveGroupJoinRequest(
    requestId: string,
    adminJid: string
  ): { success: boolean; request?: GroupJoinRequest; message: string } {
    const req = this.guardrailsRepo.getJoinRequest(requestId);
    if (!req) {
      return { success: false, message: `No se encontró la solicitud "${requestId}".` };
    }

    if (req.status !== 'pending') {
      return { success: false, message: `La solicitud "${requestId}" ya fue procesada (${req.status}).` };
    }

    this.guardrailsRepo.updateJoinRequestStatus(requestId, 'approved', adminJid);
    this.guardrailsRepo.authorizeGroup(req.groupJid, req.groupName, adminJid, false);

    return {
      success: true,
      request: req,
      message: `✅ Grupo "${req.groupName}" aprobado con éxito. El bot ya puede interactuar en el grupo.`
    };
  }

  public rejectGroupJoinRequest(
    requestId: string,
    adminJid: string
  ): { success: boolean; request?: GroupJoinRequest; message: string } {
    const req = this.guardrailsRepo.getJoinRequest(requestId);
    if (!req) {
      return { success: false, message: `No se encontró la solicitud "${requestId}".` };
    }

    if (req.status !== 'pending') {
      return { success: false, message: `La solicitud "${requestId}" ya fue procesada (${req.status}).` };
    }

    this.guardrailsRepo.updateJoinRequestStatus(requestId, 'rejected', adminJid);
    this.guardrailsRepo.deauthorizeGroup(req.groupJid);

    return {
      success: true,
      request: req,
      message: `🚫 Solicitud "${requestId}" rechazada. El bot abandonará el grupo "${req.groupName}".`
    };
  }

  public getExpiredGroupRequests(): GroupJoinRequest[] {
    return this.guardrailsRepo.getExpiredPendingRequests();
  }

  public expireGroupRequest(requestId: string): void {
    this.guardrailsRepo.updateJoinRequestStatus(requestId, 'expired', 'system_timeout');
  }

  // ============================================================
  // 5. Backups Persistentes
  // ============================================================

  public createBackup(): { filePath: string; summary: string; tableCounts: Record<string, number> } {
    const data = this.guardrailsRepo.exportBackupData();
    const backupDir = path.resolve(process.cwd(), 'data', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${timestampStr}.json`;
    const filePath = path.join(backupDir, fileName);

    const payload = {
      botInstanceId: this.botInstanceId,
      backupCreatedAt: new Date().toISOString(),
      data
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');

    const tableCounts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(data)) {
      tableCounts[table] = rows.length;
    }

    const summary = `📦 *BACKUP EXITOSO*\n• Archivo: ${fileName}\n• Grupos: ${tableCounts.authorized_groups || 0}\n• Usuarios: ${tableCounts.user_statistics || 0}\n• Cumpleaños: ${tableCounts.birthdays || 0}\n• Mensajes guardados: ${tableCounts.messages || 0}`;

    return { filePath, summary, tableCounts };
  }

  // ============================================================
  // 6. Configuración Dinámica
  // ============================================================

  public getConfig(key: string, defaultValue: string = ''): string {
    return this.guardrailsRepo.getConfig(key, defaultValue);
  }

  public setConfig(key: string, value: string): void {
    this.guardrailsRepo.setConfig(key, value);
  }

  public getAllConfig(): Record<string, string> {
    return this.guardrailsRepo.getAllConfig();
  }

  // ============================================================
  // 7. Enmascaramiento de Secretos y Errores Amigables
  // ============================================================

  public maskSecrets(text: string): string {
    if (!text) return '';
    return text
      .replace(/(gsk_[A-Za-z0-9_-]{20,})/g, 'gsk_***')
      .replace(/(AI_API_KEY\s*=\s*['"]?)[^'"\s]+/gi, '$1***')
      .replace(/(\b[A-Za-z0-9]{32,}\b)/g, '***');
  }

  public formatSafeErrorMessage(): string {
    return 'Uh, se me cruzaron los cables che... ya me anoto el temita para revisar. Probá de nuevo en un ratito! 🐶🔧';
  }

  // ============================================================
  // 8. Cooldown de Halagos / Flirteo Espontáneo (3 horas por chica)
  // ============================================================

  public canFlirtSpontaneously(userJid: string): boolean {
    const cleanPhone = userJid.split('@')[0].replace(/\D/g, '');
    const lastFlirt = this.userFlirtTimestamps.get(cleanPhone) || 0;
    const cooldownMs = 3 * 3600 * 1000; // 3 horas
    return Date.now() - lastFlirt >= cooldownMs;
  }

  public recordSpontaneousFlirt(userJid: string): void {
    const cleanPhone = userJid.split('@')[0].replace(/\D/g, '');
    this.userFlirtTimestamps.set(cleanPhone, Date.now());
  }

  // ============================================================
  // 9. Gestión de Apodos y Palabras de Activación
  // ============================================================

  public addAliases(phoneOrJid: string, aliases: string[], addedBy: string = 'admin'): string[] {
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const added: string[] = [];

    for (const alias of aliases) {
      const clean = alias.trim().toLowerCase();
      if (clean.length >= 2) {
        this.guardrailsRepo.addUserAlias(cleanPhone, jid, clean, addedBy);
        added.push(clean);
      }
    }
    return added;
  }

  public removeAlias(phoneOrJid: string, alias: string): boolean {
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    return this.guardrailsRepo.removeUserAlias(cleanPhone, alias);
  }

  public getAliases(phoneOrJid: string): string[] {
    const cleanPhone = phoneOrJid.split('@')[0].replace(/\D/g, '');
    return this.guardrailsRepo.getAliasesByPhone(cleanPhone);
  }

  public getAllAliases(): UserAlias[] {
    return this.guardrailsRepo.getAllAliases();
  }

  public findUserByAlias(aliasWord: string): UserAlias | null {
    return this.guardrailsRepo.findUserByAlias(aliasWord);
  }
}
