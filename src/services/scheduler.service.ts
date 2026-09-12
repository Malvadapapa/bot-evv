import { SummaryService } from './summary.service.js';
import { BirthdayService } from './birthday.service.js';
import { InactivityService } from './inactivity.service.js';
import { NewsService } from './news.service.js';
import { JobExecutionRepository } from '../database/repositories/job-execution.repository.js';
import { getTodayCordoba } from '../utils/date.js';

export interface SchedulerTargetAdapter {
  sendMessage(groupJid: string, text: string, options?: { mentions?: string[] }): Promise<void>;
  getTargetGroupJid(): string;
  getBotCleanJid(): string;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    private summaryService: SummaryService,
    private birthdayService: BirthdayService,
    private inactivityService: InactivityService,
    private newsService: NewsService,
    private jobExecutionRepo: JobExecutionRepository,
    private adapter: SchedulerTargetAdapter,
    private timezone: string = 'America/Argentina/Cordoba'
  ) {}

  public start(): void {
    if (this.timer) return;
    console.log(`⏰ [SchedulerService] Iniciado con zona horaria ${this.timezone}`);

    // Ejecutar verificación inicial inmediata
    this.tick().catch(console.error);

    // Heartbeat cada 60 segundos
    this.timer = setInterval(() => {
      this.tick().catch(console.error);
    }, 60000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Heartbeat periódico que verifica qué jobs deben ejecutarse según la hora en Córdoba
   */
  public async tick(overrideDate?: Date): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = overrideDate || new Date();
      const targetGroupJid = this.adapter.getTargetGroupJid();
      if (!targetGroupJid) return;

      const cordobaFormatter = new Intl.DateTimeFormat('es-AR', {
        timeZone: this.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const timeStr = cordobaFormatter.format(now); // "HH:mm"
      const today = getTodayCordoba(now);

      // 1. Reset Diario (00:00)
      if (timeStr === '00:00') {
        const jobKey = `daily_reset:${today}`;
        if (!this.jobExecutionRepo.isJobExecuted(jobKey)) {
          console.log(`🔄 [Scheduler] Ejecutando reset diario de resúmenes (${today})...`);
          this.summaryService.resetAllForNewDay();
          this.jobExecutionRepo.recordJobExecution(jobKey, 'system');
        }
      }

      // 2. Mensaje Diario Matutino (09:00)
      if (timeStr === '09:00') {
        const jobKey = `daily_morning_message:${targetGroupJid}:${today}`;
        if (!this.jobExecutionRepo.isJobExecuted(jobKey)) {
          console.log(`☀️ [Scheduler] Generando mensaje matutino de las 09:00...`);
          await this.executeDailyMorningMessage(targetGroupJid, jobKey);
        }
      }

      // 3. Aviso Preventivo de Cumpleaños de Mañana (12:00)
      if (timeStr === '12:00') {
        const advanceNotice = this.birthdayService.getTomorrowAdvanceNotification(targetGroupJid);
        if (advanceNotice) {
          console.log(`🎂 [Scheduler] Enviando aviso preventivo de cumpleaños de mañana...`);
          await this.adapter.sendMessage(targetGroupJid, advanceNotice);
        }
      }

      // 4. Verificación de Inactividad (cada 30 minutos)
      const minute = now.getMinutes();
      if (minute === 0 || minute === 30) {
        const botJid = this.adapter.getBotCleanJid();
        const inactivityResult = await this.inactivityService.evaluateInactivityNudge(targetGroupJid, botJid);
        if (inactivityResult) {
          console.log(`🤖 [Scheduler] Reactivando grupo inactivo con mensaje contextual...`);
          await this.adapter.sendMessage(targetGroupJid, inactivityResult.text, {
            mentions: inactivityResult.mentionedJid ? [inactivityResult.mentionedJid] : []
          });
        }
      }
    } catch (err: any) {
      console.error(`❌ [SchedulerService] Error en tick:`, err?.message || err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Construye y despacha el mensaje matutino completo de las 09:00
   */
  private async executeDailyMorningMessage(groupJid: string, jobKey: string): Promise<void> {
    const greetingHeader = `☀️ *¡Buen día, gente!* Espero que hayan arrancado el día con todo ☕🚀\n`;

    // A) Cumpleaños de hoy
    const birthdayCelebration = await this.birthdayService.getTodayCelebrationMessage(groupJid);

    // B) 3 Noticias Tech curadas
    const news = await this.newsService.getLatestUnpublishedNews(3);
    const newsBriefing = this.newsService.formatNewsBriefing(news);

    const sections: string[] = [greetingHeader];

    if (birthdayCelebration) {
      sections.push(birthdayCelebration);
      sections.push('');
    }

    if (newsBriefing) {
      sections.push(newsBriefing);
      sections.push('');
    }

    sections.push(`💪 _¡Que tengan un excelente día! Recuerden que pueden pedir /resumen o consultar /ayuda en cualquier momento._`);

    const fullMessage = sections.join('\n');
    await this.adapter.sendMessage(groupJid, fullMessage);

    this.jobExecutionRepo.recordJobExecution(jobKey, groupJid);
  }
}
