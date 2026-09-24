import { BirthdayRepository } from '../database/repositories/birthday.repository.js';
import { MessageRepository } from '../database/repositories/message.repository.js';
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
    private aiService: AIService,
    private messageRepo?: MessageRepository
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

  /**
   * Parsea de forma tolerante la entrada de /registrarse, aceptando corchetes, paréntesis,
   * y extrayendo tanto fecha como pronombre en cualquier orden.
   * Ejemplos: "27/06 [el]", "[25/03]", "02/08 ella", "el 15/05", "15/05", "ella", "el"
   */
  public parseRegistrationInput(input: string): {
    day?: number;
    month?: number;
    gender?: 'male' | 'female';
    hasDate: boolean;
    hasGender: boolean;
    valid: boolean;
  } {
    const cleaned = input.replace(/[\[\]\(\)'"«»]/g, ' ').trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);

    let day: number | undefined;
    let month: number | undefined;
    let gender: 'male' | 'female' | undefined;

    for (const token of tokens) {
      const lower = token.toLowerCase();

      if (['el', 'él', 'masculino', 'varon', 'varón', 'hombre'].includes(lower)) {
        gender = 'male';
        continue;
      }
      if (['ella', 'femenino', 'mujer'].includes(lower)) {
        gender = 'female';
        continue;
      }

      const dateParsed = this.parseBirthday(token);
      if (dateParsed) {
        day = dateParsed.day;
        month = dateParsed.month;
      }
    }

    const hasDate = day !== undefined && month !== undefined;
    const hasGender = gender !== undefined;

    return {
      day,
      month,
      gender,
      hasDate,
      hasGender,
      valid: hasDate || hasGender
    };
  }

  /**
   * Resuelve el nombre visible de un usuario a partir del registro o del historial de mensajes
   */
  public resolveUserName(userJid: string, storedName?: string | null): string | null {
    if (storedName && storedName.trim()) {
      return storedName.trim();
    }
    if (this.messageRepo) {
      const found = this.messageRepo.getUserNameByJid(userJid);
      if (found && found.trim()) {
        return found.trim();
      }
    }
    return null;
  }

  public registerBirthday(
    userJid: string,
    day: number,
    month: number,
    gender?: 'male' | 'female' | null,
    userName?: string | null
  ): void {
    this.birthdayRepo.save(userJid, day, month, gender, userName);
  }

  public updateGender(userJid: string, gender: 'male' | 'female', userName?: string | null): void {
    this.birthdayRepo.updateGender(userJid, gender, userName);
  }

  public getBirthday(userJid: string) {
    return this.birthdayRepo.get(userJid);
  }

  /**
   * Obtiene los usuarios que cumplen años hoy en Córdoba
   */
  public getTodayBirthdays(date?: Date) {
    const { day, month } = getCordobaDayAndMonth(date);
    return this.birthdayRepo.getByDate(day, month);
  }

  /**
   * Obtiene los usuarios que cumplen años mañana en Córdoba
   */
  public getTomorrowBirthdays(date?: Date) {
    const { day, month } = getTomorrowCordobaDayAndMonth(date);
    return this.birthdayRepo.getByDate(day, month);
  }

  /**
   * Genera el mensaje de felicitación para los cumpleañeros de hoy (idempotente)
   */
  public async getTodayCelebrationMessage(
    groupJid: string,
    date?: Date
  ): Promise<{ text: string; mentions: string[] } | null> {
    const today = getTodayCordoba(date);
    const jobKey = `birthday_today:${groupJid}:${today}`;

    if (this.jobExecutionRepo.isJobExecuted(jobKey)) {
      return null;
    }

    const celebrants = this.getTodayBirthdays(date);
    if (celebrants.length === 0) return null;

    const messages: string[] = [];
    const mentions: string[] = celebrants.map((c) => c.userJid);

    for (const person of celebrants) {
      const cleanNumber = person.userJid.split('@')[0];
      const isLid = person.userJid.includes('@lid');
      const resolvedName = this.resolveUserName(person.userJid, person.userName);
      const greetingTarget = resolvedName || (isLid ? 'fiera' : cleanNumber);
      const greeting = await this.aiService.generateBirthdayGreeting(greetingTarget, person.gender);
      messages.push(greeting);
    }

    // Registrar ejecución para garantizar idempotencia
    this.jobExecutionRepo.recordJobExecution(jobKey, groupJid);
    return {
      text: messages.join('\n\n'),
      mentions
    };
  }

  /**
   * Genera el aviso de cumpleaños de mañana (idempotente)
   */
  public getTomorrowAdvanceNotification(
    groupJid: string,
    date?: Date
  ): { text: string; mentions: string[] } | null {
    const today = getTodayCordoba(date);
    const jobKey = `birthday_tomorrow_advance:${groupJid}:${today}`;

    if (this.jobExecutionRepo.isJobExecuted(jobKey)) {
      return null;
    }

    const celebrants = this.getTomorrowBirthdays(date);
    if (celebrants.length === 0) return null;

    const mentions: string[] = celebrants.map((c) => c.userJid);
    const labels: string[] = [];

    for (const person of celebrants) {
      const cleanNumber = person.userJid.split('@')[0];
      const isLid = person.userJid.includes('@lid');
      const resolvedName = this.resolveUserName(person.userJid, person.userName);

      if (resolvedName) {
        labels.push(`*${resolvedName}* (@${cleanNumber})`);
      } else if (isLid) {
        labels.push(`un/a integrante del grupo (@${cleanNumber})`);
      } else {
        labels.push(`@${cleanNumber}`);
      }
    }

    const celebrantsText = labels.join(', ');
    const verb = celebrants.length > 1 ? 'cumplen años' : 'cumple años';

    this.jobExecutionRepo.recordJobExecution(jobKey, groupJid);
    return {
      text: `🎂 *¡Aviso de cumpleaños!* Mañana ${verb} ${celebrantsText}. ¡Vayan preparando los saludos y festejos! 🎉🚀`,
      mentions
    };
  }
}
