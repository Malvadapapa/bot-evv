import { SummaryRepository } from '../database/repositories/summary.repository.js';
import { MessageRepository } from '../database/repositories/message.repository.js';
import { AIService } from './ai.service.js';
import { getTodayCordoba } from '../utils/date.js';

export class SummaryService {
  constructor(
    private summaryRepo: SummaryRepository,
    private messageRepo: MessageRepository,
    private aiService: AIService
  ) {}

  public async getOrGenerateSummary(groupJid: string): Promise<string> {
    const today = getTodayCordoba();
    let checkpoint = this.summaryRepo.getCheckpoint(groupJid);

    // Si no hay checkpoint o corresponde a un día anterior, iniciar nuevo ciclo
    if (!checkpoint || checkpoint.cycleDate !== today) {
      this.summaryRepo.resetCheckpoint(groupJid, today);
      checkpoint = {
        groupJid,
        cycleDate: today,
        accumulatedSummary: null,
        lastMessageId: null,
        lastMessageTimestamp: 0,
        updatedAt: Date.now()
      };
    }

    // Obtener los mensajes nuevos desde el último checkpoint
    const newMessages = this.messageRepo.getMessagesSince(
      groupJid,
      checkpoint.lastMessageTimestamp,
      300
    );

    if (newMessages.length === 0) {
      if (checkpoint.accumulatedSummary) {
        return `📋 *Resumen de hoy (${today})*\n\n${checkpoint.accumulatedSummary}\n\n_(No hay mensajes nuevos desde el último checkpoint)_`;
      }
      return `📋 *Resumen de hoy (${today})*\n\nTodavía no hay mensajes registrados hoy en este grupo para generar un resumen.`;
    }

    // Generar resumen consolidado incremental usando SÍ O SÍ API externa
    const updatedSummary = await this.aiService.generateIncrementalSummary(
      checkpoint.accumulatedSummary,
      newMessages
    );

    const lastMsg = newMessages[newMessages.length - 1];

    // Actualizar checkpoint atómicamente
    this.summaryRepo.saveCheckpoint({
      groupJid,
      cycleDate: today,
      accumulatedSummary: updatedSummary,
      lastMessageId: lastMsg.id,
      lastMessageTimestamp: lastMsg.timestamp,
      updatedAt: Date.now()
    });

    return `📋 *Resumen actualizado de hoy (${today})*\n\n${updatedSummary}`;
  }

  public resetAllForNewDay(): void {
    const today = getTodayCordoba();
    this.summaryRepo.resetAllForNewDay(today);
  }
}
