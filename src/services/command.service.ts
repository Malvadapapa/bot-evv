import { SummaryService } from './summary.service.js';
import { MentionService } from './mention.service.js';
import { ContextMarkerService, type MarkerResult } from './context-marker.service.js';
import { BirthdayService } from './birthday.service.js';
import { StatisticsService } from './statistics.service.js';

import type { SchedulerService } from './scheduler.service.js';
import type { NewsService } from './news.service.js';
import type { HoroscopeService, ZodiacSignInfo } from './horoscope.service.js';
import type { AIService } from './ai.service.js';
import type { GuardrailsService } from './guardrails.service.js';
import type { ReminderService } from './reminder.service.js';
import { getRandomFemaleAffirmation } from '../config/character.js';
import { CURRENT_VERSION, buildUpdateBroadcastMessage } from '../config/changelog.js';

export interface CommandExecutionResult {
  handled: boolean;
  replyText?: string;
  quotedMessageId?: string;
  action?: 'group_approved' | 'group_rejected';
  actionGroupJid?: string;
}

export class CommandService {
  constructor(
    private summaryService: SummaryService,
    private mentionService: MentionService,
    private contextMarkerService: ContextMarkerService,
    private birthdayService: BirthdayService,
    private statisticsService: StatisticsService,
    private schedulerService?: SchedulerService,
    private newsService?: NewsService,
    private horoscopeService?: HoroscopeService,
    private aiService?: AIService,
    private adminPhoneSuffix: string = '3811',
    private guardrailsService?: GuardrailsService,
    private reminderService?: ReminderService
  ) {}

  public isCommand(text: string): boolean {
    const trimmed = text.trim();
    return (
      trimmed.startsWith('/') ||
      trimmed.startsWith('!') ||
      /^(?:@\S+\s+)?(?:\/|!|test!\w+\b|test\w+\b)/i.test(trimmed)
    );
  }

