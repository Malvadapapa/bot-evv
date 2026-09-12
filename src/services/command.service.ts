import { SummaryService } from './summary.service.js';
import { MentionService } from './mention.service.js';
import { ContextMarkerService, type MarkerResult } from './context-marker.service.js';
import { BirthdayService } from './birthday.service.js';
import { StatisticsService } from './statistics.service.js';

export interface CommandExecutionResult {
  handled: boolean;
  replyText?: string;
  quotedMessageId?: string;
}

export class CommandService {
  constructor(
    private summaryService: SummaryService,
    private mentionService: MentionService,
    private contextMarkerService: ContextMarkerService,
    private birthdayService: BirthdayService,
    private statisticsService: StatisticsService
  ) {}

  public isCommand(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.startsWith('/') || /^(?:@\S+\s+)?\//i.test(trimmed);
  }

  public async executeCommand(
    groupJid: string,
    senderJid: string,
    senderName: string,
    text: string
  ): Promise<CommandExecutionResult> {
    const cleanText = text.replace(/^@\S+\s+/i, '').trim();
    if (!cleanText.startsWith('/')) {
      return { handled: false };
    }

    const parts = cleanText.slice(1).trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (commandName) {
      case 'resumen': {
        try {
          const reply = await this.summaryService.getOrGenerateSummary(groupJid);
          return { handled: true, replyText: reply };
        } catch (err: any) {
          return { handled: true, replyText: `⚠️ Error al generar resumen: ${err?.message || err}` };
        }
      }

      case 'menciones': {
        const page = args[0] ? parseInt(args[0], 10) : 1;
        const pageNum = isNaN(page) || page < 1 ? 1 : page;
        const reply = this.mentionService.getUserMentionsFormatted(senderJid, pageNum, 5);
        return { handled: true, replyText: reply };
      }

      case 'marcar': {
        const marker = this.contextMarkerService.getContextForUser(groupJid, senderJid, 3, 3);
        return {
          handled: true,
          replyText: marker.text,
          quotedMessageId: marker.quotedMessageId
        };
      }

      case 'micumple': {
        if (args.length === 0) {
          const existing = this.birthdayService.getBirthday(senderJid);
          if (existing && existing.day > 0) {
            const genderLabel =
              existing.gender === 'female'
                ? ' (ella)'
                : existing.gender === 'male'
                ? ' (él)'
                : ' _(sin preferencia de él/ella configurada)_';
            return {
              handled: true,
              replyText: `🎂 Tu fecha de cumpleaños registrada es el *${existing.day}/${existing.month}*${genderLabel}.\n\n_Para actualizar fecha: /micumple DD/MM [el/ella]_\n_Para configurar tu pronombre: /micumple el  o  /micumple ella_`
            };
          }
          return {
            handled: true,
            replyText: `🎂 Aún no tienes un cumpleaños registrado.\nUsa */micumple DD/MM [el/ella]* (ej: /micumple 15/05 el  o  /micumple 15/05 ella) para registrarlo y saber cómo tratarte cuando hablemos 🎉.`
          };
        }

        const firstArg = args[0].toLowerCase();

        // Actualización directa de pronombre / género (ej: /micumple el o /micumple ella)
        if (firstArg === 'el' || firstArg === 'él' || firstArg === 'ella') {
          const gender = firstArg === 'ella' ? 'female' : 'male';
          const genderText = gender === 'female' ? 'ella' : 'él';
          this.birthdayService.updateGender(senderJid, gender);
          return {
            handled: true,
            replyText: `✅ ¡Anotado fiera! De ahora en adelante me referiré a vos como *${genderText}*. ¡Gracias por avisarme! 😊✨`
          };
        }

        const dateParsed = this.birthdayService.parseBirthday(args[0]);
        if (!dateParsed) {
          return {
            handled: true,
            replyText: `⚠️ Formato de fecha inválido. Por favor usa */micumple DD/MM [el/ella]* (ej: /micumple 15/05 ella) o */micumple el / ella* para configurar tu pronombre.`
          };
        }

        // Si envió pronombre/género como segundo argumento (ej: /micumple 15/05 ella)
        let gender: 'male' | 'female' | null = null;
        if (args[1]) {
          const secondArg = args[1].toLowerCase();
          if (secondArg === 'el' || secondArg === 'él') gender = 'male';
          else if (secondArg === 'ella') gender = 'female';
        }

        this.birthdayService.registerBirthday(senderJid, dateParsed.day, dateParsed.month, gender);

        if (gender) {
          const genderText = gender === 'female' ? 'ella' : 'él';
          return {
            handled: true,
            replyText: `✅ ¡De diez! Guardé tu cumpleaños para el *${dateParsed.day}/${dateParsed.month}* y me referiré a vos como *${genderText}*. ¡Te festejaremos a pleno en tu día! 🎂🎉`
          };
        }

        const existing = this.birthdayService.getBirthday(senderJid);
        if (existing?.gender) {
          const genderText = existing.gender === 'female' ? 'ella' : 'él';
          return {
            handled: true,
            replyText: `✅ ¡Listo! Guardé tu cumpleaños para el *${dateParsed.day}/${dateParsed.month}* (te trataré como *${genderText}*). 🎂🎉`
          };
        }

        return {
          handled: true,
          replyText: `🎂 ¡Anotado! Guardé tu cumpleaños para el *${dateParsed.day}/${dateParsed.month}* 🎉.\n\n¿Preferís que me refiera a vos como *él* o *ella*? Respondeme con */micumple el* o */micumple ella* así te trato de diez cuando charlemos o te saludemos! 😊`
        };
      }

      case 'top': {
        const reply = this.statisticsService.formatTopLeaderboard(groupJid, 10);
        return { handled: true, replyText: reply };
      }

      case 'ayuda':
      case 'help': {
        const helpText = [
          '🤖 *COMANDOS DISPONIBLES EN EL BOT*',
          '---------------------------------------',
          '• */resumen* → Genera un resumen inteligente del día con checkpoint.',
          '• */menciones [pág]* → Muestra tus menciones recientes en el grupo.',
          '• */marcar* → Muestra el contexto de conversación de tu última mención.',
          '• */micumple [DD/MM]* → Registra o consulta tu fecha de cumpleaños.',
          '• */top* → Ranking de los 10 participantes más activos del grupo.',
          '• */ayuda* → Muestra esta guía de comandos.',
          '---------------------------------------',
          '💡 _Para conversar libremente con la IA, mencióname directamente: @Bot tu pregunta_'
        ].join('\n');
        return { handled: true, replyText: helpText };
      }

      default:
        return {
          handled: true,
          replyText: `❓ Comando no reconocido: \`/${commandName}\`. Escribe */ayuda* para ver los comandos disponibles.`
        };
    }
  }
}
