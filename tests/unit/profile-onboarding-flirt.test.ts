import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, MentionRepository, StatisticsRepository, BirthdayRepository } from '../../src/database/index.js';
import { MentionService } from '../../src/services/mention.service.js';
import { CommandService } from '../../src/services/command.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { EventHandler } from '../../src/bot/event-handler.js';
import { buildSystemPrompt, buildMetaAIPrompt } from '../../src/config/character.js';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

test('Profile Onboarding & Subtle Flirt Unit Tests', async (t) => {
  await t.test('1. Prompt formatting: Male users are treated as male with friendly tone', () => {
    const sysPrompt = buildSystemPrompt({ userGender: 'male', userName: 'Cristian' });
    assert.match(sysPrompt, /Cristian/);
    assert.match(sysPrompt, /buena onda de amigos/);

    const metaPrompt = buildMetaAIPrompt('hola bot', undefined, { userGender: 'male' });
    assert.match(metaPrompt, /Tratalo de él con buena onda de amigos/);
  });

  await t.test('2. Prompt formatting: Female users with isFlirting get subtle and gentle cordobés compliments', () => {
    const sysPromptFlirt = buildSystemPrompt({ userGender: 'female', isFlirting: true });
    assert.match(sysPromptFlirt, /piropo sutil, dulce y pícaro/);

    const sysPromptNormal = buildSystemPrompt({ userGender: 'female', isFlirting: false });
    assert.doesNotMatch(sysPromptNormal, /piropo/);
    assert.match(sysPromptNormal, /Tratala como mujer \(ella, reina, genia\)/);

    const metaPromptFlirt = buildMetaAIPrompt('hola bot', undefined, { userGender: 'female', isFlirting: true });
    assert.match(metaPromptFlirt, /piropo dulce y sutil/);
  });

  await t.test('3. Proactive onboarding: First-time user without profile gets cordial invitation', async () => {
    const db = Database.createInMemory();
    const messageRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const birthdayRepo = new BirthdayRepository(db);
    const mentionService = new MentionService(mentionRepo);

    const sentMessages: Array<{ jid: string; content: any }> = [];
    const mockSocket = {
      user: { id: 'bot:0@s.whatsapp.net' },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'bot-msg-1', remoteJid: jid } };
      }
    } as unknown as WASocket;

    const mockAiService = {
      generateGroupReply: async () => '¡Hola! Todo bien por acá.'
    } as unknown as AIService;

    const mockCommandService = {
      isCommand: () => false,
      executeCommand: async () => ({ handled: false })
    } as unknown as CommandService;

    const groupJid = 'group@g.us';
    const newUserJid = 'newuser@s.whatsapp.net';

    const handler = new EventHandler({
      getSocket: () => mockSocket,
      messageRepo,
      mentionService,
      statsRepo,
      commandService: mockCommandService,
      aiService: mockAiService,
      birthdayRepo,
      botCleanJid: 'bot@s.whatsapp.net',
      userCooldownMs: 0,
      groupCooldownMs: 0,
      userOnboardingCooldownMs: 60000
    });

    const msg: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-1', fromMe: false, participant: newUserJid },
      message: {
        extendedTextMessage: {
          text: 'Hola @bot',
          contextInfo: { mentionedJid: ['bot@s.whatsapp.net'] }
        }
      },
      messageTimestamp: 1000,
      pushName: 'NuevoAmigo'
    };

    await handler.handleMessage(msg);

    assert.strictEqual(sentMessages.length, 1);
    const replyText = sentMessages[0].content.text;
    assert.match(replyText, /¡Hola! Todo bien por acá\./);
    assert.match(replyText, /como es la primera vez que charlamos, me decís cuándo cumplís años/);
    assert.match(replyText, /\/registrarse DD\/MM \[el\/ella\]/);

    db.close();
  });

  await t.test('4. Proactive onboarding: Recurring user without profile gets Excel database joke', async () => {
    const db = Database.createInMemory();
    const messageRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const birthdayRepo = new BirthdayRepository(db);
    const mentionService = new MentionService(mentionRepo);

    const recurringJid = 'recurrente@s.whatsapp.net';
    const groupJid = 'group@g.us';

    // Insertar mensajes previos para simular usuario recurrente
    messageRepo.save({
      id: 'prev-1',
      groupJid,
      senderJid: recurringJid,
      senderName: 'ViejoAmigo',
      content: 'Buenas muchachos',
      timestamp: 500
    });
    messageRepo.save({
      id: 'prev-2',
      groupJid,
      senderJid: recurringJid,
      senderName: 'ViejoAmigo',
      content: 'Qué se cuenta hoy?',
      timestamp: 600
    });

    const sentMessages: Array<{ jid: string; content: any }> = [];
    const mockSocket = {
      user: { id: 'bot:0@s.whatsapp.net' },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'bot-msg-2', remoteJid: jid } };
      }
    } as unknown as WASocket;

    const mockAiService = {
      generateGroupReply: async () => '¡Hola viejo amigo!'
    } as unknown as AIService;

    const mockCommandService = {
      isCommand: () => false,
      executeCommand: async () => ({ handled: false })
    } as unknown as CommandService;

    const handler = new EventHandler({
      getSocket: () => mockSocket,
      messageRepo,
      mentionService,
      statsRepo,
      commandService: mockCommandService,
      aiService: mockAiService,
      birthdayRepo,
      botCleanJid: 'bot@s.whatsapp.net',
      userCooldownMs: 0,
      groupCooldownMs: 0,
      userOnboardingCooldownMs: 60000
    });

    const msg: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-recurrente', fromMe: false, participant: recurringJid },
      message: {
        extendedTextMessage: {
          text: 'Che @bot cómo va?',
          contextInfo: { mentionedJid: ['bot@s.whatsapp.net'] }
        }
      },
      messageTimestamp: 1000,
      pushName: 'ViejoAmigo'
    };

    await handler.handleMessage(msg);

    assert.strictEqual(sentMessages.length, 1);
    const replyText = sentMessages[0].content.text;
    assert.match(replyText, /¡Hola viejo amigo!/);
    assert.match(replyText, /Me actualizaron la base de datos en Excel/);
    assert.match(replyText, /perro tecnológico/);
    assert.match(replyText, /\/registrarse DD\/MM \[el\/ella\]/);

    db.close();
  });

  await t.test('5. Proactive onboarding: Users with complete profile do NOT get asked', async () => {
    const db = Database.createInMemory();
    const messageRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const birthdayRepo = new BirthdayRepository(db);
    const mentionService = new MentionService(mentionRepo);

    const userJid = 'registrado@s.whatsapp.net';
    const groupJid = 'group@g.us';

    // Registrar cumpleaños y género completo
    birthdayRepo.save(userJid, 15, 6, 'male');

    const sentMessages: Array<{ jid: string; content: any }> = [];
    const mockSocket = {
      user: { id: 'bot:0@s.whatsapp.net' },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'bot-msg-3', remoteJid: jid } };
      }
    } as unknown as WASocket;

    const mockAiService = {
      generateGroupReply: async () => '¡Hola fiera!'
    } as unknown as AIService;

    const mockCommandService = {
      isCommand: () => false,
      executeCommand: async () => ({ handled: false })
    } as unknown as CommandService;

    const handler = new EventHandler({
      getSocket: () => mockSocket,
      messageRepo,
      mentionService,
      statsRepo,
      commandService: mockCommandService,
      aiService: mockAiService,
      birthdayRepo,
      botCleanJid: 'bot@s.whatsapp.net',
      userCooldownMs: 0,
      groupCooldownMs: 0
    });

    const msg: WAMessage = {
      key: { remoteJid: groupJid, id: 'm-reg', fromMe: false, participant: userJid },
      message: {
        extendedTextMessage: {
          text: '@bot qué onda?',
          contextInfo: { mentionedJid: ['bot@s.whatsapp.net'] }
        }
      },
      messageTimestamp: 1000,
      pushName: 'Registrado'
    };

    await handler.handleMessage(msg);

    assert.strictEqual(sentMessages.length, 1);
    const replyText = sentMessages[0].content.text;
    assert.strictEqual(replyText, '¡Hola fiera!');
    assert.doesNotMatch(replyText, /base de datos/i);
    assert.doesNotMatch(replyText, /primera vez/i);

    db.close();
  });
});
