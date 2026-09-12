import { BirthdayRepository } from '../database/repositories/birthday.repository.js';
import { JobExecutionRepository } from '../database/repositories/job-execution.repository.js';
import { AIService } from './ai.service.js';
import {
  getCordobaDayAndMonth,
  getTomorrowCordobaDayAndMonth,
  getTodayCordoba
} from '../utils/date.js';

export class BirthdayService {
  constructor(
    private birthdayRepo: BirthdayRepository,
    private jobExecutionRepo: JobExecutionRepository,
    private aiService: AIService
  ) {}

  /**
   * Parsea y valida una fecha en formato DD/MM o DD-MM
   */
  public parseBirthday(input: string): { day: number; month: number } | null {
    const match = input.trim().match(/^(\d{1,2})[\/\-](\d{1,2})$/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    // Validación básica de meses con 30 días o febrero
    if ([4, 6, 9, 11].includes(month) && day > 30) return null;
    if (month === 2 && day > 29) return null;

    return { day, month };
  }

  public registerBirthday(
    userJid: string,
    day: number,
    month: number,
    gender?: 'male' | 'female' | null
  ): void {
    this.birthdayRepo.save(userJid, day, month, gender);
  }

  public updateGender(userJid: string, gender: 'male' | 'female'): void {
    this.birthdayRepo.updateGender(userJid, gender);
  }

  public getBirthday(userJid: string) {
    return this.birthdayRepo.get(userJid);
  }

  /**
   * Obtiene los usuarios que cumplen años hoy en Córdoba
   */
  public getTodayBirthdays() {
    const { day, month } = getCordobaDayAndMonth();
    return this.birthdayRepo.getByDate(day, month);
  }

  /**
   * Obtiene los usuarios que cumplen años mañana en Córdoba
   */
  public getTomorrowBirthdays() {
    const { day, month } = getTomorrowCordobaDayAndMonth();
    return this.birthdayRepo.getByDate(day, month);
  }

  /**
   * Genera el mensaje de felicitación para los cumpleañeros de hoy (idempotente)
   */
  public async getTodayCelebrationMessage(groupJid: string): Promise<string | null> {
    const today = getTodayCordoba();
    const jobKey = `birthday_today:${groupJid}:${today}`;

    if (this.jobExecutionRepo.isJobExecuted(jobKey)) {
      return null;
    }

    const celebrants = this.getTodayBirthdays();
    if (celebrants.length === 0) return null;

    const messages: string[] = [];
    for (const person of celebrants) {
      const cleanNumber = person.userJid.split('@')[0];
      const greeting = await this.aiService.generateBirthdayGreeting(cleanNumber, person.gender);
      messages.push(greeting);
    }

    // Registrar ejecución para garantizar idempotencia
    this.jobExecutionRepo.recordJobExecution(jobKey, groupJid);
    return messages.join('\n\n');
  }

  /**
   * Genera el aviso de cumpleaños de mañana (idempotente)
   */
  public getTomorrowAdvanceNotification(groupJid: string): string | null {
    const today = getTodayCordoba();
    const jobKey = `birthday_tomorrow_advance:${groupJid}:${today}`;

    if (this.jobExecutionRepo.isJobExecuted(jobKey)) {
      return null;
    }

    const celebrants = this.getTomorrowBirthdays();
    if (celebrants.length === 0) return null;

    const mentions = celebrants
      .map((c) => `@${c.userJid.split('@')[0]}`)
      .join(', ');

    this.jobExecutionRepo.recordJobExecution(jobKey, groupJid);
    return `🎂 *¡Aviso de cumpleaños!* Mañana cumple años ${mentions}. ¡Vayan preparando los saludos y festejos! 🎉🚀`;
  }
}
