import test from 'node:test';
import assert from 'node:assert';
import {
  Database,
  MessageRepository,
  MentionRepository,
  SummaryRepository,
  BirthdayRepository,
  StatisticsRepository,
  GuardrailsRepository,
  HoroscopeRepository
} from '../../src/database/index.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { StatisticsService } from '../../src/services/statistics.service.js';
import { CommandService } from '../../src/services/command.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { GuardrailsService } from '../../src/services/guardrails.service.js';
import { HoroscopeService } from '../../src/services/horoscope.service.js';
import { EventHandler } from '../../src/bot/event-handler.js';
import { FEMALE_HOROSCOPE_AFFIRMATIONS, getRandomFemaleAffirmation } from '../../src/config/character.js';

test('Flirting, Aliases & Positive Horoscope Predictions Suite', async (suite) => {
  function setupTestEnv() {
    const db = Database.createInMemory();
    const messageRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const birthdayRepo = new BirthdayRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const guardrailsRepo = new GuardrailsRepository(db);
    const horoscopeRepo = new HoroscopeRepository(db);

    const authorizedGroupJid = '120363412758439456@g.us';
    const adminJid = '5493519993811@s.whatsapp.net';
    const girlPhone = '5493517883811';
    const girlJid = `${girlPhone}@s.whatsapp.net`;
    const boyJid = '5493512223333@s.whatsapp.net';

    // Registrar perfil de cumpleaños y género
    birthdayRepo.save(girlJid, 15, 5, 'female');
    birthdayRepo.save(boyJid, 20, 8, 'male');

    const guardrailsService = new GuardrailsService(guardrailsRepo, {
      botInstanceId: 'bot-test',
      initialAdminSuffixes: ['3811'],
      targetGroupJid: authorizedGroupJid
    });

    const mockAiService = {
      generateGroupReply: async (_group: string, prompt: string, user: string, _history: any, options: any) => {
        return `Hola ${user} (flirt: ${Boolean(options?.isFlirting)})`;
      },
      generateSpontaneousIntervention: async (target: string, _ctx: string, isFemale?: boolean) => {
        return isFemale
          ? `¡Epa, si hablan de la reina del grupo avisen! Firme acá @${target} 🐶👑`
          : `Epa che! Seguro está durmiendo @${target} 😂🐶😴`;
      },
      generateConversationReply: async (prompt: string) => ({
        text: `Respuesta a: ${prompt}`,
        providerUsed: 'mock',
        latencyMs: 10
      })
    } as unknown as AIService;

    const summaryService = new SummaryService(summaryRepo, messageRepo, mockAiService);
    const mentionService = new MentionService(mentionRepo);
    const markerService = new ContextMarkerService(mentionRepo, messageRepo);
    const birthdayService = new BirthdayService(birthdayRepo);
    const statisticsService = new StatisticsService(statsRepo);
    const horoscopeService = new HoroscopeService(horoscopeRepo);

    // Mock API de horóscopo para pruebas
    (horoscopeService as any).fetchFromApi = async () => ({
      text: 'Hoy la luna te favorece para encarar proyectos con total energía y decisión.'
    });

    const commandService = new CommandService(
      summaryService,
      mentionService,
      markerService,
      birthdayService,
      statisticsService,
      undefined,
      undefined,
      horoscopeService,
      mockAiService,
      '3811',
      guardrailsService
    );

    const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
    const mockSocket = {
      user: { id: '5493515554241:12@s.whatsapp.net', name: 'Mequetrefe' },
      sendMessage: async (jid: string, content: any, options?: any) => {
        sentMessages.push({ jid, content, options });
        return { key: { id: `bot-msg-${Date.now()}` } };
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
      guardrailsService,
      birthdayRepo,
      targetGroupJid: authorizedGroupJid,
      userCooldownMs: 0,
      groupCooldownMs: 0
    });

    return {
      db,
      guardrailsRepo,
      guardrailsService,
      commandService,
      eventHandler,
      horoscopeService,
      sentMessages,
      authorizedGroupJid,
      adminJid,
      girlPhone,
      girlJid,
      boyJid
    };
  }

  await suite.test('Banco de 50 afirmaciones del horóscopo contiene exactamente 50 frases de calidad', () => {
    assert.strictEqual(FEMALE_HOROSCOPE_AFFIRMATIONS.length, 50, 'Debe contener exactamente 50 afirmaciones');
    for (const aff of FEMALE_HOROSCOPE_AFFIRMATIONS) {
      assert.ok(aff.includes('Mequetrefe'), 'Cada afirmación debe llevar la firma de Mequetrefe');
      assert.ok(aff.length > 30, 'Cada afirmación debe ser sustanciosa y con buena onda');
    }

    const randomOne = getRandomFemaleAffirmation();
    assert.ok(FEMALE_HOROSCOPE_AFFIRMATIONS.includes(randomOne));
  });

  await suite.test('Horóscopo: SIEMPRE incluye predicción positiva para chicas, nunca para chicos', async () => {
    const env = setupTestEnv();

    // 1. Consulta de horóscopo por una chica registrada
    const girlCmd = await env.commandService.executeCommand(
      env.authorizedGroupJid,
      env.girlJid,
      'Nattalia',
      '/h'
    );
    assert.ok(girlCmd.handled);
    assert.ok(girlCmd.replyText?.includes('Predicción de Mequetrefe') || girlCmd.replyText?.includes('Consejo de Mequetrefe') || girlCmd.replyText?.includes('Nota astral de Mequetrefe'), 'Debe incluir predicción personal de Mequetrefe');

    // 2. Consulta de horóscopo consecutiva por la misma chica (sin cooldown en horóscopo)
    const girlCmd2 = await env.commandService.executeCommand(
      env.authorizedGroupJid,
      env.girlJid,
      'Nattalia',
      '/h'
    );
    assert.ok(girlCmd2.handled);
    assert.ok(girlCmd2.replyText?.includes('Mequetrefe'), 'Debe seguir incluyendo la predicción personal dulce');

    // 3. Consulta de horóscopo por un chico
    const boyCmd = await env.commandService.executeCommand(
      env.authorizedGroupJid,
      env.boyJid,
      'Martín',
      '/h'
    );
    assert.ok(boyCmd.handled);
    assert.ok(!boyCmd.replyText?.includes('mi amor') && !boyCmd.replyText?.includes('bomba'), 'El horóscopo masculino no debe incluir halagos femeninos');
  });

  await suite.test('Gestión de apodos vía comando /apodo por admin', async () => {
    const env = setupTestEnv();

    // 1. Usuario no admin intenta agregar apodos -> Bloqueado
    const nonAdminResult = await env.commandService.executeCommand(
      env.authorizedGroupJid,
      env.boyJid,
      'Martín',
      `/apodo ${env.girlPhone} batichica, morocha`
    );
    assert.ok(nonAdminResult.replyText?.includes('exclusivamente para administradores'));

    // 2. Admin agrega apodos
    const adminResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      `/apodo ${env.girlPhone} batichica, morocha, reina`
    );
    assert.ok(adminResult.replyText?.includes('batichica, morocha, reina'));

    const aliases = env.guardrailsService.getAliases(env.girlPhone);
    assert.strictEqual(aliases.length, 3);
    assert.ok(aliases.includes('batichica'));
    assert.ok(aliases.includes('morocha'));
    assert.ok(aliases.includes('reina'));

    // 3. Listar apodos
    const listResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      '/apodo listar'
    );
    assert.ok(listResult.replyText?.includes(env.girlPhone));
    assert.ok(listResult.replyText?.includes('batichica'));

    // 4. Quitar un apodo
    const removeResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      `/apodo quitar ${env.girlPhone} batichica`
    );
    assert.ok(removeResult.replyText?.includes('eliminado'));
    assert.strictEqual(env.guardrailsService.getAliases(env.girlPhone).length, 2);
  });

  await suite.test('Entromisión pasiva ante mención de apodo en el grupo', async () => {
    const env = setupTestEnv();

    // Registrar apodo "batichica" para la chica
    env.guardrailsService.addAliases(env.girlPhone, ['batichica'], 'admin');

    // Mensaje pasivo en el grupo donde alguien nombra "batichica"
    const passiveMsg = {
      key: { id: 'msg-alias-1', remoteJid: env.authorizedGroupJid, fromMe: false },
      message: { conversation: 'Che dónde andará batichica que no contesta?' },
      messageTimestamp: 1700000000,
      pushName: 'Lucas'
    } as any;

    // Forzar Math.random para que pase la probabilidad de entromisión (0.45)
    const originalRandom = Math.random;
    Math.random = () => 0.10;

    try {
      await env.eventHandler.handleMessage(passiveMsg);

      assert.strictEqual(env.sentMessages.length, 1, 'Debe haber intervenido espontáneamente');
      const sent = env.sentMessages[0];
      assert.ok(sent.content.text.includes(env.girlPhone), 'Debe etiquetar el número de la chica');
      assert.ok(sent.content.mentions.includes(env.girlJid), 'Debe incluir mención nativa de la chica');

      // Verificar que se activó el cooldown de 3 horas para la chica
      assert.strictEqual(env.guardrailsService.canFlirtSpontaneously(env.girlJid), false);

      // Si otro mensaje vuelve a mencionar "batichica" inmediatamente, NO debe intervenir por el cooldown
      env.sentMessages.length = 0;
      const secondPassiveMsg = {
        key: { id: 'msg-alias-2', remoteJid: env.authorizedGroupJid, fromMe: false },
        message: { conversation: 'Sí batichica desapareció' },
        messageTimestamp: 1700000010,
        pushName: 'Lucas'
      } as any;

      await env.eventHandler.handleMessage(secondPassiveMsg);
      assert.strictEqual(env.sentMessages.length, 0, 'No debe intervenir por estar dentro del cooldown de 3 horas');
    } finally {
      Math.random = originalRandom;
    }
  });

  await suite.test('Cooldown estricto de 3 horas para halagos espontáneos', () => {
    const env = setupTestEnv();

    // Estado inicial: puede halagar
    assert.strictEqual(env.guardrailsService.canFlirtSpontaneously(env.girlJid), true);

    // Se halaga a la chica
    env.guardrailsService.recordSpontaneousFlirt(env.girlJid);
    assert.strictEqual(env.guardrailsService.canFlirtSpontaneously(env.girlJid), false);

    // Adelantar tiempo simulando 2 horas y 59 minutos
    const originalDateNow = Date.now;
    const now = Date.now();
    Date.now = () => now + (2 * 3600 + 59 * 60) * 1000;
    assert.strictEqual(env.guardrailsService.canFlirtSpontaneously(env.girlJid), false);

    // Cumplidas las 3 horas y 1 minuto -> se reactiva
    Date.now = () => now + (3 * 3600 + 60) * 1000;
    assert.strictEqual(env.guardrailsService.canFlirtSpontaneously(env.girlJid), true);

    Date.now = originalDateNow;
  });
});
