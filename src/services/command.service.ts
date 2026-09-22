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
import { getRandomFemaleAffirmation } from '../config/character.js';

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
    private guardrailsService?: GuardrailsService
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
    text: string
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
              replyText: `🎂 Tu fecha de registro es el *${existing.day}/${existing.month}*${genderLabel}.\n\n_Para actualizar fecha: /registrarse DD/MM [el/ella]_\n_Para configurar tu pronombre: /registrarse el  o  /registrarse ella_`
            };
          }
          return {
            handled: true,
            replyText: `📝 Aún no te has registrado.\nUsa */registrarse DD/MM [el/ella]* (ej: /registrarse 15/05 el  o  /registrarse 15/05 ella) para registrar tu cumpleaños y saber cómo tratarte cuando hablemos 🎉.`
          };
        }

        const firstArg = args[0].toLowerCase();

        // Actualización directa de pronombre / género (ej: /registrarse el o /registrarse ella)
        if (firstArg === 'el' || firstArg === 'él' || firstArg === 'ella') {
          const gender = firstArg === 'ella' ? 'female' : 'male';
          const genderText = gender === 'female' ? 'ella' : 'él';
          const vocativo = gender === 'female' ? 'genia' : 'crack';
          this.birthdayService.updateGender(senderJid, gender);
          return {
            handled: true,
            replyText: `✅ ¡Anotado ${vocativo}! De ahora en adelante me referiré a vos como *${genderText}*. ¡Gracias por avisarme! 😊✨`
          };
        }

        const dateParsed = this.birthdayService.parseBirthday(args[0]);
        if (!dateParsed) {
          return {
            handled: true,
            replyText: `⚠️ Formato de fecha inválido. Por favor usa */registrarse DD/MM [el/ella]* (ej: /registrarse 15/05 ella) o */registrarse el / ella* para configurar tu pronombre.`
          };
        }

        // Si envió pronombre/género como segundo argumento (ej: /registrarse 15/05 ella)
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
            replyText: `✅ ¡De diez! Te registraste para el *${dateParsed.day}/${dateParsed.month}* y me referiré a vos como *${genderText}*. ¡Te festejaremos a pleno en tu día! 🎂🎉`
          };
        }

        const existing = this.birthdayService.getBirthday(senderJid);
        if (existing?.gender) {
          const genderText = existing.gender === 'female' ? 'ella' : 'él';
          return {
            handled: true,
            replyText: `✅ ¡Listo! Te registraste para el *${dateParsed.day}/${dateParsed.month}* (te trataré como *${genderText}*). 🎂🎉`
          };
        }

        return {
          handled: true,
          replyText: `🎂 ¡Anotado! Guardé tu cumpleaños para el *${dateParsed.day}/${dateParsed.month}* 🎉.\n\n¿Preferís que me refiera a vos como *él* o *ella*? Respondeme con */registrarse el* o */registrarse ella* así te trato de diez cuando charlemos o te saludemos! 😊`
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
          '• */registrarse [DD/MM]* → Registra tu fecha de cumpleaños y pronombre.',
          '• */h [signo]* → Tu horóscopo diario (por tu cumpleaños) o el de otro signo.',
          '• */h largo [signo]* → Predicción completa y extendida del horóscopo.',
          '• */top* → Ranking de los 10 participantes más activos del grupo.',
          '• */noticias [n]* → Envía 1 o más noticias tech (ej: /noticias o /noticias 2).',
          '• */version* → Muestra la versión actual y estado del bot.',
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
            return { handled: true, replyText: '⚠️ Uso: */aprobar <id_solicitud>* (ej: /aprobar SOL-101)' };
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

      case 'version':
      case 'v': {
        const reply = [
          '🤖 *MEQUETREFE BOT - ESTADO DEL SISTEMA*',
          '---------------------------------------',
          '📦 *Versión:* v1.1.0',
          '🚀 *Entorno:* Windows Server VPS (PM2 24/7)',
          '🔄 *Sincronización:* GitHub Actions Auto-Deploy Activo',
          '🧠 *IA:* Meta AI + Groq Qwen Fallback',
          '🛡️ *Guardrails:* Rate Limiting, Batería Social & DMs',
          '✨ *Módulos:* Horóscopo, Noticias, Resúmenes, Apodos & Efemérides',
          '---------------------------------------',
          '💡 _Todo marchando de diez fiera!_'
        ].join('\n');
        return { handled: true, replyText: reply };
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
