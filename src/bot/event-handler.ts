import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import {
  getMessageText,
  getMentionedJids,
  getSenderJid,
  getQuotedContext
} from '../utils/message.js';
import { MessageRepository } from '../database/repositories/message.repository.js';
import { BirthdayRepository } from '../database/repositories/birthday.repository.js';
import { MentionService } from '../services/mention.service.js';
import { StatisticsRepository } from '../database/repositories/statistics.repository.js';
import { CommandService } from '../services/command.service.js';
import { AIService } from '../services/ai.service.js';
import { character } from '../config/character.js';
import type { ChatMessage } from '../ai/types.js';
import type { GuardrailsService } from '../services/guardrails.service.js';
import type { ReminderService } from '../services/reminder.service.js';

export interface EventHandlerConfig {
  getSocket: () => WASocket | null;
  messageRepo: MessageRepository;
  mentionService: MentionService;
  statsRepo: StatisticsRepository;
  commandService: CommandService;
  aiService: AIService;
  guardrailsService?: GuardrailsService;
  birthdayRepo?: BirthdayRepository;
  reminderService?: ReminderService;
  botCleanJid?: string;
  botLid?: string;
  targetGroupJid?: string;
  userCooldownMs?: number;
  groupCooldownMs?: number;
  dryRun?: boolean;
  spontaneousChance?: number;
  spontaneousCooldownMs?: number;
  spontaneousMessageInterval?: number;
  userOnboardingCooldownMs?: number;
}

export class EventHandler {
  private processedMsgIds = new Set<string>();
  private userCooldowns = new Map<string, number>();
  private groupCooldowns = new Map<string, number>();
  private spontaneousCooldowns = new Map<string, number>();
  private groupMessageCounters = new Map<string, number>();
  private userOnboardingCooldowns = new Map<string, number>();
  private botJokeMsgIds = new Set<string>();

  constructor(private config: EventHandlerConfig) {}

  public async handleMessage(msg: WAMessage): Promise<void> {
    const msgId = msg.key.id;
    const remoteJid = msg.key.remoteJid || '';
    const fromMe = msg.key.fromMe;

    // 0. Regla: Ignorar estados de WhatsApp (@broadcast)
    if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast')) {
      return;
    }

    // 1. Regla: Ignorar mensajes propios para evitar bucles infinitos
    if (fromMe) return;

    // 2. Regla: Deduplicación de eventos
    if (!msgId || this.processedMsgIds.has(msgId)) return;
    this.addProcessedId(msgId);

    const isGroup = remoteJid.endsWith('@g.us');
    const text = getMessageText(msg).trim();
    const senderJid = getSenderJid(msg);
    const pushName = msg.pushName || 'Usuario';

    // Evitar bucle si el sender coincide con el JID o LID del bot
    const isBotSender =
      (this.config.botCleanJid && senderJid === this.config.botCleanJid) ||
      (this.config.botLid && senderJid === this.config.botLid) ||
      (this.config.reminderService && this.config.reminderService.isBotJid(senderJid)) ||
      senderJid.includes('143839226503193');
    if (isBotSender) {
      return;
    }

    // 3. Regla: Gatekeeper de Grupos y Privados (DMs)
    if (!isGroup) {
      // Mensajes privados: Solo administradores autorizados y exclusivamente para comandos
      const isAdmin = this.config.guardrailsService
        ? this.config.guardrailsService.isAdmin(senderJid)
        : false;

      if (!isAdmin) {
        // Silencio absoluto para usuarios comunes en privado
        return;
      }

      if (!this.config.commandService.isCommand(text)) {
        return;
      }
    } else {
      // Grupos: Si el grupo no está autorizado, ignorar completamente (no registrar, no responder)
      const isAuthorized = this.config.guardrailsService
        ? this.config.guardrailsService.isGroupAuthorized(remoteJid)
        : (!this.config.targetGroupJid || remoteJid === this.config.targetGroupJid);

      if (!isAuthorized) {
        // Excepción: Si quien escribe es admin y está ejecutando /aprobar en este grupo, permitirlo
        const isAdmin = this.config.commandService.checkAdminPermission(senderJid, pushName);
        const isApproving = text.startsWith('/aprobar') || text.startsWith('!aprobar');
        if (isAdmin && isApproving) {
          // Continuar hacia el CommandService para autorizarlo directamente
        } else {
          return;
        }
      }
    }

