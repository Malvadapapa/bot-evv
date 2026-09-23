import type { ReminderRepository, ScheduledReminder } from '../database/repositories/reminder.repository.js';
import type { GuardrailsService } from './guardrails.service.js';
import type { MessageRepository } from '../database/repositories/message.repository.js';
import type { BirthdayRepository } from '../database/repositories/birthday.repository.js';

export interface ParseReminderResult {
  isReminder: boolean;
  targetTimestamp?: number;
  timeLabel?: string;
  message?: string;
  targetJid?: string | null;
  targetName?: string | null;
  isGroupBroadcast?: boolean;
  error?: string;
}

export class ReminderService {
  constructor(
    private reminderRepo: ReminderRepository,
    private timezone: string = 'America/Argentina/Cordoba',
    private guardrailsService?: GuardrailsService,
    private messageRepo?: MessageRepository,
    private botJids: string[] = [],
    private birthdayRepo?: BirthdayRepository
  ) {}

  public setBotJids(jids: string[]): void {
    this.botJids = jids;
  }

  public isBotJid(jid: string): boolean {
    if (!jid) return false;
    const clean = jid.toLowerCase();
    if (clean.includes('143839226503193')) return true; // WhatsApp LID de Mequetrefe
    return this.botJids.some((b) => b && clean.includes(b.toLowerCase()));
  }

  /**
   * Intenta parsear un texto (lenguaje natural o comando) para extraer un recordatorio.
   */
  public parseReminderRequest(
    rawText: string,
    senderJid: string,
    senderName: string,
    mentionedJids: string[] = [],
    isExplicitCommand: boolean = false
  ): ParseReminderResult {
    let text = rawText.trim();

    // Quitar prefijo de comando si existe (/recordar, !recordar, etc.)
    text = text.replace(/^[!\/]recordar\b/i, '').trim();

    // Limpiar mención al bot al inicio si vino en el texto (@Mequetrefe ...)
    text = text.replace(/^@\S+\s+/i, '').trim();

    // Verificar si contiene disparadores naturales si no vino por comando explícito
    const triggerMatch = text.match(
      /^(?:che\s+)?(?:mequetrefe\s+)?(?:bot\s+)?(?:por\s+fa(?:vor)?\s+)?(?:(?:me\s+)?(?:pod[eé]s|podr[ií]as|quer[eé]s|te\s+pido\s+que(?:\s+me)?)\s+)?(?:recordar(?:me|le|nos)?|record[aá](?:me|le|nos)?|recuerd[aá](?:me)?|avisar(?:me|le|nos)?|avis[aá](?:me|le|nos)?|hac[eé](?:me|nos)?\s+acordar|tir[aá](?:le|me)?\s+un\s+aviso)(?:\s+|$|:)/i
    );

    const isCommand = isExplicitCommand || rawText.trim().startsWith('/') || rawText.trim().startsWith('!');
    if (!triggerMatch && !isCommand) {
      return { isReminder: false };
    }

    if (triggerMatch) {
      text = text.slice(triggerMatch[0].length).trim();
    }

    // Detectar si el aviso es para todo el grupo
    let isGroupBroadcast = false;
    if (/\b(?:a\s+todos|al\s+grupo|para\s+todos|@todos|@all)\b/i.test(text)) {
      isGroupBroadcast = true;
      text = text.replace(/\b(?:a\s+todos|al\s+grupo|para\s+todos|@todos|@all)\b/gi, '').trim();
    }

    // Filtrar tanto al emisor como al propio bot de las menciones
    let targetJid: string | null = null;
    let targetName: string | null = null;

    const candidateMentions = mentionedJids.filter(
      (j) => !j.includes(senderJid) && !this.isBotJid(j)
    );

    if (!isGroupBroadcast && candidateMentions.length > 0) {
      targetJid = candidateMentions[0];
      if (this.messageRepo) {
        const resolved = this.messageRepo.getUserNameByJid(targetJid);
        if (resolved) targetName = resolved;
      }
    }

    // Extraer tiempo PRIMERO para evitar colisiones con nombres o destinos
    const timeParse = this.parseTimeString(text);
    if (!timeParse) {
      return {
        isReminder: true,
        error: 'No pude entender la hora o el momento del aviso. Probá con: "en 15 segundos", "a las 18:00", "en 30m" o "mañana a las 9am".'
      };
    }

    let remaining = timeParse.remainingText;

    // Si no se definió targetJid pero hay un destinatario nombrado en texto, ej: "a @Nattalia Coder" o "a Cristian"
    const targetMatch = remaining.match(/\b(?:a|para)\s+@?([a-zA-Z0-9_\.\-]+(?:\s+[a-zA-Z0-9_\.\-]+)?)\b/i);
    if (!isGroupBroadcast && targetMatch) {
      const candidateName = targetMatch[1].trim();
      const lowerCandidate = candidateName.toLowerCase();
      if (!['eso', 'esto', 'que', 'hoy', 'mañana', 'todos'].includes(lowerCandidate)) {
        if (!targetName) {
          targetName = candidateName;
        }
        remaining = remaining.replace(targetMatch[0], '').trim();
      }
    }

    // Si no tiene target ni menciones de terceros, es un auto-recordatorio personal
    if (!isGroupBroadcast && !targetJid && !targetName) {
      targetName = senderName;
    }

    // Limpiar conectores y verbos redundantes del mensaje restante: "que ...", "de ...", "recordame", "avisame", "?"
    let cleanMessage = remaining
      .replace(/^(?:recorda(?:me|le)?|recuerda(?:me)?|avisa(?:me|le)?)\s+/i, '')
      .replace(/^(?:que|de|sobre|para|:)\s+/i, '')
      .replace(/[\[\]\(\)]/g, '')
      .replace(/\?+$/, '')
      .trim();

    if (!cleanMessage || cleanMessage.length < 2) {
      return {
        isReminder: true,
        error: '¿Qué querés que avise? Por favor indicá el mensaje a recordar.'
      };
    }

    return {
      isReminder: true,
      targetTimestamp: timeParse.timestamp,
      timeLabel: timeParse.label,
      message: cleanMessage,
      targetJid,
      targetName,
      isGroupBroadcast
    };
  }

