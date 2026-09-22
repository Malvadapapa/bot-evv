import { MessageRepository } from '../database/repositories/message.repository.js';
import { StatisticsRepository } from '../database/repositories/statistics.repository.js';
import { AIService } from './ai.service.js';

export interface InactivityConfig {
  thresholdMs: number;             // Silencio requerido: ~3.5 horas (3.5 * 3600 * 1000)
  cooldownMs: number;              // Cooldown entre reactivaciones generales: ~8 horas
  mentionTopActive: boolean;
  timezone?: string;
  inactiveDaysThreshold?: number;  // Días para considerar miembro ausente (por defecto 7)
  maxGhostAlertsPerDay?: number;   // Máximo de avisos de ausentes por día (por defecto 4)
  ghostAlertCooldownMs?: number;   // Separación mínima entre avisos de ausentes: 2 horas
  interactionTargetJids?: string[];// JIDs específicos para picantear interacción (ej: Cristian)
}

export interface InactivityResult {
  text: string;
  mentionedJid?: string;
  type: 'general_nudge' | 'ghost_alert';
}

export class InactivityService {
  private lastNudgeTimestamps = new Map<string, number>();
  private lastNudgeUsers = new Map<string, string>();

  // Control de alertas de miembros ausentes (> 7 días)
  private ghostAlertsCountToday = new Map<string, { count: number; date: string }>();
  private lastGhostAlertTimestamp = new Map<string, number>();
  private userGhostAlertTimestamps = new Map<string, number>(); // Cooldown por usuario (48hs)

  constructor(
    private messageRepo: MessageRepository,
    private statsRepo: StatisticsRepository,
    private aiService: AIService,
    private config: InactivityConfig
  ) {}

  public async evaluateInactivityNudge(
    groupJid: string,
    botCleanJid: string,
    overrideDate?: Date
  ): Promise<InactivityResult | null> {
    const now = overrideDate || new Date();
    const nowMs = now.getTime();

    // 1. REGLA HORARIA: Respetar horario de silencio nocturno y margen post-saludo
    const tz = this.config.timezone || 'America/Argentina/Cordoba';
    const hourFormatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = hourFormatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Madrugada / descanso: de 00:00 a 08:00 hs NO se envía nada
    if (hour < 8) return null;

    // Margen tras el saludo de las 08:00 hs: no enviar reactivaciones antes de las 10:30 hs (2.5 hs de gracia)
    if (hour < 10 || (hour === 10 && minute < 30)) return null;

    // 2. Verificar silencio humano en el grupo
    const lastHumanMsgTime = this.messageRepo.getLastHumanMessageTimestamp(groupJid, botCleanJid);
    if (lastHumanMsgTime === 0) return null;

    const silenceDuration = nowMs - lastHumanMsgTime;
    if (silenceDuration < this.config.thresholdMs) return null;

    // 3. INTENTO 1: Buscar miembros ausentes (> 7 días sin hablar)
    const ghostAlert = await this.tryGhostMemberCallout(groupJid, botCleanJid, nowMs, tz);
    if (ghostAlert) {
      return ghostAlert;
    }

    // 4. INTENTO 2: Reactivación general del grupo
    const lastNudgeTime = this.lastNudgeTimestamps.get(groupJid) || 0;
    if (nowMs - lastNudgeTime < this.config.cooldownMs) return null;

    return await this.generateGeneralNudge(groupJid, botCleanJid, nowMs, lastHumanMsgTime);
  }

