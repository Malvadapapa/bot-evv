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

    // Quitar prefijo de comando si existe (/recordar, /recordatorio, !recordar, etc.)
    text = text.replace(/^[!\/]recordar(?:io)?\b/i, '').trim();

    // Limpiar mención al bot al inicio si vino en el texto (@Mequetrefe ...), pero sin quitar @all ni @todos
    text = text.replace(/^@(?!all\b|todos\b)\S+\s+/i, '').trim();

    // Detectar si el aviso es para todo el grupo (puede venir antes o después del disparador)
    let isGroupBroadcast = false;
    const groupPattern = /(?:^|\s)(?:para\s+|al?\s+)?(?:@all|@todos|todos?\s+los?\s+(?:miembros?|integrantes?)(?:\s+del\s+grupo)?|todos?\s+los?\s+del\s+grupo|todo\s+el\s+grupo|el\s+grupo|grupo|todos?|la\s+gente)(?:\s+|$|:)/i;
    const groupMatch = text.match(groupPattern);
    if (groupMatch) {
      isGroupBroadcast = true;
      text = text.replace(groupMatch[0], ' ').trim();
    }

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

    // Si aún no se detectó grupo al inicio, verificar si quedó después del disparador
    if (!isGroupBroadcast) {
      const postTriggerGroupMatch = text.match(groupPattern);
      if (postTriggerGroupMatch) {
        isGroupBroadcast = true;
        text = text.replace(postTriggerGroupMatch[0], ' ').trim();
      }
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

    // Verificar si el grupo estaba después de la expresión de tiempo
    if (!isGroupBroadcast) {
      const remainingGroupMatch = remaining.match(groupPattern);
      if (remainingGroupMatch) {
        isGroupBroadcast = true;
        remaining = remaining.replace(remainingGroupMatch[0], ' ').trim();
      }
    }

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

    // Limpiar conectores y verbos redundantes del mensaje restante: "quiero que avises que...", "recordame", etc.
    let cleanMessage = remaining
      .replace(/^(?:quiero\s+que\s+)?(?:record(?:ar|[áa]me|[áa]le|[áa]les|es|[áa])?|recuerd(?:e|es|a|ame)?|avis(?:ar|[áa]me|[áa]le|[áa]les|es|[áa])?|dec(?:ir|ile|iles)?|hace(?:me|les)?\s+acordar)\s+/i, '')
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
      targetStr = 'Para: el grupo completo (@all)\n';
    } else if (!isSelf) {
      let displayName = reminder.targetName;
      if (!displayName && reminder.targetJid) {
        displayName = this.messageRepo?.getUserNameByJid(reminder.targetJid) || null;
      }
      if (displayName) {
        const clean = displayName.replace(/^@/, '');
        targetStr = `Para: @${clean}\n`;
      } else if (reminder.targetJid && !reminder.targetJid.includes('@lid')) {
        targetStr = `Para: @${reminder.targetJid.split('@')[0]}\n`;
      }
    }

    const openers = [
      `¡De una! Agendado para ${timeLabel}:`,
      `¡Listo! Quedó anotado para ${timeLabel}:`,
      `¡Anotado! Lo guardo para ${timeLabel}:`,
      `¡Dale! Te lo agendé para ${timeLabel}:`,
      `¡Impecable! Lo dejé registrado para ${timeLabel}:`
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    const closers = [
      'A esa hora te pego el grito 😉',
      'Tranqui que no se me pasa.',
      'A esa hora aviso sin falta.',
      'Dejámelo a mí, a esa hora aviso 😉',
      'Despreocupate que te tengo cubierto 🚀'
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
    const isCreatorBot = this.isBotJid(reminder.createdByJid);
    const creatorIsLid = reminder.createdByJid.includes('@lid');
    const creatorPhone = reminder.createdByJid.split('@')[0];
    const resolvedCreatorName = reminder.createdByName || this.messageRepo?.getUserNameByJid(reminder.createdByJid);

    let creatorLabel = '';
    if (!isCreatorBot) {
      if (creatorIsLid && resolvedCreatorName && resolvedCreatorName !== 'Usuario') {
        creatorLabel = `*${resolvedCreatorName}* (@${creatorPhone})`;
      } else if (!creatorIsLid) {
        creatorLabel = `@${creatorPhone}`;
      } else {
        creatorLabel = 'alguien del grupo';
      }
    }

    // Caso 1: Para el grupo completo (@all)
    if (reminder.targetJid === '@all') {
      if (!isCreatorBot && reminder.createdByJid && reminder.createdByJid.includes('@')) {
        mentions.push(reminder.createdByJid);
      }

      let openers: string[];
      if (isCreatorBot) {
        openers = [
          '📢 *¡Atención @all!* Acá va un recordatorio para el grupo:',
          '📢 *¡Aviso general @all!* Les paso este recordatorio:',
          '📢 *¡Che @all!* Recuerden este aviso para el grupo:',
          '📢 *¡Gente @all!* Pego el grito con este aviso que teníamos pendiente:'
        ];
      } else {
        openers = [
          `📢 *¡Atención @all!* ${creatorLabel} dejó este aviso para el grupo:`,
          `📢 *¡Gente @all!* ${creatorLabel} me pidió que les recuerde:`,
          `📢 *¡Che @all!* De parte de ${creatorLabel}, acá va este aviso:`,
          `📢 *¡Oído al bife @all!* Les paso el recado que dejó ${creatorLabel}:`
        ];
      }

      const closers = [
        '¡Están todos avisados che! 😉',
        '¡Quedan todos avisados! No se hagan los desentendidos después 😂',
        '¡Avisados todos! A ponerle onda 🚀',
        '¡Listo el recado para la banda! ✨',
        '¡Cosa avisada, cosa cumplida! 😉'
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
      const targetIsLid = reminder.targetJid ? reminder.targetJid.includes('@lid') : false;
      const cleanTarget = reminder.targetJid ? reminder.targetJid.split('@')[0] : '';
      const resolvedTargetName = reminder.targetName || (reminder.targetJid ? this.messageRepo?.getUserNameByJid(reminder.targetJid) : null);

      if (reminder.targetJid) {
        mentions.push(reminder.targetJid);
      }

      if (targetIsLid && resolvedTargetName) {
        targetTag = `*${resolvedTargetName}* (@${cleanTarget})`;
      } else if (cleanTarget) {
        targetTag = `@${cleanTarget}`;
      } else {
        targetTag = 'che';
      }

      if (!isCreatorBot && reminder.createdByJid && reminder.createdByJid.includes('@')) {
        mentions.push(reminder.createdByJid);
      }

      const targetGender = reminder.targetJid ? this.birthdayRepo?.get(reminder.targetJid)?.gender : null;

      let openers: string[];
      if (isCreatorBot) {
        openers = [
          `Che ${targetTag}, acá va el recordatorio pactado:`,
          `Buenas ${targetTag}, te pego el grito con tu aviso:`,
          `${targetTag}, acá tenés el recordatorio:`
        ];
      } else {
        openers = [
          `Che ${targetTag}, ${creatorLabel} me pidió que te haga acordar:`,
          `Buenas ${targetTag}, ${creatorLabel} te dejó este recado:`,
          `${targetTag}, te paso el aviso que me dejó ${creatorLabel}:`,
          `¡Oído al bife ${targetTag}! ${creatorLabel} me encargó este recordatorio para vos:`
        ];
      }
      const opener = openers[Math.floor(Math.random() * openers.length)];

      let closer = '¡Listo el recado!';
      if (targetGender === 'female') {
        const femaleClosers = ['¡Avisada estás! 😉', '¡Listo el recado reina!', '¡Ahí lo tenés! ✨', '¡Que no se te pase genia! 🌸'];
        closer = femaleClosers[Math.floor(Math.random() * femaleClosers.length)];
      } else if (targetGender === 'male') {
        const maleClosers = ['¡Avisado estás fiera! 😉', '¡Cumplido el encargo campeón!', '¡Listo el recado maestro!', '¡Que no se te pase crack! 🚀'];
        closer = maleClosers[Math.floor(Math.random() * maleClosers.length)];
      } else {
        const neutralClosers = ['¡Avisado estás! 😉', '¡Cumplido el encargo!', '¡Listo el recado!', '¡Que no se te pase! ✨'];
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
    if (!isCreatorBot && reminder.createdByJid && reminder.createdByJid.includes('@')) {
      mentions.push(reminder.createdByJid);
    }

    const senderGender = this.birthdayRepo?.get(reminder.createdByJid)?.gender;
    const personalTag = creatorIsLid && resolvedCreatorName ? `*${resolvedCreatorName}* (@${creatorPhone})` : `@${creatorPhone}`;

    const openers = [
      `Che ${personalTag}, acá tenés lo que me pediste que te recuerde:`,
      `Buenas ${personalTag}, te hago acordar lo que me dejaste anotado:`,
      `${personalTag}, acá va tu recordatorio:`,
      `¡Pego el grito como me pediste ${personalTag}! Acá tenés:`
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    let closer = '¡Cumplido el encargo!';
    if (senderGender === 'female') {
      const femaleClosers = ['¡Cumplido el encargo reina!', '¡Ahí lo tenés! 😉', '¡Avisada estás genia!', '¡Que no se te pase reina! 🌸'];
      closer = femaleClosers[Math.floor(Math.random() * femaleClosers.length)];
    } else if (senderGender === 'male') {
      const maleClosers = ['¡Cumplido el encargo compinche!', '¡Ahí lo tenés fiera!', '¡Avisado estás campeón!', '¡Que no se te pase crack! 🚀'];
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
      if (r.targetJid === '@all') {
        forWhom = 'Grupo (@todos)';
      } else if (r.targetName) {
        forWhom = r.targetName.startsWith('@') ? r.targetName : `@${r.targetName}`;
      } else if (r.targetJid) {
        const resolved = this.messageRepo?.getUserNameByJid(r.targetJid);
        if (resolved) {
          forWhom = `@${resolved}`;
        } else if (!r.targetJid.includes('@lid')) {
          forWhom = `@${r.targetJid.split('@')[0]}`;
        } else {
          forWhom = 'integrante';
        }
      }

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