  /**
   * Parsea expresiones de tiempo relativas o absolutas
   */
  public parseTimeString(input: string): { timestamp: number; label: string; remainingText: string } | null {
    const now = new Date();

    // 1. Relativo: "en / dentro de X segundos / minutos / horas"
    const relativeMatch = input.match(
      /\b(?:en|dentro\s+de)\s+(\d+)\s*(segundos?|segs?|s|minutos?|mins?|m|horas?|hs?|h)\b/i
    );
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      let ms = 0;
      let unitLabel = '';

      if (unit.startsWith('s')) {
        ms = amount * 1000;
        unitLabel = amount === 1 ? '1 segundo' : `${amount} segundos`;
      } else if (unit.startsWith('m')) {
        ms = amount * 60 * 1000;
        unitLabel = amount === 1 ? '1 minuto' : `${amount} minutos`;
      } else if (unit.startsWith('h')) {
        ms = amount * 3600 * 1000;
        unitLabel = amount === 1 ? '1 hora' : `${amount} horas`;
      }

      if (ms > 0) {
        const remaining = input.replace(relativeMatch[0], '').trim();
        return {
          timestamp: now.getTime() + ms,
          label: `en ${unitLabel}`,
          remainingText: remaining
        };
      }
    }

    // 2. Absoluto: "mañana a las 9am", "a las 18:30", "hoy a las 20hs", "a las 9", "9:30am"
    const isTomorrow = /\bmañana\b/i.test(input);
    const cleanedForAbs = input.replace(/\bmañana\b/i, '').replace(/\bhoy\b/i, '');

