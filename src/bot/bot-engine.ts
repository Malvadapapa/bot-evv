import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { env } from '../config/env.js';
import { character } from '../config/character.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import {
  getMessageText,
  getMentionedJids,
  getSenderJid,
  getQuotedContext
} from '../utils/message.js';

export class BotEngine {
  private processedMsgIds = new Set<string>();
  private userCooldowns = new Map<string, number>();
  private groupCooldowns = new Map<string, number>();

  constructor(
    private getSocket: () => WASocket | null,
    private orchestrator: AIOrchestrator
  ) {}

  /**
   * Procesa los mensajes entrantes del evento messages.upsert
   */
  public async handleMessage(msg: WAMessage): Promise<void> {
    const msgId = msg.key.id;
    const remoteJid = msg.key.remoteJid || '';
    const fromMe = msg.key.fromMe;

    // 1. Regla: Ignorar mensajes propios para evitar bucles infinitos
    if (fromMe) return;

    // 2. Regla: Deduplicación de eventos
    if (!msgId || this.processedMsgIds.has(msgId)) return;
    this.addProcessedId(msgId);

    // 3. Regla: Restringir escucha estrictamente a TARGET_GROUP_JID (si está configurado)
    if (env.TARGET_GROUP_JID && remoteJid !== env.TARGET_GROUP_JID) {
      return;
    }

    // Si no es un grupo, ignorar (a menos que se permita específicamente)
    if (!remoteJid.endsWith('@g.us')) {
      return;
    }

    const text = getMessageText(msg).trim();
    if (!text) return;

    const sock = this.getSocket();
    if (!sock) return;

    const botFullId = sock.user?.id || '';
    const botCleanJid = botFullId ? botFullId.split(':')[0] + '@s.whatsapp.net' : '';

    // 4. Regla: Verificar disparadores (Triggers)
    const trigger = this.evaluateTrigger(msg, text, botCleanJid, botFullId);
    if (!trigger) return;

    const senderJid = getSenderJid(msg);
    const pushName = msg.pushName || 'Usuario';
    const now = Date.now();

    // 5. Regla: Rate limiting / Cooldowns
    const lastUserTime = this.userCooldowns.get(senderJid) || 0;
    if (now - lastUserTime < env.COOLDOWN_USER_MS) {
      console.log(`⏱️ [Cooldown] Ignorado mensaje de ${pushName} (cooldown de usuario activo)`);
      return;
    }

    const lastGroupTime = this.groupCooldowns.get(remoteJid) || 0;
    if (now - lastGroupTime < env.COOLDOWN_GROUP_MS) {
      console.log(`⏱️ [Cooldown] Ignorado mensaje en grupo (cooldown de grupo activo)`);
      return;
    }

    // Actualizar timestamps de cooldown
    this.userCooldowns.set(senderJid, now);
    this.groupCooldowns.set(remoteJid, now);

    // 6. Logging local seguro del trigger (sin exponer conversaciones ajenas)
    const maskedSender = senderJid.replace(/(\d{4})\d+(\d{2})@/, '$1****$2@');
    console.log('\n------------------------------------------------------');
    console.log(`🎯 [TRIGGER DISPARADO] Tipo: [${trigger}]`);
    console.log(`👤 Usuario: ${pushName} (${maskedSender})`);
    console.log(`💬 Snippet: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"`);
    console.log('------------------------------------------------------');

    try {
      // 7. Simulación de presencia humana
      // a) Marcar como leído
      try {
        await sock.readMessages([msg.key]);
      } catch (err) {
        // En algunos grupos o versiones esto puede ser no crítico
      }

      // b) Enviar estado "escribiendo..." (composing)
      await sock.sendPresenceUpdate('composing', remoteJid);

      // c) Retardo humano aleatorio de 1.5 a 3.5 segundos
      const delayMs = this.getRandomDelay(env.PRESENCE_DELAY_MIN_MS, env.PRESENCE_DELAY_MAX_MS);
      await this.sleep(delayMs);

      // 8. Limpiar texto de la consulta
      const promptClean = this.cleanPrompt(text);

      // 9. Orquestar respuesta con IA (Meta AI -> Fallback)
      const aiResult = await this.orchestrator.getReply(remoteJid, promptClean, pushName);

      // d) Pausar estado de presencia
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch (err) {}

      // 10. Envío de respuesta citando mensaje original o modo DRY_RUN
      if (env.DRY_RUN) {
        console.log(`🧪 [MODO DRY_RUN ACTIVO] Respuesta no enviada a WhatsApp.`);
        console.log(`🤖 Respuesta generada (${aiResult.providerUsed}, ${aiResult.latencyMs}ms):`);
        console.log(`"${aiResult.reply}"\n`);
      } else {
        await sock.sendMessage(
          remoteJid,
          { text: aiResult.reply },
          { quoted: msg }
        );
        console.log(`✅ [RESPUESTA ENVIADA] Proveedor: ${aiResult.providerUsed} | Latencia: ${aiResult.latencyMs}ms`);
        console.log(`📄 Texto enviado: "${aiResult.reply.slice(0, 80)}..."\n`);
      }
    } catch (error: any) {
      console.error(`❌ Error procesando respuesta para el grupo:`, error?.message || error);
    }
  }

  /**
   * Evalúa si el mensaje debe activar la respuesta del bot
   */
  private evaluateTrigger(
    msg: WAMessage,
    text: string,
    botCleanJid: string,
    botFullId: string
  ): 'mencion' | 'cita' | 'nombre_clave' | null {
    const textLower = text.toLowerCase();

    // Trigger 1: Mencionado explícito (@bot o mención Baileys)
    const mentionedJids = getMentionedJids(msg);
    if (
      textLower.includes('@bot') ||
      (botCleanJid && mentionedJids.includes(botCleanJid))
    ) {
      return 'mencion';
    }

    // Trigger 2: Cita a un mensaje anterior del bot
    const quoted = getQuotedContext(msg);
    if (quoted) {
      const quotedSender = quoted.participant || '';
      if (
        (botCleanJid && quotedSender.includes(botCleanJid.split('@')[0])) ||
        (botFullId && quotedSender.includes(botFullId.split(':')[0]))
      ) {
        return 'cita';
      }
    }

    // Trigger 3: Menciona el nombre clave "mequetrefe"
    const keyNameRegex = new RegExp(`\\b${character.keyName}\\b`, 'i');
    if (keyNameRegex.test(textLower)) {
      return 'nombre_clave';
    }

    return null;
  }

  /**
   * Remueve etiquetas directas de activación para enviar un texto más limpio a la IA
   */
  private cleanPrompt(text: string): string {
    return text
      .replace(/@bot/gi, '')
      .trim();
  }

  private addProcessedId(id: string) {
    this.processedMsgIds.add(id);
    if (this.processedMsgIds.size > 1000) {
      const first = this.processedMsgIds.values().next().value;
      if (first) this.processedMsgIds.delete(first);
    }
  }

  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