    const rawTimestamp = msg.messageTimestamp;
    const timestamp = typeof rawTimestamp === 'number'
      ? (rawTimestamp < 1e11 ? rawTimestamp * 1000 : rawTimestamp)
      : Date.now();
    const mentionedJids = getMentionedJids(msg);

    // 4. Ingestión Pasiva: Registrar mensajes y menciones en grupos autorizados
    if (text && isGroup) {
      this.config.messageRepo.save({
        id: msgId,
        groupJid: remoteJid,
        senderJid,
        senderName: pushName,
        content: text,
        timestamp
      });

      this.config.mentionService.recordMentions(
        remoteJid,
        msgId,
        senderJid,
        pushName,
        text,
        mentionedJids,
        timestamp
      );

      this.config.statsRepo.recordMessage(remoteJid, senderJid, pushName, timestamp);
    }

    const sock = this.config.getSocket();
    if (!sock) return;

    // Resolver JID limpio del bot y su LID de WhatsApp
    const botFullId = sock.user?.id || '';
    const botCleanJid = this.config.botCleanJid || (botFullId ? botFullId.split(':')[0] + '@s.whatsapp.net' : '');
    const botLid = sock.user?.lid ? sock.user.lid.split(':')[0] + '@lid' : (this.config.botLid || '');

    const botPhoneNum = botCleanJid.split('@')[0];
    const botLidNum = botLid ? botLid.split('@')[0] : '';