  public async executeCommand(
    groupJid: string,
    senderJid: string,
    senderName: string,
    text: string,
    mentionedJids: string[] = []
  ): Promise<CommandExecutionResult> {
    const cleanText = text.replace(/^@\S+\s+/i, '').trim();
    const isExplicitCmd =
      cleanText.startsWith('/') ||
      cleanText.startsWith('!') ||
      /^test!\w+\b/i.test(cleanText) ||
      /^test\w+\b/i.test(cleanText);

    if (!isExplicitCmd) {
      return { handled: false };
    }

    let stripped = cleanText;
    if (stripped.startsWith('/') || stripped.startsWith('!')) {
      stripped = stripped.slice(1).trim();
    }

    const parts = stripped.split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Verificación de seguridad: comandos test!
    const isTestCommand = commandName.startsWith('test!') || commandName.startsWith('testnoticias') || commandName.startsWith('testcomentario');
    if (isTestCommand) {
      if (!this.checkAdminPermission(senderJid, senderName)) {
        return {
          handled: true,
          replyText: '⛔ Este comando de prueba está reservado exclusivamente para el administrador del bot.'
        };
      }
    }

    switch (commandName) {
      case 'test!noticias':
      case 'testnoticias': {
        if (this.schedulerService) {
          try {
            await this.schedulerService.sendMorningBriefing(groupJid, true);
            return { handled: true };
          } catch (err: any) {
            return {
              handled: true,
              replyText: `⚠️ Error ejecutando test de noticias: ${err?.message || err}`
            };
          }
        }
        return {
          handled: true,
          replyText: '🧪 [Test Noticias] SchedulerService no configurado para despachar el saludo.'
        };
      }

      case 'test!comentario':
      case 'testcomentario': {
        const topic = args.join(' ').trim();
        if (!topic) {
          return {
            handled: true,
            replyText: '💡 Uso: *test!comentario <temática o texto>* (ej: `test!comentario a cristian lo dejo la novia`)'
          };
        }
        if (this.aiService) {
          try {
            const chimeIn = await this.aiService.generateSpontaneousChimeIn(`Conversación del grupo: "${topic}"`);
            return { handled: true, replyText: `🧪 *[TEST ACOTACIÓN]*\n\n${chimeIn}` };
          } catch (err: any) {
            return {
              handled: true,
              replyText: `⚠️ Error generando comentario de prueba: ${err?.message || err}`
            };
          }
        }
        return {
          handled: true,
          replyText: '🧪 [Test Comentario] AIService no configurado.'
        };
      }

      case 'noticias':
      case 'news': {
        const requestedCount = args[0] ? parseInt(args[0], 10) : 1;
        const count = isNaN(requestedCount) || requestedCount < 1 ? 1 : Math.min(requestedCount, 5);

        if (this.schedulerService) {
          try {
            await this.schedulerService.sendNewsBriefingOnly(groupJid, count);
            return { handled: true };
          } catch (err: any) {
            return {
              handled: true,
              replyText: `⚠️ Error al despachar noticias: ${err?.message || err}`
            };
          }
        }

        if (this.newsService) {
          const newsItems = await this.newsService.getLatestUnpublishedNews(count);
          if (newsItems.length === 0) {
            return { handled: true, replyText: '📰 No hay noticias nuevas disponibles en este momento.' };
          }
          const formatted = newsItems.map((n) => this.newsService!.formatSingleNewsItem(n)).join('\n\n---\n\n');
          return { handled: true, replyText: formatted };
        }

        return { handled: true, replyText: '⚠️ Servicio de noticias no disponible.' };
      }

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

      case 'registrarse':
      case 'registro':
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
              replyText: `🎂 Tu fecha de registro es el *${existing.day}/${existing.month}*${genderLabel}.\n\n_Para actualizar fecha o pronombre: /registrarse DD/MM el  o  /registrarse DD/MM ella_`
            };
          }
          return {
            handled: true,
            replyText: `📝 Aún no te has registrado.\nUsa */registrarse DD/MM el* o */registrarse DD/MM ella* (ej: */registrarse 15/05 el*) para registrar tu cumpleaños y saber cómo tratarte cuando hablemos 🎉.`
          };
        }

        const parsed = this.birthdayService.parseRegistrationInput(args.join(' '));

        // Caso 1: Solo envió pronombre/género
        if (!parsed.hasDate && parsed.hasGender && parsed.gender) {
          const genderText = parsed.gender === 'female' ? 'ella' : 'él';
          const vocativo = parsed.gender === 'female' ? 'genia' : 'crack';
          this.birthdayService.updateGender(senderJid, parsed.gender);
          return {
            handled: true,
            replyText: `✅ ¡Anotado ${vocativo}! De ahora en adelante me referiré a vos como *${genderText}*. ¡Gracias por avisarme! 😊✨`
          };
        }

        // Caso 2: Formato inválido sin fecha válida ni pronombre
        if (!parsed.hasDate) {
          return {
            handled: true,
            replyText: `⚠️ Formato de fecha inválido o no reconocido. Podés usar:\n• */registrarse DD/MM el* (ej: /registrarse 15/05 el)\n• */registrarse DD/MM ella* (ej: /registrarse 15/05 ella)\n• */registrarse el*  o  */registrarse ella*`
          };
        }

        // Caso 3: Envió fecha (y opcionalmente pronombre en una sola línea)
        const existing = this.birthdayService.getBirthday(senderJid);
        const finalGender = parsed.gender || existing?.gender || null;
        this.birthdayService.registerBirthday(senderJid, parsed.day!, parsed.month!, finalGender);

        if (finalGender) {
          const genderText = finalGender === 'female' ? 'ella' : 'él';
          return {
            handled: true,
            replyText: `✅ ¡De diez! Te registraste para el *${parsed.day}/${parsed.month}* y te trataré como *${genderText}*. ¡Festejaremos a pleno en tu día! 🎂🎉`
          };
        }

        return {
          handled: true,
          replyText: `🎂 ¡Anotado! Guardé tu cumpleaños para el *${parsed.day}/${parsed.month}* 🎉.\n\n¿Preferís que me refiera a vos como *él* o *ella*? Respondeme con */registrarse el* o */registrarse ella* así te trato de diez cuando charlemos!`
        };
      }

      case 'h':
      case 'horoscopo': {
        if (!this.horoscopeService) {
          return { handled: true, replyText: '⚠️ Servicio de horóscopo no disponible.' };
        }

        let isFull = false;
        let signInput: string | null = null;

        for (const arg of args) {
          const lower = arg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (lower === 'largo' || lower === 'full' || lower === 'completo') {
            isFull = true;
          } else if (!signInput) {
            signInput = arg;
          }
        }

        let sign: ZodiacSignInfo | null = null;

        if (signInput) {
          sign = this.horoscopeService.resolveSign(signInput);
          if (!sign) {
            const availableSigns = this.horoscopeService.getAllSignNames().join(', ');
            return {
              handled: true,
              replyText: `⚠️ Signo no reconocido: "*${signInput}*".\n\nLos signos válidos son: ${availableSigns}.`
            };
          }
        } else {
          const birthday = this.birthdayService.getBirthday(senderJid);
          if (!birthday || birthday.day <= 0 || birthday.month <= 0) {
            return {
              handled: true,
              replyText: [
                '🔮 *Horóscopo Diario*',
                'No tengo registrado tu cumpleaños para saber tu signo del zodíaco.',
                '',
                '👉 Registralo usando */registrarse DD/MM* (ej: */registrarse 15/05*) para consultarlo con */h*, o pedí directamente el signo que quieras (ej: */h virgo* o */h largo libra*).'
              ].join('\n')
            };
          }
          sign = this.horoscopeService.getSignFromDate(birthday.day, birthday.month);
        }

        try {
          let reply = await this.horoscopeService.getDailyHoroscope(sign, isFull);
          const birthday = this.birthdayService.getBirthday(senderJid);
          if (birthday?.gender === 'female') {
            const affirmation = getRandomFemaleAffirmation();
            if (affirmation) {
              reply += `\n\n${affirmation}`;
            }
          }
          return { handled: true, replyText: reply };
        } catch (err: any) {
          return {
            handled: true,
            replyText: `⚠️ No pude obtener el horóscopo para *${sign.nameEs}*: ${err?.message || err}`
          };
        }
      }

      case 'top': {
        const reply = this.statisticsService.formatTopLeaderboard(groupJid, 10);
        return { handled: true, replyText: reply };
      }

      case 'ayuda':
      case 'help': {
        const helpLines = [
          '🤖 *COMANDOS DISPONIBLES EN EL BOT*',
          '---------------------------------------',
          '• */resumen* → Genera un resumen inteligente del día con checkpoint.',
          '• */menciones [pág]* → Muestra tus menciones recientes en el grupo.',
          '• */marcar* → Muestra el contexto de conversación de tu última mención.',
          '• */registrarse DD/MM el / ella* → Registra tu fecha de cumpleaños y pronombre.',
          '• */h [signo]* → Tu horóscopo diario (por tu cumpleaños) o el de otro signo.',
          '• */h largo [signo]* → Predicción completa y extendida del horóscopo.',
          '• */top* → Ranking de los 10 participantes más activos del grupo.',
          '• */noticias [n]* → Envía 1 o más noticias tech (ej: /noticias o /noticias 2).',
          '• */recordar <hora> <mensaje>* → Programa un aviso en el grupo (ej: /recordar 18:00 traer carbón).',
          '• */recordatorios* → Ver los avisos pendientes activos.',
          '• */cancelar_recordatorio <id>* → Cancelar un aviso programado.',
          '• */novedades* → Muestra las novedades, mejoras y arreglos de la última versión.',
          '• */version* → Muestra la versión actual, estado y cambios recientes.',
          '• *test!noticias* / *test!comentario* → Comandos de prueba (solo admin).',
          '• */ayuda* → Muestra esta guía de comandos.',
          '---------------------------------------',
          '💡 _Para conversar libremente con la IA, mencióname directamente: @Bot tu pregunta_'
        ];

        if (this.checkAdminPermission(senderJid, senderName)) {
          helpLines.push(
            '',
            '👑 *COMANDOS DE ADMINISTRADOR*',
            '---------------------------------------',
            '• */admin <tel>* → Designar un nuevo admin.',
            '• */admin quitar <tel>* → Revocar admin.',
            '• */admin listar* → Ver lista de administradores.',
            '• */apodo <tel> <apodos>* → Asociar apodos para entromisión.',
            '• */aprobar <id_solicitud>* → Aprobar ingreso a grupo.',
            '• */rechazar <id_solicitud>* → Rechazar ingreso y salir.',
            '• */backup* → Generar y exportar copia de seguridad.',
            '• */config [clave] [valor]* → Ver o cambiar configuración.',
            '• */actualizar* → Descargar cambios de Git, compilar y reiniciar.'
          );
        }

        return { handled: true, replyText: helpLines.join('\n') };
      }

      case 'admin': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }

        const sub = args[0]?.toLowerCase();
        if (sub === 'listar' || sub === 'list') {
          const admins = this.guardrailsService.getAllAdmins();
          const list = admins.map((a, i) => `${i + 1}. +${a.phone} (alta: ${a.addedBy})`).join('\n');
          return {
            handled: true,
            replyText: `👑 *ADMINISTRADORES REGISTRADOS:*\n${list || 'No hay admins registrados.'}`
          };
        }

        if (sub === 'quitar' || sub === 'remove' || sub === 'del') {
          const targetPhone = args[1];
          if (!targetPhone) {
            return { handled: true, replyText: '⚠️ Uso: */admin quitar <teléfono>* (ej: /admin quitar 5493512345678)' };
          }
          const ok = this.guardrailsService.removeAdmin(targetPhone);
          return {
            handled: true,
            replyText: ok
              ? `✅ Teléfono +${targetPhone.replace(/\D/g, '')} revocado como administrador.`
              : `⚠️ No se encontró al teléfono +${targetPhone.replace(/\D/g, '')} en la lista de administradores.`
          };
        }

        // Si se pasa directamente un teléfono (ej: /admin 5493512345678 o /admin agregar 549351...)
        const rawPhone = sub === 'agregar' || sub === 'add' ? args[1] : args[0];
        if (rawPhone && rawPhone.replace(/\D/g, '').length >= 6) {
          const cleanPhone = rawPhone.replace(/\D/g, '');
          this.guardrailsService.addAdmin(cleanPhone, senderName);
          return {
            handled: true,
            replyText: `✅ ¡Listo! +${cleanPhone} ha sido registrado como nuevo administrador.`
          };
        }

        return {
          handled: true,
          replyText: [
            '👑 *GESTIÓN DE ADMINISTRADORES*',
            '---------------------------------------',
            '• */admin <teléfono>* → Designar nuevo administrador.',
            '• */admin quitar <teléfono>* → Revocar rol de admin.',
            '• */admin listar* → Ver administradores activos.',
            '---------------------------------------',
            '💡 Podés ejecutar esto en privado con el bot.'
          ].join('\n')
        };
      }

      case 'aprobar': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }
        let requestId = args[0]?.trim();
        if (!requestId) {
          if (groupJid.endsWith('@g.us')) {
            const pending = this.guardrailsService.getPendingRequestByGroup(groupJid);
            if (pending) {
              requestId = pending.id;
            } else {
              this.guardrailsService.authorizeGroup(groupJid, 'Grupo Aprobado por Administrador', senderJid);
              return {
                handled: true,
                replyText: '✅ ¡Grupo autorizado exitosamente por el Administrador! Mequetrefe ya está activo en este grupo.',
                action: 'group_approved',
                actionGroupJid: groupJid
              };
            }
          } else {
            const pendingList = this.guardrailsService.getAllPendingRequests();
            if (pendingList.length === 0) {
              return { handled: true, replyText: '📋 No hay solicitudes de ingreso pendientes en este momento.' };
            }
            if (pendingList.length === 1) {
              requestId = pendingList[0].id;
            } else {
              const lines = [
                '📋 *SOLICITUDES DE GRUPO PENDIENTES:*',
                '---------------------------------------'
              ];
              for (const req of pendingList) {
                lines.push(`• *${req.id}*: "${req.groupName}"\n  👉 Para aprobar: */aprobar ${req.id}*`);
              }
              return { handled: true, replyText: lines.join('\n') };
            }
          }
        }
        const res = this.guardrailsService.approveGroupJoinRequest(requestId, senderJid);
        return {
          handled: true,
          replyText: res.message,
          action: res.success ? 'group_approved' : undefined,
          actionGroupJid: res.request?.groupJid
        };
      }

      case 'rechazar': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }
        const requestId = args[0]?.trim();
        if (!requestId) {
          return { handled: true, replyText: '⚠️ Uso: */rechazar <id_solicitud>* (ej: /rechazar SOL-101)' };
        }
        const res = this.guardrailsService.rejectGroupJoinRequest(requestId, senderJid);
        return {
          handled: true,
          replyText: res.message,
          action: res.success ? 'group_rejected' : undefined,
          actionGroupJid: res.request?.groupJid
        };
      }

      case 'backup': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }
        try {
          const backup = this.guardrailsService.createBackup();
          return {
            handled: true,
            replyText: `${backup.summary}\n\n💾 Archivo almacenado de forma segura en el servidor.`
          };
        } catch (err: any) {
          return {
            handled: true,
            replyText: `❌ Error al generar backup: ${err?.message || err}`
          };
        }
      }

      case 'config': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }

        const key = args[0]?.toLowerCase();
        const value = args.slice(1).join(' ');

        if (!key) {
          const all = this.guardrailsService.getAllConfig();
          const list = Object.entries(all).map(([k, v]) => `• *${k}:* \`${v}\``).join('\n');
          return {
            handled: true,
            replyText: `⚙️ *CONFIGURACIÓN DINÁMICA DEL BOT*\n---------------------------------------\n${list || 'Sin configuración registrada.'}\n\nUso: */config <clave> <nuevo_valor>*`
          };
        }

        if (!value) {
          const curVal = this.guardrailsService.getConfig(key);
          return {
            handled: true,
            replyText: curVal ? `⚙️ *${key}:* \`${curVal}\`` : `⚠️ La clave "${key}" no existe.`
          };
        }

        this.guardrailsService.setConfig(key, value);
        return {
          handled: true,
          replyText: `✅ Configuración actualizada: *${key}* = \`${value}\``
        };
      }

      case 'apodo':
      case 'apodos': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        if (!this.guardrailsService) {
          return { handled: true, replyText: '⚠️ Servicio de guardrails no configurado.' };
        }

        const sub = args[0]?.toLowerCase();
        if (sub === 'listar' || sub === 'list') {
          const all = this.guardrailsService.getAllAliases();
          if (all.length === 0) {
            return { handled: true, replyText: '📋 No hay apodos ni palabras clave registradas.' };
          }
          const grouped = new Map<string, string[]>();
          for (const item of all) {
            const list = grouped.get(item.userPhone) || [];
            list.push(item.alias);
            grouped.set(item.userPhone, list);
          }
          const lines: string[] = ['📋 *APODOS Y PALABRAS DE ACTIVACIÓN:*'];
          for (const [phone, aliases] of grouped.entries()) {
            lines.push(`• +${phone}: ${aliases.join(', ')}`);
          }
          return { handled: true, replyText: lines.join('\n') };
        }

        if (sub === 'quitar' || sub === 'remove' || sub === 'del') {
          const targetPhone = args[1];
          const targetAlias = args.slice(2).join(' ').trim();
          if (!targetPhone || !targetAlias) {
            return { handled: true, replyText: '⚠️ Uso: */apodo quitar <teléfono> <apodo>* (ej: /apodo quitar 5493512345678 batichica)' };
          }
          const ok = this.guardrailsService.removeAlias(targetPhone, targetAlias);
          return {
            handled: true,
            replyText: ok
              ? `✅ Apodo "${targetAlias}" eliminado para +${targetPhone.replace(/\D/g, '')}.`
              : `⚠️ No se encontró el apodo "${targetAlias}" para +${targetPhone.replace(/\D/g, '')}.`
          };
        }

        // Formato: /apodo <tel> <apodo1, apodo2, apodo3...>
        const rawPhone = args[0];
        if (rawPhone && rawPhone.replace(/\D/g, '').length >= 6) {
          const rawAliases = args.slice(1).join(' ');
          if (!rawAliases) {
            return {
              handled: true,
              replyText: '⚠️ Por favor indicá uno o más apodos separados por coma o espacio.\nEjemplo: */apodo 3517883811 batichica, negra, morocha*'
            };
          }

          const aliasList = rawAliases
            .split(/[,;\n]+/)
            .map((a) => a.trim())
            .filter((a) => a.length >= 2);

          if (aliasList.length === 0) {
            return { handled: true, replyText: '⚠️ No se especificaron apodos válidos (mínimo 2 letras).' };
          }

          const added = this.guardrailsService.addAliases(rawPhone, aliasList, senderName);
          const cleanPhone = rawPhone.replace(/\D/g, '');
          return {
            handled: true,
            replyText: `✅ ¡Listo! Se asociaron los siguientes apodos a +${cleanPhone}:\n• ${added.join(', ')}\n\n_Cuando alguien los mencione en el grupo, Mequetrefe se entrometerá etiquetándola 😉_`
          };
        }

        return {
          handled: true,
          replyText: [
            '🏷️ *SISTEMA DE APODOS Y ENTROMISIÓN*',
            '---------------------------------------',
            '• */apodo <tel> <apodos...>* → Asociar apodos a un número.',
            '  _Ej: /apodo 3517883811 batichica, morocha, reina_',
            '• */apodo quitar <tel> <apodo>* → Quitar un apodo específico.',
            '• */apodo listar* → Ver todos los apodos registrados.',
            '---------------------------------------',
            '💡 Cuando alguien use esa palabra en el grupo, el bot intervendrá con onda.'
          ].join('\n')
        };
      }

      case 'actualizar':
      case 'update': {
        if (!this.checkAdminPermission(senderJid, senderName)) {
          return { handled: true, replyText: '⛔ Este comando está reservado exclusivamente para administradores.' };
        }
        try {
          const { execSync } = await import('child_process');
          const pullOutput = execSync('git pull origin main', { encoding: 'utf-8', timeout: 30000 });
          const buildOutput = execSync('npm run build', { encoding: 'utf-8', timeout: 60000 });

          setTimeout(() => {
            console.log('🔄 [Auto-Update] Reiniciando proceso para cargar nueva versión...');
            process.exit(0);
          }, 3000);

          return {
            handled: true,
            replyText: [
              '🚀 *ACTUALIZACIÓN EXITOSA*',
              '---------------------------------------',
              '📥 *Git:* Cambios descargados.',
              '🔨 *Build:* Código compilado en dist/',
              '🔄 *Mequetrefe se reiniciará en 3 segundos...*',
              '---------------------------------------',
              '💡 PM2 restaurará el proceso automáticamente con la nueva versión.'
            ].join('\n')
          };
        } catch (err: any) {
          return {
            handled: true,
            replyText: `❌ *Error durante la actualización:*\n\`\`\`${err?.message || err}\`\`\``
          };
        }
      }

      case 'novedades':
      case 'changelog':
      case 'cambios': {
        const isBroadcast = args[0]?.toLowerCase() === 'broadcast';
        if (isBroadcast) {
          if (!this.checkAdminPermission(senderJid, senderName)) {
            return {
              handled: true,
              replyText: '⛔ La difusión masiva de novedades está reservada para el administrador.'
            };
          }
          if (this.schedulerService) {
            const msg = buildUpdateBroadcastMessage(CURRENT_VERSION);
            const sent = await this.schedulerService.broadcastCustomMessage(msg);
            return {
              handled: true,
              replyText: `📢 Novedades v${CURRENT_VERSION.version} enviadas con éxito a ${sent.length} grupo(s).`
            };
          }
        }

        return {
          handled: true,
          replyText: buildUpdateBroadcastMessage(CURRENT_VERSION)
        };
      }

      case 'recordar':
      case 'recordatorio':
      case 'aviso': {
        if (!this.reminderService) {
          return {
            handled: true,
            replyText: '⚠️ El servicio de recordatorios no está disponible en este momento.'
          };
        }

        const inputArgs = args.join(' ').trim();
        if (!inputArgs) {
          return {
            handled: true,
            replyText: [
              '💡 *Cómo usar el comando /recordar:*',
              '',
              '• `/recordar a las 18:00 que compren hielo`',
              '• `/recordar en 30 minutos sacar las pizzas`',
              '• `/recordar mañana a las 9am @cristian acordate del turno`',
              '• `/recordar a todos hoy a las 21hs reunión`',
              '',
              'También podés pedírmelo directamente en lenguaje natural: _"Mequetrefe avisá a las 18hs que traigan hielo"_'
            ].join('\n')
          };
        }

        const parsed = this.reminderService.parseReminderRequest(
          inputArgs,
          senderJid,
          senderName,
          mentionedJids,
          true
        );

        if (!parsed.isReminder || parsed.error || !parsed.targetTimestamp || !parsed.timeLabel || !parsed.message) {
          return {
            handled: true,
            replyText: parsed.error || '⚠️ No pude entender el recordatorio. Por favor indicá el momento (ej: "a las 18:00", "en 20m") y el mensaje.'
          };
        }

        const isAdmin = this.checkAdminPermission(senderJid, senderName);
        const result = this.reminderService.createReminder({
          groupJid,
          createdByJid: senderJid,
          createdByName: senderName,
          message: parsed.message,
          targetTimestamp: parsed.targetTimestamp,
          timeLabel: parsed.timeLabel,
          targetJid: parsed.targetJid,
          targetName: parsed.targetName,
          isGroupBroadcast: parsed.isGroupBroadcast,
          isAdmin
        });

        if (!result.success || !result.reminder) {
          return {
            handled: true,
            replyText: `⚠️ ${result.error || 'No se pudo agendar el recordatorio.'}`
          };
        }

        const confirmation = this.reminderService.formatConfirmationMessage(result.reminder, parsed.timeLabel);
        return {
          handled: true,
          replyText: confirmation
        };
      }

      case 'recordatorios':
      case 'misrecordatorios': {
        if (!this.reminderService) {
          return {
            handled: true,
            replyText: '⚠️ El servicio de recordatorios no está disponible en este momento.'
          };
        }

        const isAdmin = this.checkAdminPermission(senderJid, senderName);
        const isDm = !groupJid.endsWith('@g.us');

        if (isAdmin && (isDm || args[0]?.toLowerCase() === 'todos')) {
          const reminders = this.reminderService.getAllActiveReminders();
          return {
            handled: true,
            replyText: this.reminderService.formatActiveRemindersList(reminders, true)
          };
        }

        const reminders = this.reminderService.getActiveRemindersByGroup(groupJid);
        return {
          handled: true,
          replyText: this.reminderService.formatActiveRemindersList(reminders, false)
        };
      }

      case 'cancelar_recordatorio':
      case 'cancelarrecordatorio':
      case 'borrarrecordatorio': {
        if (!this.reminderService) {
          return {
            handled: true,
            replyText: '⚠️ El servicio de recordatorios no está disponible en este momento.'
          };
        }

        const id = args[0]?.trim();
        if (!id) {
          return {
            handled: true,
            replyText: '⚠️ Indicá el ID del recordatorio a cancelar (ej: `/cancelar_recordatorio rec_a1b2`). Podés consultar los IDs con `/recordatorios`.'
          };
        }

        const isAdmin = this.checkAdminPermission(senderJid, senderName);
        const res = this.reminderService.cancelReminder(id, senderJid, isAdmin);
        return {
          handled: true,
          replyText: res.message
        };
      }

      case 'version':
      case 'v': {
        const lines = [
          `🤖 *MEQUETREFE BOT - VERSIÓN v${CURRENT_VERSION.version}*`,
          `📅 *Fecha:* ${CURRENT_VERSION.date}`,
          `🎯 *${CURRENT_VERSION.title}*`,
          '---------------------------------------'
        ];

        if (CURRENT_VERSION.highlights && CURRENT_VERSION.highlights.length > 0) {
          lines.push('✨ *Novedades y Mejoras:*');
          for (const h of CURRENT_VERSION.highlights) {
            lines.push(`• ${h}`);
          }
        }

        if (CURRENT_VERSION.fixes && CURRENT_VERSION.fixes.length > 0) {
          if (CURRENT_VERSION.highlights && CURRENT_VERSION.highlights.length > 0) {
            lines.push('');
          }
          lines.push('🛠️ *Correcciones:*');
          for (const f of CURRENT_VERSION.fixes) {
            lines.push(`• ${f}`);
          }
        }

        lines.push('---------------------------------------');
        lines.push('🚀 *Entorno:* Windows Server VPS (PM2 24/7)');
        lines.push('🔄 *Auto-Deploy:* GitHub Actions');
        lines.push('💡 _Tirá `/ayuda` para ver todos los comandos disponibles._');

        return { handled: true, replyText: lines.join('\n') };
      }

      default:
        return {
          handled: true,
          replyText: `❓ Comando no reconocido: \`/${commandName}\`. Escribe */ayuda* para ver los comandos disponibles.`
        };
    }
  }

  public checkAdminPermission(senderJid: string, senderName: string = ''): boolean {
    if (this.guardrailsService && this.guardrailsService.isAdmin(senderJid)) {
      return true;
    }
    const senderPhone = senderJid.replace(/@.*$/, '');
    const adminTokens = this.adminPhoneSuffix
      ? this.adminPhoneSuffix.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : ['3811', '266180782755958'];

    return (
      adminTokens.some(
        (token) =>
          senderPhone.endsWith(token) ||
          senderPhone === token ||
          senderJid.toLowerCase().includes(token)
      ) ||
      (senderName.toLowerCase() === 'cristian' && senderJid.includes('lid'))
    );
  }
}
