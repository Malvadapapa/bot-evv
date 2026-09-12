import test from 'node:test';
import assert from 'node:assert';
import {
  Database,
  MessageRepository,
  MentionRepository,
  SummaryRepository,
  BirthdayRepository,
  StatisticsRepository
} from '../../src/database/index.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { StatisticsService } from '../../src/services/statistics.service.js';
import { CommandService } from '../../src/services/command.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { EventHandler } from '../../src/bot/event-handler.js';

test('Activation & Rule 1 Unit Tests (TDD)', async (t) => {
  const db = Database.createInMemory();
  const messageRepo = new MessageRepository(db);
  const mentionRepo = new MentionRepository(db);
  const summaryRepo = new SummaryRepository(db);
  const birthdayRepo = new BirthdayRepository(db);
  const statsRepo = new StatisticsRepository(db);

  const mockAiService = {
    generateGroupReply: async (_group: string, prompt: string, user: string) => {
      return `Hola ${user}, respondo a tu consulta: ${prompt}`;
    },
    generateIncrementalSummary: async () => 'Resumen del día'
  } as unknown as AIService;

  const summaryService = new SummaryService(summaryRepo, messageRepo, mockAiService);
  const mentionService = new MentionService(mentionRepo);
  const markerService = new ContextMarkerService(mentionRepo, messageRepo);
  const birthdayService = new BirthdayService(birthdayRepo);
  const statisticsService = new StatisticsService(statsRepo);

  const commandService = new CommandService(
    summaryService,
    mentionService,
    markerService,
    birthdayService,
    statisticsService
  );

  const botJid = '5493515554241@s.whatsapp.net';
  const groupJid = '120363412758439456@g.us';

  // Mock socket capturing sent messages
  const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
  const mockSocket = {
    user: { id: '5493515554241:12@s.whatsapp.net' },
    sendMessage: async (jid: string, content: any, options?: any) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: 'bot-msg-1' } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => {}
  } as any;

  const eventHandler = new EventHandler({
    getSocket: () => mockSocket,
    messageRepo,
    mentionService,
    statsRepo,
    commandService,
    aiService: mockAiService,
    botCleanJid: botJid,
    targetGroupJid: groupJid,
    userCooldownMs: 0,
    groupCooldownMs: 0
  });

  await t.test('1. Normal group message is passively recorded but bot does NOT reply', async () => {
    sentMessages.length = 0;

    const normalMsg = {
      key: { id: 'msg-norm-1', remoteJid: groupJid, fromMe: false },
      pushName: 'Carlos',
      message: {
        conversation: 'Hola gente, ¿alguien sabe a qué hora es la reunión?'
      },
      messageTimestamp: 1000
    } as any;

    await eventHandler.handleMessage(normalMsg);

    // Bot NO debe haber respondido
    assert.strictEqual(sentMessages.length, 0);

    // Mensaje DEBE estar guardado en DB
    const saved = messageRepo.getMessagesSince(groupJid, 0, 10);
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].id, 'msg-norm-1');

    // Estadísticas DEBEN registrar al usuario
    const top = statsRepo.getTopActiveUsers(groupJid, 10);
    assert.strictEqual(top.length, 1);
    assert.strictEqual(top[0].userName, 'Carlos');
  });

  await t.test('2. Word "mequetrefe" MUST NOT trigger a response (Rule 1)', async () => {
    sentMessages.length = 0;

    const mequetrefeMsg = {
      key: { id: 'msg-meque-1', remoteJid: groupJid, fromMe: false },
      pushName: 'Martin',
      message: {
        conversation: 'Che mequetrefe cómo va todo'
      },
      messageTimestamp: 2000
    } as any;

    await eventHandler.handleMessage(mequetrefeMsg);

    // CERO respuestas enviadas
    assert.strictEqual(sentMessages.length, 0);
  });

  await t.test('3. Explicit @Bot mention triggers AI response', async () => {
    sentMessages.length = 0;

    const botMentionMsg = {
      key: { id: 'msg-mention-bot', remoteJid: groupJid, fromMe: false },
      pushName: 'Sofia',
      message: {
        extendedTextMessage: {
          text: `@${botJid.split('@')[0]} ¿cuánto es 2 + 2?`,
          contextInfo: {
            mentionedJid: [botJid]
          }
        }
      },
      messageTimestamp: 3000
    } as any;

    await eventHandler.handleMessage(botMentionMsg);

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].jid, groupJid);
    assert.match(sentMessages[0].content.text, /respondo a tu consulta/);
    assert.strictEqual(sentMessages[0].options?.quoted, botMentionMsg);
  });

  await t.test('4. Quoting bot previous message triggers AI response', async () => {
    sentMessages.length = 0;

    const quoteMsg = {
      key: { id: 'msg-quote-bot', remoteJid: groupJid, fromMe: false },
      pushName: 'Sofia',
      message: {
        extendedTextMessage: {
          text: '¿Y por qué decís eso?',
          contextInfo: {
            participant: botJid,
            quotedMessage: { conversation: '4' }
          }
        }
      },
      messageTimestamp: 4000
    } as any;

    await eventHandler.handleMessage(quoteMsg);

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].jid, groupJid);
    assert.match(sentMessages[0].content.text, /respondo a tu consulta/);
  });

  await t.test('5. Slash command /top executes without needing @Bot mention', async () => {
    sentMessages.length = 0;

    const cmdMsg = {
      key: { id: 'msg-cmd-top', remoteJid: groupJid, fromMe: false },
      pushName: 'Sofia',
      message: {
        conversation: '/top'
      },
      messageTimestamp: 5000
    } as any;

    await eventHandler.handleMessage(cmdMsg);

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].jid, groupJid);
    assert.match(sentMessages[0].content.text, /TOP \d+ USUARIOS MÁS ACTIVOS/);
  });

  await t.test('6. Own messages (fromMe: true) are ignored completely', async () => {
    sentMessages.length = 0;

    const ownMsg = {
      key: { id: 'msg-own-1', remoteJid: groupJid, fromMe: true },
      message: { conversation: 'Soy el bot enviando algo' },
      messageTimestamp: 6000
    } as any;

    await eventHandler.handleMessage(ownMsg);
    assert.strictEqual(sentMessages.length, 0);
  });

  db.close();
});
