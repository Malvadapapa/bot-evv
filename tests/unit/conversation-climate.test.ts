import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, StatisticsRepository, BirthdayRepository } from '../../src/database/index.js';
import { EventHandler } from '../../src/bot/event-handler.js';
import { MetaAIProvider } from '../../src/ai/providers/meta-ai.provider.js';
import { AIService } from '../../src/services/ai.service.js';
import { buildSystemPrompt, buildMetaAIPrompt, formatWhatsAppText } from '../../src/config/character.js';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

test('Conversation Climate, Anti-Refusal Fallback and Bot Self-Memory Tests', async (t) => {
  await t.test('1. MetaAIProvider detects canned refusal phrases in English and Spanish', () => {
    const provider = new MetaAIProvider('http://localhost:8788');

    // Casos de rechazo conocidos
    assert.strictEqual(
      provider.isCannedRefusal("Sorry, I can't help you with this request right now. Is there anything else I can help you with?"),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("I cannot fulfill this request as it goes against safety guidelines."),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("No puedo ayudarte con esta solicitud en este momento."),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("As an AI developed by Meta, I cannot generate content that..."),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("Something went wrong. Please try again"),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("An error occurred. Please try again later."),
      true
    );
    assert.strictEqual(
      provider.isCannedRefusal("Algo salió mal. Por favor intentá de nuevo."),
      true
    );

    // Casos legítimos de conversación
    assert.strictEqual(
      provider.isCannedRefusal("¡Qué hacés fiera! Todo tranqui por acá, tomando unos mates 🧉"),
      false
    );
    assert.strictEqual(
      provider.isCannedRefusal("Jajaja no te calentés hermano, si tiraron 'cara de perro' cómo no voy a saltar 😂🐶"),
      false
    );
  });

  await t.test('2. AIService automatically falls back to secondary provider when Meta AI returns a refusal', async () => {
    let metaCalled = false;
    let externalCalled = false;

    const mockMetaProvider = {
      name: 'meta-ai',
      isConfigured: true,
      generateReply: async () => {
        metaCalled = true;
        throw new Error('Meta AI rechazó la solicitud con respuesta enlatada: "Sorry, I can\'t help you"');
      }
    };

    const mockExternalProvider = {
      name: 'groq',
      isConfigured: true,
      generateReply: async () => {
        externalCalled = true;
        return '¡Y qué querés que haga si estoy mirando el chat y me tentó el bardo! 😂';
      }
    };

    const aiService = new AIService({
      metaProvider: mockMetaProvider as any,
      externalProvider: mockExternalProvider as any
    });

    const result = await aiService.generateConversationReply(
      'nadie esta inslutando metiche',
      [],
      { userName: 'Cristian' }
    );

    assert.strictEqual(metaCalled, true);
    assert.strictEqual(externalCalled, true);
    assert.strictEqual(result.providerUsed, 'groq');
    assert.match(result.text, /me tentó el bardo/);
  });

  await t.test('3. AIService routes concurrent requests to external provider when Meta AI is busy', async () => {
    let metaInProgress = false;
    let externalCalled = false;

    const mockMetaProvider = {
      name: 'meta-ai',
      isConfigured: true,
      generateReply: async () => {
        metaInProgress = true;
        // Simular demora de 50ms en Meta AI
        await new Promise((r) => setTimeout(r, 50));
        metaInProgress = false;
        return 'Respuesta lenta de Meta AI.';
      }
    };

    const mockExternalProvider = {
      name: 'groq',
      isConfigured: true,
      generateReply: async () => {
        externalCalled = true;
        return 'Respuesta concurrente de Groq.';
      }
    };

    const aiService = new AIService({
      metaProvider: mockMetaProvider as any,
      externalProvider: mockExternalProvider as any
    });

    // Lanzar primera petición (bloquea Meta AI como ocupado)
    const p1 = aiService.generateConversationReply('Pregunta de Nattalia', []);

    // Pequeño delay de 5ms para asegurar que p1 ya adquirió el lock de Meta AI
    await new Promise((r) => setTimeout(r, 5));

    // Segunda petición enviada mientras la primera está en curso
    const p2 = aiService.generateConversationReply('Pregunta simultánea de Cristian', []);

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.strictEqual(res1.providerUsed, 'meta-ai');
    assert.strictEqual(res2.providerUsed, 'groq-concurrent');
    assert.strictEqual(externalCalled, true);
    assert.match(res2.text, /Respuesta concurrente de Groq/);
  });

  await t.test('4. formatWhatsAppText cleans formal punctuation and trailing periods', () => {
    assert.strictEqual(
      formatWhatsAppText('¿A quién le tiran esa lista de insultos, che?'),
      'A quién le tiran esa lista de insultos, che?'
    );
    assert.strictEqual(
      formatWhatsAppText('¡Qué hacés maestro! Todo bien por acá.'),
      'Qué hacés maestro! Todo bien por acá'
    );
    assert.strictEqual(
      formatWhatsAppText('¿Cómo andás? ¡Todo de diez!'),
      'Cómo andás? Todo de diez!'
    );
    // Conserva elipsis legítimas
    assert.strictEqual(
      formatWhatsAppText('Esperando el mensaje...'),
      'Esperando el mensaje...'
    );
  });

  await t.test('5. Character prompts are ultra-lean and prohibit robotic bot tone', () => {
    const sysPrompt = buildSystemPrompt();
    assert.match(sysPrompt, /CERO tono de asistente virtual o bot/);
    assert.match(sysPrompt, /sin signos de apertura/);
    assert.match(sysPrompt, /No abuses de apodos/);

    const metaPrompt = buildMetaAIPrompt('nadie esta insultando metiche');
    assert.match(metaPrompt, /CERO tono de asistente/);
    assert.match(metaPrompt, /chiste de amigos/);
    assert.match(metaPrompt, /Prohibido usar "culiau"/);

    // Verificar que el prompt no sea sobre-extenso (< 130 palabras en el bloque principal)
    const wordCount = metaPrompt.split(/\s+/).length;
    assert.ok(wordCount < 130, `El prompt para Meta AI es demasiado largo (${wordCount} palabras)`);
  });

  await t.test('6. EventHandler handles concurrent messages from different users without dropping by group cooldown', async () => {
    const db = Database.createInMemory();
    const msgRepo = new MessageRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const birthdayRepo = new BirthdayRepository(db);

    const groupJid = '120363412758439456@g.us';
    const user1Jid = 'nattalia@s.whatsapp.net';
    const user2Jid = 'cristian@s.whatsapp.net';
    const botCleanJid = 'bot@s.whatsapp.net';

    const sentMessages: Array<{ jid: string; content: any }> = [];
    const mockSocket = {
      user: { id: 'bot:1@s.whatsapp.net' },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push({ jid, content });
        return { key: { id: `bot-msg-${sentMessages.length}`, remoteJid: jid } };
      }
    } as unknown as WASocket;

    const mockAiService = {
      generateGroupReply: async (_g: string, prompt: string) => `Respuesta a: ${prompt}`
    } as unknown as AIService;

    const mockCommandService = {
      isCommand: () => false,
      executeCommand: async () => ({ handled: false })
    } as any;

    const handler = new EventHandler({
      getSocket: () => mockSocket,
      messageRepo: msgRepo,
      mentionService: { recordMentions: () => {} } as any,
      statsRepo,
      commandService: mockCommandService,
      aiService: mockAiService,
      birthdayRepo,
      botCleanJid,
      userCooldownMs: 1000,
      groupCooldownMs: 5000 // Cooldown alto en grupo
    });

    // Mensaje 1 de Nattalia mencionando al bot
    const msg1: WAMessage = {
      key: { remoteJid: groupJid, id: 'user-msg-1', fromMe: false, participant: user1Jid },
      message: {
        extendedTextMessage: {
          text: '@bot como estas?',
          contextInfo: { mentionedJid: [botCleanJid] }
        }
      },
      messageTimestamp: 1000,
      pushName: 'Nattalia'
    };

    // Mensaje 2 de Cristian mencionando al bot solo 100ms después
    const msg2: WAMessage = {
      key: { remoteJid: groupJid, id: 'user-msg-2', fromMe: false, participant: user2Jid },
      message: {
        extendedTextMessage: {
          text: '@bot cara de perro',
          contextInfo: { mentionedJid: [botCleanJid] }
        }
      },
      messageTimestamp: 1001,
      pushName: 'Cristian'
    };

    await handler.handleMessage(msg1);
    await handler.handleMessage(msg2);

    // Ambos mensajes deben haber sido respondidos, ninguno descartado por cooldown
    assert.strictEqual(sentMessages.length, 2);
    assert.match(sentMessages[0].content.text, /como estas\?/);
    assert.match(sentMessages[1].content.text, /cara de perro/);

    db.close();
  });
});
