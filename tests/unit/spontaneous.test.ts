import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, MentionRepository, StatisticsRepository, BirthdayRepository } from '../../src/database/index.js';
import { MentionService } from '../../src/services/mention.service.js';
import { CommandService } from '../../src/services/command.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { EventHandler } from '../../src/bot/event-handler.js';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

test('Spontaneous Intervention & Context Memory Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const messageRepo = new MessageRepository(db);
  const mentionRepo = new MentionRepository(db);
  const statsRepo = new StatisticsRepository(db);
  const birthdayRepo = new BirthdayRepository(db);
  const mentionService = new MentionService(mentionRepo);

  const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
  const mockSocket = {
    user: { id: '123456789:0@s.whatsapp.net' },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid: string, content: any, options?: any) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: 'bot-msg-' + (sentMessages.length), remoteJid: jid } };
    }
  } as unknown as WASocket;

  let lastHistoryReceived: any[] = [];
  let lastOptionsReceived: any = null;
  let spontaneousCalls = 0;

  const mockAiService = {
    generateGroupReply: async (
      _groupJid: string,
      _prompt: string,
      _senderName: string,
      recentHistory: any[],
      options: any
    ) => {
      lastHistoryReceived = recentHistory;
      lastOptionsReceived = options;
      return '¡Qué onda che! Acá la mascota respondiendo.';
    },
    generateSpontaneousIntervention: async (targetName: string, _context: string) => {
      spontaneousCalls++;
      return `¡Epa! Hablando de ${targetName}... seguro está durmiendo como un tronco este @${targetName} 😂🐶`;
    }
  } as unknown as AIService;

  const mockCommandService = {
    isCommand: () => false,
    executeCommand: async () => ({ handled: false })
  } as unknown as CommandService;

  const groupJid = '120363@g.us';

  const handler = new EventHandler({
    getSocket: () => mockSocket,
    messageRepo,
    mentionService,
    statsRepo,
    commandService: mockCommandService,
    aiService: mockAiService,
    birthdayRepo,
    botCleanJid: '123456789@s.whatsapp.net',
    userCooldownMs: 0,
    groupCooldownMs: 0,
    spontaneousChance: 1.0, // 100% de probabilidad en tests
    spontaneousCooldownMs: 60000 // 1 minuto
  });

  await t.test('1. Normal chat with Cristian triggers spontaneous joke and tags him', async () => {
    // Registrar primero un mensaje previo de Cristian para que tenga JID conocido
    const msgCristian: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-cristian', fromMe: false },
      message: { conversation: 'Hola muchachos, después paso.' },
      messageTimestamp: 1000,
      pushName: 'Cristian'
    };
    await handler.handleMessage(msgCristian);

    // Otro usuario habla de Cristian
    const msgChat: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-chat', fromMe: false },
      message: { conversation: 'Che, ¿alguien sabe algo de Cristian?' },
      messageTimestamp: 2000,
      pushName: 'Lucas'
    };

    sentMessages.length = 0;
    await handler.handleMessage(msgChat);

    assert.strictEqual(spontaneousCalls, 1);
    assert.strictEqual(sentMessages.length, 1);
    assert.match(sentMessages[0].content.text, /seguro está durmiendo como un tronco este @/);
    assert.ok(sentMessages[0].content.mentions && sentMessages[0].content.mentions.length > 0);
    assert.strictEqual(sentMessages[0].options?.quoted?.key?.id, 'm-chat');
  });

  await t.test('2. Spontaneous cooldown prevents repeated interruptions immediately', async () => {
    const msgChat2: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-chat-2', fromMe: false },
      message: { conversation: 'Nati también estaba conectada recién.' },
      messageTimestamp: 2005,
      pushName: 'Belula'
    };

    sentMessages.length = 0;
    const previousCalls = spontaneousCalls;
    await handler.handleMessage(msgChat2);

    // Debe ser ignorado por el cooldown de 60s
    assert.strictEqual(spontaneousCalls, previousCalls);
    assert.strictEqual(sentMessages.length, 0);
  });

  await t.test('3. Quoting a bot joke triggers "hacerse el otro" (isReplyingToBotJoke)', async () => {
    // El bot mandó mensaje con ID 'bot-msg-1' en el test 1
    const replyToJokeMsg: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-reply', fromMe: false },
      message: {
        extendedTextMessage: {
          text: 'Che bot qué decís de Cristian jajaja',
          contextInfo: {
            stanzaId: 'bot-msg-1',
            participant: '123456789@s.whatsapp.net',
            quotedMessage: { conversation: '¡Epa! Hablando de Cristian...' }
          }
        }
      },
      messageTimestamp: 3000,
      pushName: 'Lucas'
    };

    await handler.handleMessage(replyToJokeMsg);

    assert.ok(lastOptionsReceived);
    assert.strictEqual(lastOptionsReceived.isReplyingToBotJoke, true);
    // Verificar que también recibió historial reciente
    assert.ok(lastHistoryReceived.length > 0);
  });

  await t.test('4. Gender preference is respected in conversational replies', async () => {
    // Registrar a Belula con género femenino
    const belulaJid = 'belula@s.whatsapp.net';
    birthdayRepo.save(belulaJid, 10, 8, 'female');

    const msgFromBelula: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-belula', fromMe: false, participant: belulaJid },
      message: {
        extendedTextMessage: {
          text: 'Hola @123456789 cómo andás?',
          contextInfo: {
            mentionedJid: ['123456789@s.whatsapp.net']
          }
        }
      },
      messageTimestamp: 4000,
      pushName: 'Belula'
    };

    lastOptionsReceived = null;
    await handler.handleMessage(msgFromBelula);

    assert.ok(lastOptionsReceived);
    assert.strictEqual(lastOptionsReceived.userGender, 'female');
  });

  db.close();
});
