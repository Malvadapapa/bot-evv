import type { ReminderRepository, ScheduledReminder } from '../database/repositories/reminder.repository.js';
import type { GuardrailsService } from './guardrails.service.js';

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
    private guardrailsService?: GuardrailsService
  ) {}

  /**
   * Intenta parsear un texto (lenguaje natural o comando) para extraer un recordatorio.
   */
  public parseReminderRequest(
    rawText: string,
    senderJid: string,
    senderName: string,
    mentionedJids: string[] = []
  ): ParseReminderResult {
    let text = rawText.trim();

    // Quitar prefijo de comando si existe (/recordar, !recordar, etc.)
    text = text.replace(/^[!\/]recordar\b/i, '').trim();

    // Verificar si contiene disparadores naturales si no vino por comando
    const triggerMatch = text.match(
      /^(?:che\s+)?(?:mequetrefe\s+)?(?:por\s+fa(?:vor)?\s+)?(?:avis[aá](?:le)?|record[aá](?:le)?|recordame|haceme\s+acordar|hac[eé]\s+un\s+aviso|tirale\s+un\s+aviso)(?:\s+|$|:)/i
    );

    const isCommand = rawText.trim().startsWith('/') || rawText.trim().startsWith('!');
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
      text = text.replace(/\b(?:a\s+todos|al\s+grupo|para\s+todos|@todos|@all)\b/i, '').trim();
    }

    // Detectar si se menciona a un tercero (@usuario)
    let targetJid: string | null = null;
    let targetName: string | null = null;

    if (!isGroupBroadcast && mentionedJids.length > 0) {
      // Filtrar el emisor
      const otherMentions = mentionedJids.filter((j) => !j.includes(senderJid));
      if (otherMentions.length > 0) {
        targetJid = otherMentions[0];
      }
    }

    // Si hay un target en texto estilo "a @cristian" o "a cristian"
    const targetMatch = text.match(/\b(?:a|para)\s+@?([a-zA-Z0-9_\.\-]+)\b/i);
    if (!isGroupBroadcast && targetMatch) {
      const candidateName = targetMatch[1].toLowerCase();
      if (!['las', 'los', 'la', 'el', 'eso', 'esto', 'que', 'hoy', 'mañana'].includes(candidateName)) {
        if (!targetJid) {
          targetName = targetMatch[1];
        }
        text = text.replace(targetMatch[0], '').trim();
      }
    }

    // Extraer tiempo
    const timeParse = this.parseTimeString(text);
    if (!timeParse) {
      return {
        isReminder: true,
        error: 'No pude entender la hora o el momento del aviso. Probá con: "a las 18:00", "en 30m" o "mañana a las 9am".'
      };
    }

    // Limpiar conectores del mensaje restante: "que ...", "de ...", ":"
    let cleanMessage = timeParse.remainingText
      .replace(/^(?:que|de|sobre|para|:)\s+/i, '')
      .replace(/[\[\]\(\)]/g, '')
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

    // 1. Relativo: "en X minutos" / "en X horas" / "en 30m" / "en 2h"
    const relativeMatch = input.match(/\ben\s+(\d+)\s*(minutos?|mins?|m|horas?|hs?|h)\b/i);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      let ms = 0;
      let unitLabel = '';

      if (unit.startsWith('m')) {
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
        // Formatear en zona horaria de Córdoba
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
          .replace(/\bmañana\b/i, '')
          .replace(/\bhoy\b/i, '')
          .replace(/\ba\s+las?\b/i, '')
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
    let targetStr = '';
    if (reminder.targetJid === '@all') {
      targetStr = 'Para: el grupo completo\n';
    } else if (reminder.targetJid) {
      const cleanPhone = reminder.targetJid.split('@')[0];
      targetStr = `Para: @${cleanPhone}\n`;
    } else if (reminder.targetName) {
      targetStr = `Para: @${reminder.targetName}\n`;
    }

    return [
      `¡De una! Agendado para ${timeLabel}:`,
      `${targetStr}Mensaje: "${reminder.message}"`,
      `(ID: ${reminder.id})`,
      '',
      `A esa hora le pego el grito 😉`
    ].filter(Boolean).join('\n');
  }

  /**
   * Formatea el aviso final cuando llega la hora pactada
   */
  public formatDeliveryMessage(reminder: ScheduledReminder): { text: string; mentions: string[] } {
    const mentions: string[] = [];
    if (reminder.createdByJid && reminder.createdByJid.includes('@')) {
      mentions.push(reminder.createdByJid);
    }

    // Caso 1: Para el grupo completo
    if (reminder.targetJid === '@all') {
      const text = [
        `Gente, @${reminder.createdByName} dejó este aviso para el grupo:`,
        `"${reminder.message}" 📢`,
        '',
        `¡Están todos avisados!`
      ].join('\n');
      return { text, mentions };
    }

    // Caso 2: Para una tercera persona
    if (reminder.targetJid && reminder.targetJid !== reminder.createdByJid) {
      mentions.push(reminder.targetJid);
      const cleanTarget = reminder.targetJid.split('@')[0];
      const text = [
        `Che @${cleanTarget}, @${reminder.createdByName} me pidió que te haga acordar:`,
        `"${reminder.message}" 🔔`,
        '',
        `¡Avisado estás fiera! 😉`
      ].join('\n');
      return { text, mentions };
    }

    // Caso 3: Auto-recordatorio personal
    const text = [
      `Che @${reminder.createdByName}, acá tenés lo que me pediste que te recuerde:`,
      `"${reminder.message}" 🔔`,
      '',
      `¡Cumplido el encargo compinche!`
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