    // Verificar si el grupo autorizado necesita presentación inicial (Onboarding primer ingreso)
    const isApproving = text.startsWith('/aprobar') || text.startsWith('!aprobar');
    if (isGroup && !isApproving && this.config.guardrailsService && !this.config.guardrailsService.isIntroSent(remoteJid)) {
      this.config.guardrailsService.markIntroSent(remoteJid);
      const introMsg = 'Hola a todos 👋 Soy Mequetrefe, el bot asistente de este grupo. Estoy acá para dar una mano con recordatorios, menciones, resúmenes y tirar un poco de onda. Para ver qué puedo hacer, tiren /ayuda. ¡Un gusto sumarme!';
      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN Intro] en ${remoteJid}: "${introMsg}"`);
      } else {
        try {
          await sock.sendMessage(remoteJid, { text: introMsg });
        } catch (e: any) {
          console.warn(`⚠️ [Guardrails] Error enviando intro a ${remoteJid}:`, e?.message || e);
        }
      }
    }

    // 5. Manejo de Comandos Explícitos (/resumen, /menciones, /marcar, /registrarse, /top, /ayuda, /admin, etc.)
    if (this.config.commandService.isCommand(text)) {
      if (this.config.guardrailsService) {
        const commandName = text.trim().split(/\s+/)[0];
        const rateLimitCheck = this.config.guardrailsService.checkCommandRateLimit(
          senderJid,
          pushName,
          remoteJid,
          commandName
        );
        if (!rateLimitCheck.allowed) {
          console.log(`🛡️ [Guardrails] Comando bloqueado por rate limit: ${senderJid} -> ${commandName} (${rateLimitCheck.reason})`);
          return;
        }
      }

      try {
        console.log(`⚡ [Comando] De ${pushName} en ${remoteJid}: "${text}"`);
        const cmdResult = await this.config.commandService.executeCommand(
          remoteJid,
          senderJid,
          pushName,
          text,
          mentionedJids
        );

        if (cmdResult.handled && cmdResult.replyText) {
          if (this.config.dryRun) {
            console.log(`🧪 [DRY_RUN] Comando ejecutado para ${remoteJid}: "${cmdResult.replyText.slice(0, 80)}..."`);
          } else {
            const quoteOption = cmdResult.quotedMessageId
              ? { quoted: { key: { id: cmdResult.quotedMessageId, remoteJid } } as any }
              : { quoted: msg };

            await sock.sendMessage(remoteJid, { text: cmdResult.replyText }, quoteOption);
          }
        }

        // Acciones automáticas de administración (Aprobar o Rechazar grupo)
        if (cmdResult.action === 'group_approved' && cmdResult.actionGroupJid) {
          if (this.config.guardrailsService) {
            const alreadySent = this.config.guardrailsService.isIntroSent(cmdResult.actionGroupJid);
            this.config.guardrailsService.markIntroSent(cmdResult.actionGroupJid);
            // Solo enviar saludo si se aprobó por mensaje privado (desde fuera del grupo) y no se había enviado
            if (!alreadySent && cmdResult.actionGroupJid !== remoteJid) {
              const introMsg = 'Hola a todos 👋 Soy Mequetrefe, el bot asistente de este grupo. Estoy acá para dar una mano con recordatorios, menciones, resúmenes y tirar un poco de onda. Para ver qué puedo hacer, tiren /ayuda. ¡Un gusto sumarme!';
              await sock.sendMessage(cmdResult.actionGroupJid, { text: introMsg });
            }
          }
        } else if (cmdResult.action === 'group_rejected' && cmdResult.actionGroupJid) {
          try {
            await sock.groupLeave(cmdResult.actionGroupJid);
            console.log(`👋 [Guardrails] Bot salió del grupo rechazado: ${cmdResult.actionGroupJid}`);
          } catch (e: any) {
            console.warn(`⚠️ [Guardrails] Error al salir del grupo rechazado ${cmdResult.actionGroupJid}:`, e?.message || e);
          }
        }
      } catch (err: any) {
        console.error(`❌ Error ejecutando comando en ${remoteJid}:`, err?.message || err);
      }
      return;
    }

    // 6. Activación conversacional en grupos
    let isQuotingBot = false;
    const quoted = getQuotedContext(msg);

    // Lista de nombres dinámicos de respaldo en texto plano (@Perfil, @Mequetrefe, etc.)
    const profileName = sock.user?.name || '';
    const dynamicNames = Array.from(
      new Set([character.displayName, character.keyName, profileName, 'bot', 'vector'])
    ).filter((n) => Boolean(n && n.trim().length > 1));
    const nameRegex = new RegExp(`@(${dynamicNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

    if (isGroup) {
      // Incrementar contador de mensajes de charla activa en el grupo
      const currentCount = (this.groupMessageCounters.get(remoteJid) || 0) + 1;
      this.groupMessageCounters.set(remoteJid, currentCount);

      const isMentioned =
        // Detección nativa de WhatsApp por JID telefónico o LID de la cuenta
        (botPhoneNum && mentionedJids.some((j) => j.includes(botPhoneNum))) ||
        (botLidNum && mentionedJids.some((j) => j.includes(botLidNum))) ||
        // Detección de respaldo por texto plano
        nameRegex.test(text);

      isQuotingBot = Boolean(
        quoted?.participant &&
        (
          (botPhoneNum && quoted.participant.includes(botPhoneNum)) ||
          (botLidNum && quoted.participant.includes(botLidNum))
        )
      );

      // Si no fue mencionado ni citado en el grupo
      if (!isMentioned && !isQuotingBot) {
        // Opción 0: Evaluar si se mencionó algún apodo o palabra de activación de una chica
        if (this.config.guardrailsService) {
          const matchedAlias = this.findMatchingAlias(text);
          if (matchedAlias && matchedAlias.userJid !== senderJid) {
            // Verificar cooldown de 3 horas para halagarla espontáneamente
            if (this.config.guardrailsService.canFlirtSpontaneously(matchedAlias.userJid)) {
              if (Math.random() < 0.45) {
                await this.handleAliasChimeIn(msg, remoteJid, text, matchedAlias, sock);
                return;
              }
            }
          }
        }

        // Opción A: Evaluar posible intervención espontánea sobre miembros clave
        const targetMember = this.detectTargetMember(text);
        if (targetMember && this.shouldTriggerSpontaneous(remoteJid)) {
          await this.handleSpontaneousIntervention(msg, remoteJid, text, targetMember, sock);
          return;
        }

        // Opción B: Acotación espontánea por acumulación de mensajes conversacionales
        const interval = this.config.spontaneousMessageInterval ?? 18;
        if (currentCount >= interval && this.shouldTriggerSpontaneous(remoteJid)) {
          this.groupMessageCounters.set(remoteJid, 0);
          await this.handleConversationalChimeIn(msg, remoteJid, sock);
          return;
        }

        return;
      }
    }

    // 7. Batería Social (15 preguntas/interacciones por hora por usuario con degradación progresiva)
    let socialBatteryDirective: string | undefined;
    if (this.config.guardrailsService) {
      const battery = this.config.guardrailsService.checkSocialBattery(senderJid, pushName);
      if (!battery.allowed) {
        console.log(`🔋 [Batería Social] Silencio absoluto para ${pushName} (${senderJid}) - Límite de 15 superado.`);
        return;
      }

      if (battery.level === 'exhausted' && battery.finalMessage) {
        console.log(`🔋 [Batería Social] Nivel 15 para ${pushName} (${senderJid}). Enviando mensaje de cierre.`);
        if (this.config.dryRun) {
          console.log(`🧪 [DRY_RUN Batería Social] ${battery.finalMessage}`);
        } else {
          const sent = await sock.sendMessage(remoteJid, { text: battery.finalMessage }, { quoted: msg });
          const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
          this.addProcessedId(botMsgId);
          this.config.messageRepo.save({
            id: botMsgId,
            groupJid: remoteJid,
            senderJid: botCleanJid,
            senderName: character.displayName,
            content: battery.finalMessage,
            timestamp: Date.now()
          });
        }
        return;
      }

      socialBatteryDirective = battery.personalityDirective;
    }

    // 8. Verificación de Cooldowns para interacción conversacional directa
    const now = Date.now();
    // Anti-flood por usuario (1.2s para evitar duplicados rápidos sin bloquear conversación)
    const userCooldown = this.config.userCooldownMs ?? 1200;
    const lastUserTime = this.userCooldowns.get(senderJid) || 0;
    if (now - lastUserTime < userCooldown) {
      console.log(`⏱️ [Cooldown] Ignorado flood de ${pushName} en ${remoteJid}`);
      return;
    }

    this.userCooldowns.set(senderJid, now);
    this.groupCooldowns.set(remoteJid, now);

    // 8.5. Intercepción de recordatorios en lenguaje natural (ej: "Mequetrefe avisá a las 18:00 que compren hielo")
    if (this.config.reminderService) {
      const candidateReminderText = text.replace(/^@\S+\s+/i, '').trim();
      const reminderParsed = this.config.reminderService.parseReminderRequest(
        candidateReminderText,
        senderJid,
        pushName,
        mentionedJids
      );

      if (reminderParsed.isReminder) {
        if (reminderParsed.error || !reminderParsed.targetTimestamp || !reminderParsed.timeLabel || !reminderParsed.message) {
          const errReply = reminderParsed.error || '⚠️ No pude entender el horario del aviso. Probá con: "a las 18:00", "en 30m" o "mañana a las 9am".';
          if (this.config.dryRun) {
            console.log(`🧪 [DRY_RUN Recordatorio] Error: ${errReply}`);
          } else {
            await sock.sendMessage(remoteJid, { text: errReply }, { quoted: msg });
          }
          return;
        }

        const isAdmin = this.config.commandService.checkAdminPermission(senderJid, pushName);
        const result = this.config.reminderService.createReminder({
          groupJid: remoteJid,
          createdByJid: senderJid,
          createdByName: pushName,
          message: reminderParsed.message,
          targetTimestamp: reminderParsed.targetTimestamp,
          timeLabel: reminderParsed.timeLabel,
          targetJid: reminderParsed.targetJid,
          targetName: reminderParsed.targetName,
          isGroupBroadcast: reminderParsed.isGroupBroadcast,
          isAdmin
        });

        if (!result.success || !result.reminder) {
          const errMsg = `⚠️ ${result.error || 'No se pudo agendar el recordatorio.'}`;
          if (this.config.dryRun) {
            console.log(`🧪 [DRY_RUN Recordatorio] Límite: ${errMsg}`);
          } else {
            await sock.sendMessage(remoteJid, { text: errMsg }, { quoted: msg });
          }
          return;
        }

        const confirmMsg = this.config.reminderService.formatConfirmationMessage(
          result.reminder,
          reminderParsed.timeLabel
        );

        if (this.config.dryRun) {
          console.log(`🧪 [DRY_RUN Recordatorio] Confirmado: ${confirmMsg}`);
        } else {
          const sent = await sock.sendMessage(remoteJid, { text: confirmMsg }, { quoted: msg });
          const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
          this.addProcessedId(botMsgId);
          this.config.messageRepo.save({
            id: botMsgId,
            groupJid: remoteJid,
            senderJid: botCleanJid,
            senderName: character.displayName,
            content: confirmMsg,
            timestamp: Date.now()
          });
        }
        return;
      }
    }

    // 9. Generar respuesta conversacional vía IA con contexto real y género
    try {
      console.log(`🎯 [Interacción] ${pushName} habló con el bot en ${remoteJid}: "${text}"`);

      try {
        await sock.readMessages([msg.key]);
      } catch {}

      await sock.sendPresenceUpdate('composing', remoteJid);

      // Limpiar texto de menciones directas
      let cleanPrompt = text;
      if (botPhoneNum) cleanPrompt = cleanPrompt.replace(new RegExp(`@${botPhoneNum}`, 'gi'), '');
      if (botLidNum) cleanPrompt = cleanPrompt.replace(new RegExp(`@${botLidNum}`, 'gi'), '');
      cleanPrompt = cleanPrompt.replace(nameRegex, '').trim();

      // Obtener contexto de mensajes recientes del grupo (últimos 6)
      const recentStored = this.config.messageRepo.getRecentMessages(remoteJid, 6);
      const recentHistory: ChatMessage[] = recentStored.map((m) => {
        const isBotSender =
          (botPhoneNum && m.senderJid.includes(botPhoneNum)) ||
          (botLidNum && m.senderJid.includes(botLidNum));
        return {
          role: isBotSender ? 'assistant' : 'user',
          senderName: m.senderName,
          text: m.content,
          timestamp: m.timestamp
        };
      });

      // Detectar preferencia de género/pronombre si existe
      const userProfile = this.config.birthdayRepo?.get(senderJid);
      const userGender = userProfile?.gender || null;

      // Detectar si el usuario está respondiendo a una broma que hizo el bot
      const isReplyingToBotJoke = Boolean(quoted?.stanzaId && this.botJokeMsgIds.has(quoted.stanzaId));

      // Piropos cordobeses para mujeres: probabilidad base 60% si no fue halagada en las últimas 3 horas
      let isFlirting = false;
      if (userGender === 'female') {
        const canFlirt = this.config.guardrailsService
          ? this.config.guardrailsService.canFlirtSpontaneously(senderJid)
          : true;

        if (canFlirt && Math.random() < 0.60) {
          isFlirting = true;
          this.config.guardrailsService?.recordSpontaneousFlirt(senderJid);
        }
      }

      let aiReply = await this.config.aiService.generateGroupReply(
        remoteJid,
        cleanPrompt,
        pushName,
        recentHistory,
        {
          userGender,
          userName: pushName,
          isFlirting,
          isReplyingToBotJoke,
          personalityDirective: socialBatteryDirective
        }
      );

      // Onboarding proactivo: si no tiene registrado cumpleaños o género
      const hasBirthday = Boolean(userProfile && userProfile.day > 0 && userProfile.month > 0);
      const hasGender = Boolean(userProfile && (userProfile.gender === 'male' || userProfile.gender === 'female'));
      const isProfileIncomplete = !hasBirthday || !hasGender;

      if (isProfileIncomplete && this.config.birthdayRepo) {
        const memLast = this.userOnboardingCooldowns.get(senderJid) || 0;
        const dbLastStr = this.config.guardrailsService?.getConfig(`onboard_prompt:${senderJid}`, '0') || '0';
        const dbLast = parseInt(dbLastStr, 10) || 0;
        const lastOnboardingPrompt = Math.max(memLast, dbLast);
        const onboardingCooldown = this.config.userOnboardingCooldownMs ?? 24 * 60 * 60 * 1000;

        if (now - lastOnboardingPrompt >= onboardingCooldown) {
          this.userOnboardingCooldowns.set(senderJid, now);
          this.config.guardrailsService?.setConfig(`onboard_prompt:${senderJid}`, String(now));
          const isNeverRegistered = !userProfile;

          if (isNeverRegistered) {
            aiReply += '\n\n¡Che, no te tengo en mi lista! Si querés que te salude para tu cumple y sepa cómo tratarte, tirame un `/registrarse DD/MM el` (o `ella`) 😉🎂';
          } else {
            aiReply += '\n\n¡Che, sabés qué? Se me traspapelaron algunos de tus datos... ¿cuándo cumplís y preferís que te trate de él o ella? Tirame un `/registrarse DD/MM el` (o `ella`) así te anoto bien! 😉🎂';
          }
        }
      }

      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {}

      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN] Respuesta IA para ${remoteJid}: "${aiReply.slice(0, 80)}..."`);
      } else {
        const sent = await sock.sendMessage(
          remoteJid,
          { text: aiReply },
          { quoted: msg }
        );
        const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
        this.addProcessedId(botMsgId);
        this.config.messageRepo.save({
          id: botMsgId,
          groupJid: remoteJid,
          senderJid: botCleanJid,
          senderName: character.displayName,
          content: aiReply,
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      console.error(`❌ Error generando respuesta IA para ${remoteJid}:`, err?.message || err);
    }
  }

  private detectTargetMember(text: string): string | null {
    const targets = character.targetMembers || ['nati', 'belula', 'marian', 'cristian'];
    const lowerText = text.toLowerCase();
    for (const t of targets) {
      const regex = new RegExp(`\\b${t}\\b`, 'i');
      if (regex.test(lowerText)) {
        return t.charAt(0).toUpperCase() + t.slice(1);
      }
    }
    return null;
  }

  private shouldTriggerSpontaneous(groupJid: string): boolean {
    const now = Date.now();
    const cooldown = this.config.spontaneousCooldownMs ?? 30 * 60 * 1000;
    const lastTime = this.spontaneousCooldowns.get(groupJid) || 0;
    if (now - lastTime < cooldown) return false;

    const chance = this.config.spontaneousChance ?? 0.25;
    return Math.random() < chance;
  }

  private async handleSpontaneousIntervention(
    msg: WAMessage,
    remoteJid: string,
    text: string,
    targetMember: string,
    sock: WASocket
  ): Promise<void> {
    const now = Date.now();
    this.spontaneousCooldowns.set(remoteJid, now);

    try {
      const recent = this.config.messageRepo.getRecentMessages(remoteJid, 4);
      const contextText = recent.map((r) => `${r.senderName}: ${r.content}`).join('\n');

      const targetJid = this.config.messageRepo.findUserJidByName(remoteJid, targetMember);
      const targetLower = targetMember.toLowerCase();
      let isTargetFemale = targetLower === 'nati' || targetLower === 'belula';
      if (targetJid && this.config.birthdayRepo) {
        const profile = this.config.birthdayRepo.get(targetJid);
        if (profile?.gender === 'female') {
          isTargetFemale = true;
        }
      }

      let canFlirtTarget = isTargetFemale;
      if (isTargetFemale && targetJid && this.config.guardrailsService) {
        canFlirtTarget = this.config.guardrailsService.canFlirtSpontaneously(targetJid);
      }

      if (canFlirtTarget && targetJid && this.config.guardrailsService) {
        this.config.guardrailsService.recordSpontaneousFlirt(targetJid);
      }

      const joke = await this.config.aiService.generateSpontaneousIntervention(
        targetMember,
        contextText,
        canFlirtTarget
      );

      // Resolver JID del miembro para etiquetarlo en WhatsApp si está registrado
      let mentions: string[] = [];
      let finalJoke = joke;

      if (targetJid) {
        mentions = [targetJid];
        const userPhone = targetJid.replace(/@.*$/, '');
        const targetRegex = new RegExp(`@?${targetMember}`, 'gi');
        if (targetRegex.test(finalJoke)) {
          finalJoke = finalJoke.replace(targetRegex, `@${userPhone}`);
        } else {
          finalJoke = `@${userPhone} ${finalJoke}`;
        }
      }

      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN Espontáneo] Broma sobre ${targetMember} en ${remoteJid}: "${finalJoke}"`);
      } else {
        const sent = await sock.sendMessage(
          remoteJid,
          { text: finalJoke, mentions },
          { quoted: msg }
        );
        const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
        this.addProcessedId(botMsgId);
        if (sent?.key?.id) {
          this.botJokeMsgIds.add(sent.key.id);
          if (this.botJokeMsgIds.size > 200) {
            const first = this.botJokeMsgIds.values().next().value;
            if (first) this.botJokeMsgIds.delete(first);
          }
        }
        const botJid = this.config.botCleanJid || (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : 'bot@s.whatsapp.net');
        this.config.messageRepo.save({
          id: botMsgId,
          groupJid: remoteJid,
          senderJid: botJid,
          senderName: character.displayName,
          content: finalJoke,
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      console.error(`❌ Error en intervención espontánea en ${remoteJid}:`, err?.message || err);
    }
  }

  private findMatchingAlias(text: string): { userPhone: string; userJid: string; alias: string } | null {
    if (!this.config.guardrailsService) return null;
    const allAliases = this.config.guardrailsService.getAllAliases();
    if (allAliases.length === 0) return null;

    const lower = text.toLowerCase();
    for (const item of allAliases) {
      const regex = new RegExp(`\\b${item.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lower)) {
        return item;
      }
    }
    return null;
  }

  private async handleAliasChimeIn(
    msg: WAMessage,
    remoteJid: string,
    _text: string,
    aliasData: { userPhone: string; userJid: string; alias: string },
    sock: WASocket
  ): Promise<void> {
    this.config.guardrailsService?.recordSpontaneousFlirt(aliasData.userJid);

    const compliments = [
      `¡Epa, escuché "${aliasData.alias}"? Acá la invocaron a la reina del grupo @${aliasData.userPhone}, reportate mi amor que te andan buscando 😉👑`,
      `Ojo che, hablaron de "${aliasData.alias}" y vine al toque. Un poco de respeto para la que manda acá @${aliasData.userPhone} ✨🐶`,
      `¡Pero mirá quién apareció en la charla! Nombraron a "${aliasData.alias}" y acá estoy firme a la orden @${aliasData.userPhone} 😉💖`,
      `Pará la moto, si hablan de "${aliasData.alias}" avisen que me peino che. Toda la facha @${aliasData.userPhone} 🐶✨`,
      `Che @${aliasData.userPhone}, te andan nombrando como "${aliasData.alias}"... y la verdad que te queda pintado, diosa 😉✨`
    ];

    const chosen = compliments[Math.floor(Math.random() * compliments.length)];
    const mentions = [aliasData.userJid];

    if (this.config.dryRun) {
      console.log(`🧪 [DRY_RUN Apodo Entromisión] en ${remoteJid}: "${chosen}"`);
    } else {
      const sent = await sock.sendMessage(
        remoteJid,
        { text: chosen, mentions },
        { quoted: msg }
      );
      const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
      this.addProcessedId(botMsgId);
      const botJid = this.config.botCleanJid || (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : 'bot@s.whatsapp.net');
      this.config.messageRepo.save({
        id: botMsgId,
        groupJid: remoteJid,
        senderJid: botJid,
        senderName: character.displayName,
        content: chosen,
        timestamp: Date.now()
      });
    }
  }

  private async handleConversationalChimeIn(
    msg: WAMessage,
    remoteJid: string,
    sock: WASocket
  ): Promise<void> {
    const now = Date.now();
    this.spontaneousCooldowns.set(remoteJid, now);

    try {
      // Tomar los últimos 6 a 8 mensajes de la conversación
      const recent = this.config.messageRepo.getRecentMessages(remoteJid, 7);
      if (!recent || recent.length < 3) return;

      const conversationText = recent.map((r) => `${r.senderName}: ${r.content}`).join('\n');
      const chimeIn = await this.config.aiService.generateSpontaneousChimeIn(conversationText);
      if (!chimeIn) return;

      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN Acotación] en ${remoteJid}: "${chimeIn}"`);
      } else {
        const sent = await sock.sendMessage(
          remoteJid,
          { text: chimeIn },
          { quoted: msg }
        );
        const botMsgId = sent?.key?.id || `bot-${Date.now()}`;
        this.addProcessedId(botMsgId);
        if (sent?.key?.id) {
          this.botJokeMsgIds.add(sent.key.id);
          if (this.botJokeMsgIds.size > 200) {
            const first = this.botJokeMsgIds.values().next().value;
            if (first) this.botJokeMsgIds.delete(first);
          }
        }
        const botJid = this.config.botCleanJid || (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : 'bot@s.whatsapp.net');
        this.config.messageRepo.save({
          id: botMsgId,
          groupJid: remoteJid,
          senderJid: botJid,
          senderName: character.displayName,
          content: chimeIn,
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      console.error(`❌ Error en acotación espontánea en ${remoteJid}:`, err?.message || err);
    }
  }

  private addProcessedId(id: string) {
    this.processedMsgIds.add(id);
    if (this.processedMsgIds.size > 1000) {
      const first = this.processedMsgIds.values().next().value;
      if (first) this.processedMsgIds.delete(first);
    }
  }
}
