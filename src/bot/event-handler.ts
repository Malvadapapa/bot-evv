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

export interface EventHandlerConfig {
  getSocket: () => WASocket | null;
  messageRepo: MessageRepository;
  mentionService: MentionService;
  statsRepo: StatisticsRepository;
  commandService: CommandService;
  aiService: AIService;
  birthdayRepo?: BirthdayRepository;
  botCleanJid?: string;
  botLid?: string;
  targetGroupJid?: string;
  userCooldownMs?: number;
  groupCooldownMs?: number;
  dryRun?: boolean;
  spontaneousChance?: number;
  spontaneousCooldownMs?: number;
}

export class EventHandler {
  private processedMsgIds = new Set<string>();
  private userCooldowns = new Map<string, number>();
  private groupCooldowns = new Map<string, number>();
  private spontaneousCooldowns = new Map<string, number>();
  private botJokeMsgIds = new Set<string>();

  constructor(private config: EventHandlerConfig) {}

  public async handleMessage(msg: WAMessage): Promise<void> {
    const msgId = msg.key.id;
    const remoteJid = msg.key.remoteJid || '';
    const fromMe = msg.key.fromMe;

    // 1. Regla: Ignorar mensajes propios para evitar bucles infinitos
    if (fromMe) return;

    // 2. Regla: Deduplicación de eventos
    if (!msgId || this.processedMsgIds.has(msgId)) return;
    this.addProcessedId(msgId);

    // 3. Regla: Restricción opcional por TARGET_GROUP_JID
    if (this.config.targetGroupJid && remoteJid.endsWith('@g.us') && remoteJid !== this.config.targetGroupJid) {
      return;
    }

    const text = getMessageText(msg).trim();
    const senderJid = getSenderJid(msg);
    const pushName = msg.pushName || 'Usuario';
    const rawTimestamp = msg.messageTimestamp;
    const timestamp = typeof rawTimestamp === 'number'
      ? (rawTimestamp < 1e11 ? rawTimestamp * 1000 : rawTimestamp)
      : Date.now();
    const mentionedJids = getMentionedJids(msg);

    // 4. Ingestión Pasiva: Registrar SIEMPRE el mensaje, menciones y estadísticas
    if (text) {
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

    // 5. Manejo de Comandos Explícitos (/resumen, /menciones, /marcar, /micumple, /top, /ayuda)
    if (this.config.commandService.isCommand(text)) {
      try {
        console.log(`⚡ [Comando] De ${pushName} en ${remoteJid}: "${text}"`);
        const cmdResult = await this.config.commandService.executeCommand(
          remoteJid,
          senderJid,
          pushName,
          text
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
      } catch (err: any) {
        console.error(`❌ Error ejecutando comando en ${remoteJid}:`, err?.message || err);
      }
      return;
    }

    // 6. REGLA 1: En grupos, activación conversacional ante @Bot explícito (por JID, LID o texto), cita directa o intervención espontánea
    const isGroup = remoteJid.endsWith('@g.us');
    let isQuotingBot = false;
    const quoted = getQuotedContext(msg);

    // Lista de nombres dinámicos de respaldo en texto plano (@Perfil, @Mequetrefe, etc.)
    const profileName = sock.user?.name || '';
    const dynamicNames = Array.from(
      new Set([character.displayName, character.keyName, profileName, 'bot', 'vector'])
    ).filter((n) => Boolean(n && n.trim().length > 1));
    const nameRegex = new RegExp(`@(${dynamicNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

    if (isGroup) {
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
        // Evaluar posible intervención espontánea sobre miembros clave (Nati, Belula, Marian, Cristian)
        const targetMember = this.detectTargetMember(text);
        if (targetMember && this.shouldTriggerSpontaneous(remoteJid)) {
          await this.handleSpontaneousIntervention(msg, remoteJid, text, targetMember, sock);
        }
        return;
      }
    }

    // 7. Verificación de Cooldowns para interacción conversacional directa
    const now = Date.now();
    const userCooldown = this.config.userCooldownMs ?? 8000;
    const groupCooldown = this.config.groupCooldownMs ?? 2500;

    const lastUserTime = this.userCooldowns.get(senderJid) || 0;
    if (now - lastUserTime < userCooldown) {
      console.log(`⏱️ [Cooldown] Ignorado mensaje de ${pushName} en ${remoteJid}`);
      return;
    }

    const lastGroupTime = this.groupCooldowns.get(remoteJid) || 0;
    if (now - lastGroupTime < groupCooldown) {
      console.log(`⏱️ [Cooldown] Ignorado mensaje en grupo ${remoteJid}`);
      return;
    }

    this.userCooldowns.set(senderJid, now);
    this.groupCooldowns.set(remoteJid, now);

    // 8. Generar respuesta conversacional vía IA con contexto real y género
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

      const aiReply = await this.config.aiService.generateGroupReply(
        remoteJid,
        cleanPrompt,
        pushName,
        recentHistory,
        {
          userGender,
          isReplyingToBotJoke
        }
      );

      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {}

      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN] Respuesta IA para ${remoteJid}: "${aiReply.slice(0, 80)}..."`);
      } else {
        await sock.sendMessage(
          remoteJid,
          { text: aiReply },
          { quoted: msg }
        );
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

      const joke = await this.config.aiService.generateSpontaneousIntervention(targetMember, contextText);

      // Resolver JID del miembro para etiquetarlo en WhatsApp si está registrado
      const targetJid = this.config.messageRepo.findUserJidByName(remoteJid, targetMember);
      const mentions = targetJid ? [targetJid] : [];

      if (this.config.dryRun) {
        console.log(`🧪 [DRY_RUN Espontáneo] Broma sobre ${targetMember} en ${remoteJid}: "${joke}"`);
      } else {
        const sent = await sock.sendMessage(
          remoteJid,
          { text: joke, mentions },
          { quoted: msg }
        );
        if (sent?.key?.id) {
          this.botJokeMsgIds.add(sent.key.id);
          if (this.botJokeMsgIds.size > 200) {
            const first = this.botJokeMsgIds.values().next().value;
            if (first) this.botJokeMsgIds.delete(first);
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ Error en intervención espontánea en ${remoteJid}:`, err?.message || err);
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