  /**
   * Intenta emitir un aviso para un miembro que lleve más de 7 días sin hablar en el grupo.
   * Reglas estrictas:
   * - Máximo 4 avisos por día.
   * - Mínimo 2 horas entre avisos.
   * - Máximo 1 usuario por aviso (rotativo).
   * - Cooldown de 48 horas para no repetir sobre el mismo usuario.
   */
  private async tryGhostMemberCallout(
    groupJid: string,
    botCleanJid: string,
    nowMs: number,
    timezone: string
  ): Promise<InactivityResult | null> {
    const todayStr = new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(nowMs);

    // Control de cuota diaria (máx 4 avisos por día)
    const maxPerDay = this.config.maxGhostAlertsPerDay ?? 4;
    let dailyTracker = this.ghostAlertsCountToday.get(groupJid);
    if (!dailyTracker || dailyTracker.date !== todayStr) {
      dailyTracker = { count: 0, date: todayStr };
      this.ghostAlertsCountToday.set(groupJid, dailyTracker);
    }
    if (dailyTracker.count >= maxPerDay) return null;

    // Control de separación entre avisos (mínimo 2 horas)
    const ghostCooldown = this.config.ghostAlertCooldownMs ?? 2 * 60 * 60 * 1000;
    const lastGhostTime = this.lastGhostAlertTimestamp.get(groupJid) || 0;
    if (nowMs - lastGhostTime < ghostCooldown) return null;

    // Buscar usuarios con más de 7 días sin hablar
    const daysThreshold = this.config.inactiveDaysThreshold ?? 7;
    const inactiveMs = daysThreshold * 24 * 60 * 60 * 1000;
    const inactiveMembers = this.statsRepo.getInactiveMembers(groupJid, inactiveMs, 15);

    const eligibleMembers = inactiveMembers.filter((m) => {
      if (m.userJid === botCleanJid) return false;
      const lastCallout = this.userGhostAlertTimestamps.get(m.userJid) || 0;
      // No llamar al mismo usuario más de una vez cada 48 horas
      return nowMs - lastCallout >= 48 * 60 * 60 * 1000;
    });

    if (eligibleMembers.length === 0) return null;

    // Seleccionar uno de los miembros ausentes
    const selected = eligibleMembers[0];
    const daysSilent = Math.floor((nowMs - selected.lastMessageAt) / (24 * 60 * 60 * 1000));
    const userPhone = selected.userJid.split('@')[0];

    const calloutText = await this.aiService.generateGhostMemberCallout(
      userPhone,
      selected.userName,
      daysSilent
    );

    // Actualizar registros
    dailyTracker.count++;
    this.lastGhostAlertTimestamp.set(groupJid, nowMs);
    this.userGhostAlertTimestamps.set(selected.userJid, nowMs);
    this.lastNudgeTimestamps.set(groupJid, nowMs);

    return {
      text: calloutText,
      mentionedJid: selected.userJid,
      type: 'ghost_alert'
    };
  }

  /**
   * Genera una reactivación general sin repetición de temas ni obsesión con comida
   */
  private async generateGeneralNudge(
    groupJid: string,
    botCleanJid: string,
    nowMs: number,
    lastHumanMsgTime: number
  ): Promise<InactivityResult> {
    // Si la última conversación ocurrió hace menos de 4 horas, podemos usar el contexto fresco
    // Si pasaron más de 4 horas, se descarta para evitar repetir comidas o chistes viejos
    let freshContext: string | undefined;
    const silenceHours = (nowMs - lastHumanMsgTime) / (3600 * 1000);

    if (silenceHours < 4) {
      const recentMessages = this.messageRepo.getMessagesSince(groupJid, lastHumanMsgTime - 1000, 3);
      freshContext = recentMessages.map((m) => `${m.senderName}: ${m.content}`).join(' | ');
    }

    // Seleccionar usuario objetivo para picantear la charla
    let targetMention: { phone: string; name: string } | undefined;
    let targetUserJid: string | undefined;

    // Si hay JIDs prioritarios configurados (ej: Cristian), priorizarlos con cierta probabilidad
    const targetJids = this.config.interactionTargetJids || [];
    const lastSelectedJid = this.lastNudgeUsers.get(groupJid);

    if (targetJids.length > 0 && Math.random() < 0.6) {
      const candidateJid = targetJids.find((j) => j !== lastSelectedJid) || targetJids[0];
      const stats = this.statsRepo.getTopActiveUsers(groupJid, 50).find((u) => u.userJid === candidateJid);
      targetUserJid = candidateJid;
      targetMention = {
        phone: candidateJid.split('@')[0],
        name: stats?.userName || 'Cristian'
      };
    } else if (this.config.mentionTopActive) {
      const topUsers = this.statsRepo.getTopActiveUsers(groupJid, 10);
      const candidates = topUsers.filter((u) => u.userJid !== botCleanJid && u.userJid !== lastSelectedJid);
      if (candidates.length > 0) {
        const sel = candidates[Math.floor(Math.random() * candidates.length)];
        targetUserJid = sel.userJid;
        targetMention = {
          phone: sel.userJid.split('@')[0],
          name: sel.userName
        };
      }
    }

    const text = await this.aiService.generateInactivityNudge(freshContext, targetMention);

    this.lastNudgeTimestamps.set(groupJid, nowMs);
    if (targetUserJid) {
      this.lastNudgeUsers.set(groupJid, targetUserJid);
    }

    return {
      text,
      mentionedJid: targetUserJid,
      type: 'general_nudge'
    };
  }
}