    const absMatch = cleanedForAbs.match(/\ba\s+las?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|hs?|horas?)?\b/i) ||
      cleanedForAbs.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|hs?)?\b/i);

    if (absMatch) {
      let hours = parseInt(absMatch[1], 10);
      let minutes = absMatch[2] ? parseInt(absMatch[2], 10) : 0;
      const meridiem = (absMatch[3] || '').toLowerCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        const target = new Date(now.getTime());
        if (isTomorrow) {
          target.setDate(target.getDate() + 1);
        }

        target.setHours(hours, minutes, 0, 0);

        // Si la hora ya pasó hoy y no dijo mañana, asumimos mañana
        if (!isTomorrow && target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 1);
        }

        const formattedMins = minutes < 10 ? `0${minutes}` : `${minutes}`;
        const dayPrefix = isTomorrow || target.getDate() !== now.getDate() ? 'mañana' : 'hoy';
        const label = `${dayPrefix} a las ${hours}:${formattedMins} hs`;

        const remaining = input
          .replace(absMatch[0], '')
          .replace(/\bmañana\b/gi, '')
          .replace(/\bhoy\b/gi, '')
          .replace(/\ba\s+las?\b/gi, '')
          .trim();

        return {
          timestamp: target.getTime(),
          label,
          remainingText: remaining
        };
      }
    }

    return null;
  }

  /**
   * Crea y guarda un recordatorio validando límites de usuario
   */
  public createReminder(params: {
    groupJid: string;
    createdByJid: string;
    createdByName: string;
    message: string;
    targetTimestamp: number;
    timeLabel: string;
    targetJid?: string | null;
    targetName?: string | null;
    isGroupBroadcast?: boolean;
    isAdmin?: boolean;
  }): { success: boolean; reminder?: ScheduledReminder; error?: string } {
    const isAdmin = params.isAdmin !== undefined ? params.isAdmin : this.checkIsAdmin(params.createdByJid);

    // Límite: máximo 2 activos por usuario común
    if (!isAdmin) {
      const activeCount = this.reminderRepo.countActiveByUser(params.createdByJid);
      if (activeCount >= 2) {
        return {
          success: false,
          error: 'Ya tenés 2 recordatorios pendientes. Esperá a que se cumplan o cancelá uno para agendar otro.'
        };
      }
    }

    const shortId = 'rec_' + Math.random().toString(16).slice(2, 6);
    const reminder: ScheduledReminder = {
      id: shortId,
      groupJid: params.groupJid,
      createdByJid: params.createdByJid,
      createdByName: params.createdByName,
      targetJid: params.isGroupBroadcast ? '@all' : params.targetJid,
      targetName: params.targetName,
      message: params.message,
      targetTimestamp: params.targetTimestamp,
      status: 'pending',
      createdAt: Date.now()
    };

    this.reminderRepo.createReminder(reminder);
    return { success: true, reminder };
  }

  /**
   * Formatea el mensaje de confirmación inmediata
   */
  public formatConfirmationMessage(
    reminder: ScheduledReminder,
    timeLabel: string
  ): string {
    const isSelf = !reminder.targetJid || reminder.targetJid === reminder.createdByJid;
    let targetStr = '';

    if (reminder.targetJid === '@all') {
      targetStr = 'Para: el grupo completo\n';
    } else if (!isSelf) {
      let displayName = reminder.targetName;
      if (!displayName && reminder.targetJid) {
        displayName = this.messageRepo?.getUserNameByJid(reminder.targetJid) || null;
      }
      if (!displayName && reminder.targetJid) {
        displayName = reminder.targetJid.split('@')[0];
      }
      if (displayName) {
        const clean = displayName.replace(/^@/, '');
        targetStr = `Para: @${clean}\n`;
      }
    }

    const openers = [
      `¡De una! Agendado para ${timeLabel}:`,
      `¡Listo! Quedó anotado para ${timeLabel}:`,
      `¡Anotado! Lo guardo para ${timeLabel}:`,
      `¡Dale! Te lo agendé para ${timeLabel}:`
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    const closers = [
      'A esa hora te pego el grito 😉',
      'Tranqui que no se me pasa.',
      'A esa hora aviso.',
      'Dejámelo a mí, a esa hora aviso 😉'
    ];
    const closer = closers[Math.floor(Math.random() * closers.length)];

    return [
      opener,
      `${targetStr}Mensaje: "${reminder.message}"`,
      `(ID: ${reminder.id})`,
      '',
      closer
    ].filter((line) => line !== '').join('\n');
  }

  /**
   * Formatea el aviso final cuando llega la hora pactada
   */
  public formatDeliveryMessage(reminder: ScheduledReminder): { text: string; mentions: string[] } {
    const mentions: string[] = [];
    const senderPhone = reminder.createdByJid.split('@')[0];

    // Caso 1: Para el grupo completo
    if (reminder.targetJid === '@all') {
      if (reminder.createdByJid && reminder.createdByJid.includes('@')) {
        mentions.push(reminder.createdByJid);
      }
      const openers = [
        `Gente, @${senderPhone} dejó este aviso para el grupo:`,
        `Atención grupo, acá va un recado que dejó @${senderPhone}:`,
        `Gente, les paso el recordatorio de @${senderPhone}:`
      ];
      const closers = [
        '¡Están todos avisados!',
        '¡Quedan todos avisados!',
        '¡Avisados todos!'
      ];
      const opener = openers[Math.floor(Math.random() * openers.length)];
      const closer = closers[Math.floor(Math.random() * closers.length)];

      const text = [
        opener,
        `"${reminder.message}" 📢`,
        '',
        closer
      ].join('\n');
      return { text, mentions };
    }

    // Caso 2: Para una tercera persona
    const isSelf = !reminder.targetJid || reminder.targetJid === reminder.createdByJid;
    if (!isSelf) {
      let targetTag = '';
      if (reminder.targetJid) {
        mentions.push(reminder.targetJid);
        const cleanTarget = reminder.targetJid.split('@')[0];
        targetTag = `@${cleanTarget}`;
      } else if (reminder.targetName) {
        targetTag = reminder.targetName.startsWith('@') ? reminder.targetName : `@${reminder.targetName}`;
      }

      if (reminder.createdByJid && reminder.createdByJid.includes('@')) {
        mentions.push(reminder.createdByJid);
      }

      const targetGender = reminder.targetJid ? this.birthdayRepo?.get(reminder.targetJid)?.gender : null;

      const openers = [
        `Che ${targetTag}, @${senderPhone} me pidió que te haga acordar:`,
        `Buenas ${targetTag}, @${senderPhone} me dejó este recado para vos:`,
        `${targetTag}, te paso el aviso que me dejó @${senderPhone}:`
      ];
      const opener = openers[Math.floor(Math.random() * openers.length)];

      let closer = '¡Listo el recado!';
      if (targetGender === 'female') {
        const femaleClosers = ['¡Avisada estás! 😉', '¡Listo el recado reina!', '¡Ahí lo tenés!'];
        closer = femaleClosers[Math.floor(Math.random() * femaleClosers.length)];
      } else if (targetGender === 'male') {
        const maleClosers = ['¡Avisado estás fiera! 😉', '¡Cumplido el encargo campeón!', '¡Listo el recado!'];
        closer = maleClosers[Math.floor(Math.random() * maleClosers.length)];
      } else {
        const neutralClosers = ['¡Avisado estás! 😉', '¡Cumplido el encargo!', '¡Listo el recado!'];
        closer = neutralClosers[Math.floor(Math.random() * neutralClosers.length)];
      }

      const text = [
        opener,
        `"${reminder.message}" 🔔`,
        '',
        closer
      ].join('\n');
      return { text, mentions };
    }

    // Caso 3: Auto-recordatorio personal
    if (reminder.createdByJid && reminder.createdByJid.includes('@')) {
      mentions.push(reminder.createdByJid);
    }

    const senderGender = this.birthdayRepo?.get(reminder.createdByJid)?.gender;

    const openers = [
      `Che @${senderPhone}, acá tenés lo que me pediste que te recuerde:`,
      `Buenas @${senderPhone}, te hago acordar lo que me pediste:`,
      `@${senderPhone}, acá va tu recordatorio:`
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    let closer = '¡Cumplido el encargo!';
    if (senderGender === 'female') {
      const femaleClosers = ['¡Cumplido el encargo reina!', '¡Ahí lo tenés! 😉', '¡Avisada estás!'];
      closer = femaleClosers[Math.floor(Math.random() * femaleClosers.length)];
    } else if (senderGender === 'male') {
      const maleClosers = ['¡Cumplido el encargo compinche!', '¡Ahí lo tenés fiera!', '¡Avisado estás campeón!'];
      closer = maleClosers[Math.floor(Math.random() * maleClosers.length)];
    } else {
      const neutralClosers = ['¡Cumplido el encargo!', '¡Ahí lo tenés!', '¡Avisado estás! 😉'];
      closer = neutralClosers[Math.floor(Math.random() * neutralClosers.length)];
    }

    const text = [
      opener,
      `"${reminder.message}" 🔔`,
      '',
      closer
    ].join('\n');
    return { text, mentions };
  }

  /**
   * Formatea la lista de recordatorios activos del grupo o general para admin
   */
  public formatActiveRemindersList(reminders: ScheduledReminder[], isAdminView: boolean = false): string {
    if (reminders.length === 0) {
      return 'No hay recordatorios pendientes activos en este momento.';
    }

    const lines = [
      isAdminView ? '📋 Recordatorios activos en el sistema (Admin):' : '📋 Recordatorios pendientes del grupo:'
    ];

    for (const r of reminders) {
      const date = new Date(r.targetTimestamp);
      const timeStr = date.toLocaleTimeString('es-AR', {
        timeZone: this.timezone,
        hour: '2-digit',
        minute: '2-digit'
      });
      const dateStr = date.toLocaleDateString('es-AR', {
        timeZone: this.timezone,
        day: '2-digit',
        month: '2-digit'
      });

      let forWhom = 'Personal';
      if (r.targetJid === '@all') forWhom = 'Grupo';
      else if (r.targetJid) forWhom = `@${r.targetJid.split('@')[0]}`;
      else if (r.targetName) forWhom = `@${r.targetName}`;

      lines.push('');
      lines.push(`• ID: \`${r.id}\` | ${dateStr} ${timeStr} hs`);
      if (isAdminView) {
        lines.push(`  Grupo: ${r.groupJid.split('@')[0]} | De: ${r.createdByName}`);
      } else {
        lines.push(`  De: ${r.createdByName} -> Para: ${forWhom}`);
      }
      lines.push(`  "${r.message}"`);
    }

    lines.push('');
    lines.push('Para cancelar alguno: `/cancelar_recordatorio <id>`');
    return lines.join('\n');
  }

  public cancelReminder(id: string, userJid: string, isAdminOverride?: boolean): { success: boolean; message: string } {
    const isAdmin = isAdminOverride !== undefined ? isAdminOverride : this.checkIsAdmin(userJid);
    const result = this.reminderRepo.cancelReminder(id, userJid, isAdmin);
    if (!result.success) {
      return { success: false, message: result.error || 'No se pudo cancelar el recordatorio.' };
    }
    return { success: true, message: `✅ Recordatorio \`${id}\` cancelado con éxito.` };
  }

  public getUserPendingReminders(groupJid: string, userJid: string): ScheduledReminder[] {
    const groupReminders = this.getActiveRemindersByGroup(groupJid);
    return groupReminders.filter((r) => r.createdByJid === userJid || r.targetJid === userJid);
  }

  public getDueReminders(nowTimestamp: number = Date.now()): ScheduledReminder[] {
    return this.reminderRepo.getDueReminders(nowTimestamp);
  }

  public markAsSent(id: string): boolean {
    return this.reminderRepo.markAsSent(id);
  }

  public getActiveRemindersByGroup(groupJid: string): ScheduledReminder[] {
    return this.reminderRepo.getActiveRemindersByGroup(groupJid);
  }

  public getAllActiveReminders(): ScheduledReminder[] {
    return this.reminderRepo.getAllActiveReminders();
  }

  private checkIsAdmin(userJid: string): boolean {
    if (this.guardrailsService) {
      return this.guardrailsService.isAdmin(userJid);
    }
    return false;
  }
}
