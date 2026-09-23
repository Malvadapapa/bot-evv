import { SummaryService } from './summary.service.js';
import { BirthdayService } from './birthday.service.js';
import { InactivityService } from './inactivity.service.js';
import { NewsService } from './news.service.js';
import { WeatherService } from './weather.service.js';
import { AIService } from './ai.service.js';
import { JobExecutionRepository } from '../database/repositories/job-execution.repository.js';
import { getTodayCordoba } from '../utils/date.js';
import type { ReminderService } from './reminder.service.js';

export interface SchedulerTargetAdapter {
  sendMessage(groupJid: string, text: string, options?: { mentions?: string[] }): Promise<void>;
  getTargetGroupJid?(): string;
  getTargetGroupJids?(): string[];
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
    private weatherService: WeatherService,
    private aiService: AIService,
    private jobExecutionRepo: JobExecutionRepository,
    private adapter: SchedulerTargetAdapter,
    private timezone: string = 'America/Argentina/Cordoba',
    private reminderService?: ReminderService
  ) {}

  public getTargetGroups(): string[] {
    if (this.adapter.getTargetGroupJids) {
      const list = this.adapter.getTargetGroupJids();
      if (Array.isArray(list) && list.length > 0) {
        return Array.from(new Set(list.filter(Boolean)));
      }
    }
    if (this.adapter.getTargetGroupJid) {
      const single = this.adapter.getTargetGroupJid();
      if (single) return [single];
    }
    return [];
  }

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

      // 0. Avisos y Recordatorios Programados (verificación continua cada tick)
      if (this.reminderService) {
        const dueReminders = this.reminderService.getDueReminders(now.getTime());
        for (const reminder of dueReminders) {
          try {
            const delivery = this.reminderService.formatDeliveryMessage(reminder);
            console.log(`🔔 [Scheduler] Entregando recordatorio ${reminder.id} en ${reminder.groupJid}...`);
            await this.adapter.sendMessage(reminder.groupJid, delivery.text, {
              mentions: delivery.mentions
            });
            this.reminderService.markAsSent(reminder.id);
          } catch (e: any) {
            console.error(`❌ [Scheduler] Error entregando recordatorio ${reminder.id}:`, e?.message || e);
          }
        }
      }

      const targetGroups = this.getTargetGroups();
      if (targetGroups.length === 0) return;

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

      // 2. Mensaje Diario Matutino (08:00) para todos los grupos autorizados
      if (timeStr === '08:00') {
        let morningNews: import('./news.service.js').TechNewsItem[] | undefined;
        for (const targetGroupJid of targetGroups) {
          const jobKey = `daily_morning_message:${targetGroupJid}:${today}`;
          if (!this.jobExecutionRepo.isJobExecuted(jobKey)) {
            console.log(`☀️ [Scheduler] Generando mensaje matutino para ${targetGroupJid} (${today})...`);
            if (!morningNews) {
              morningNews = await this.newsService.getLatestUnpublishedNews(3);
            }
            await this.sendMorningBriefing(targetGroupJid, false, jobKey, now, morningNews);
            if (targetGroups.length > 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        }
      }

      // 3. Aviso Preventivo de Cumpleaños de Mañana (12:00)
      if (timeStr === '12:00') {
        for (const targetGroupJid of targetGroups) {
          const advanceNotice = this.birthdayService.getTomorrowAdvanceNotification(targetGroupJid, now);
          if (advanceNotice) {
            console.log(`🎂 [Scheduler] Enviando aviso preventivo de cumpleaños para ${targetGroupJid}...`);
            await this.adapter.sendMessage(targetGroupJid, advanceNotice);
            if (targetGroups.length > 1) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
        }
      }

      // 4. Verificación de Inactividad (cada 30 minutos)
      const minute = now.getMinutes();
      if (minute === 0 || minute === 30) {
        const botJid = this.adapter.getBotCleanJid();
        for (const targetGroupJid of targetGroups) {
          const inactivityResult = await this.inactivityService.evaluateInactivityNudge(targetGroupJid, botJid, now);
          if (inactivityResult) {
            const logType =
              inactivityResult.type === 'ghost_alert'
                ? `👻 [Scheduler] Alerta de miembro ausente en ${targetGroupJid}...`
                : `🤖 [Scheduler] Reactivando grupo ${targetGroupJid}...`;
            console.log(logType);
            await this.adapter.sendMessage(targetGroupJid, inactivityResult.text, {
              mentions: inactivityResult.mentionedJid ? [inactivityResult.mentionedJid] : []
            });
            if (targetGroups.length > 1) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ [SchedulerService] Error en tick:`, err?.message || err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Construye y despacha el saludo matutino completo:
   * 1. Saludo dinámico, fecha y clima en Argentina, cumpleaños si hay, y cierre con "Les dejo algunas noticias =)".
   * 2. Despacho secuencial de 3 a 4 noticias en mensajes separados con título, resumen y link.
   */
  public async sendMorningBriefing(
    targetJid: string,
    isTest: boolean = false,
    jobKey?: string,
    date?: Date,
    prefetchedNews?: import('./news.service.js').TechNewsItem[]
  ): Promise<void> {
    const now = date || new Date();

    // Fecha en español argentino
    const dateFormatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: this.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    const rawDateStr = dateFormatter.format(now);
    const capitalizedDate = rawDateStr.charAt(0).toUpperCase() + rawDateStr.slice(1);

    // 1. Saludo dinámico (varía entre 16+ opciones o IA)
    const dynamicGreeting = await this.aiService.generateDynamicMorningGreeting(capitalizedDate);

    // 2. Reporte del clima en Argentina
    const weatherText = await this.weatherService.getArgentinaWeatherSummary();

    // 3. Cumpleaños de hoy (si aplica)
    const birthdayCelebration = await this.birthdayService.getTodayCelebrationMessage(targetJid, now);

    // 4. Construcción del Mensaje 1 (Saludo Matutino)
    const greetingSections: string[] = [
      dynamicGreeting,
      '',
      `📅 Hoy es ${capitalizedDate}.`,
      weatherText
    ];

    if (birthdayCelebration) {
      greetingSections.push('');
      greetingSections.push(birthdayCelebration);
    }

    greetingSections.push('');
    greetingSections.push(
      '💪 ¡Que tengan un excelente día! Recuerden que pueden pedir /resumen o consultar /ayuda en cualquier momento.\n\nLes dejo algunas noticias =)'
    );

    const mainGreetingMessage = greetingSections.join('\n');
    await this.adapter.sendMessage(targetJid, mainGreetingMessage);

    // 5. Obtener 3 noticias (prefetched o inéditas de las fuentes disponibles)
    const newsItems =
      prefetchedNews && prefetchedNews.length > 0
        ? prefetchedNews
        : await this.newsService.getLatestUnpublishedNews(3);

    // Despacho secuencial en mensajes separados con un pequeño intervalo
    const messageDelayMs = isTest ? 300 : 1200;
    for (const item of newsItems) {
      await new Promise((resolve) => setTimeout(resolve, messageDelayMs));
      const singleNewsMessage = this.newsService.formatSingleNewsItem(item);
      await this.adapter.sendMessage(targetJid, singleNewsMessage);
    }

    // Registrar idempotencia si es la ejecución programada de las 08:00
    if (!isTest && jobKey) {
      this.jobExecutionRepo.recordJobExecution(jobKey, targetJid);
    }
  }

  /**
   * Despacha un mensaje a todos los grupos autorizados registrados
   */
  public async broadcastCustomMessage(text: string): Promise<string[]> {
    const groups = this.getTargetGroups();
    const sentGroups: string[] = [];
    for (const jid of groups) {
      try {
        await this.adapter.sendMessage(jid, text);
        sentGroups.push(jid);
        if (groups.length > 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e: any) {
        console.error(`❌ [Scheduler] Error enviando broadcast a ${jid}:`, e?.message || e);
      }
    }
    return sentGroups;
  }

  /**
   * Despacha un bloque de N noticias tech en mensajes separados (para el comando /noticias [n])
   */
  public async sendNewsBriefingOnly(targetJid: string, count: number = 1): Promise<void> {
    const newsItems = await this.newsService.getLatestUnpublishedNews(count);

    if (newsItems.length === 0) {
      await this.adapter.sendMessage(targetJid, '📰 No hay noticias nuevas inéditas disponibles en este momento.');
      return;
    }

    for (let i = 0; i < newsItems.length; i++) {
      const item = newsItems[i];
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const singleNewsMessage = this.newsService.formatSingleNewsItem(item);
      await this.adapter.sendMessage(targetJid, singleNewsMessage);
    }
  }
}
