import { SummaryService } from './summary.service.js';
import { BirthdayService } from './birthday.service.js';
import { InactivityService } from './inactivity.service.js';
import { NewsService } from './news.service.js';
import { WeatherService } from './weather.service.js';
import { AIService } from './ai.service.js';
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
    private weatherService: WeatherService,
    private aiService: AIService,
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

      // 2. Mensaje Diario Matutino (08:00)
      if (timeStr === '08:00') {
        const jobKey = `daily_morning_message:${targetGroupJid}:${today}`;
        if (!this.jobExecutionRepo.isJobExecuted(jobKey)) {
          console.log(`☀️ [Scheduler] Generando mensaje matutino de las 08:00...`);
          await this.sendMorningBriefing(targetGroupJid, false, jobKey, now);
        }
      }

      // 3. Aviso Preventivo de Cumpleaños de Mañana (12:00)
      if (timeStr === '12:00') {
        const advanceNotice = this.birthdayService.getTomorrowAdvanceNotification(targetGroupJid, now);
        if (advanceNotice) {
          console.log(`🎂 [Scheduler] Enviando aviso preventivo de cumpleaños de mañana...`);
          await this.adapter.sendMessage(targetGroupJid, advanceNotice);
        }
      }

      // 4. Verificación de Inactividad (cada 30 minutos)
      const minute = now.getMinutes();
      if (minute === 0 || minute === 30) {
        const botJid = this.adapter.getBotCleanJid();
        const inactivityResult = await this.inactivityService.evaluateInactivityNudge(targetGroupJid, botJid, now);
        if (inactivityResult) {
          const logType = inactivityResult.type === 'ghost_alert' ? '👻 [Scheduler] Alerta de miembro ausente (+7 días)...' : '🤖 [Scheduler] Reactivando grupo inactivo...';
          console.log(logType);
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
   * Construye y despacha el saludo matutino completo:
   * 1. Saludo dinámico, fecha y clima en Argentina, cumpleaños si hay, y cierre con "Les dejo algunas noticias =)".
   * 2. Despacho secuencial de 3 a 4 noticias en mensajes separados con título, resumen y link.
   */
  public async sendMorningBriefing(
    targetJid: string,
    isTest: boolean = false,
    jobKey?: string,
    date?: Date
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

    // 5. Obtener 3 noticias inéditas (3 aleatorias entre las 4 fuentes disponibles)
    const newsItems = await this.newsService.getLatestUnpublishedNews(3);

    // Despacho secuencial en mensajes separados con un pequeño intervalo
    const messageDelayMs = isTest ? 300 : 1200;
    for (const item of newsItems) {
      await new Promise((resolve) => setTimeout(resolve, messageDelayMs));
      const singleNewsMessage = this.newsService.formatSingleNewsItem(item);
      await this.adapter.sendMessage(targetJid, singleNewsMessage);
    }

    // Registrar idempotencia si es la ejecución programada de las 09:00
    if (!isTest && jobKey) {
      this.jobExecutionRepo.recordJobExecution(jobKey, targetJid);
    }
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
