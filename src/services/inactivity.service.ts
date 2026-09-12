import { MessageRepository } from '../database/repositories/message.repository.js';
import { StatisticsRepository } from '../database/repositories/statistics.repository.js';
import { AIService } from './ai.service.js';

export interface InactivityConfig {
  thresholdMs: number; // Por defecto: 6 horas (21600000 ms)
  cooldownMs: number;  // Por defecto: 12 horas (43200000 ms)
  mentionTopActive: boolean;
}

export class InactivityService {
  private lastNudgeTimestamps = new Map<string, number>();
  private lastNudgeUsers = new Map<string, string>();

  constructor(
    private messageRepo: MessageRepository,
    private statsRepo: StatisticsRepository,
    private aiService: AIService,
    private config: InactivityConfig
  ) {}

  public async evaluateInactivityNudge(
    groupJid: string,
    botCleanJid: string
  ): Promise<{ text: string; mentionedJid?: string } | null> {
    const now = Date.now();
    const lastHumanMsgTime = this.messageRepo.getLastHumanMessageTimestamp(groupJid, botCleanJid);

    // Si nunca hubo mensajes humanos o el grupo está activo recientemente
    if (lastHumanMsgTime === 0) return null;
    if (now - lastHumanMsgTime < this.config.thresholdMs) return null;

    // Verificar cooldown desde la última reactivación
    const lastNudgeTime = this.lastNudgeTimestamps.get(groupJid) || 0;
    if (now - lastNudgeTime < this.config.cooldownMs) return null;

    // Obtener contexto reciente de los últimos 3 mensajes para que el nudge sea natural
    const recentMessages = this.messageRepo.getMessagesSince(groupJid, lastHumanMsgTime - 1000, 3);
    const contextSummary = recentMessages.map((m) => `${m.senderName}: ${m.content}`).join(' | ');

    // Seleccionar usuario del Top 10 activo de forma rotativa
    let targetUserName: string | undefined;
    let targetUserJid: string | undefined;

    if (this.config.mentionTopActive) {
      const topUsers = this.statsRepo.getTopActiveUsers(groupJid, 10);
      const lastSelectedJid = this.lastNudgeUsers.get(groupJid);

      const candidateUsers = topUsers.filter(
        (u) => u.userJid !== botCleanJid && u.userJid !== lastSelectedJid
      );

      if (candidateUsers.length > 0) {
        const selected = candidateUsers[Math.floor(Math.random() * candidateUsers.length)];
        targetUserName = selected.userName;
        targetUserJid = selected.userJid;
      }
    }

    const nudgeText = await this.aiService.generateInactivityNudge(contextSummary, targetUserName);

    // Actualizar timestamps y usuario
    this.lastNudgeTimestamps.set(groupJid, now);
    if (targetUserJid) {
      this.lastNudgeUsers.set(groupJid, targetUserJid);
    }

    return {
      text: nudgeText,
      mentionedJid: targetUserJid
    };
  }
}
