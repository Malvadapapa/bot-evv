import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  Database,
  MessageRepository,
  MentionRepository,
  SummaryRepository,
  BirthdayRepository,
  StatisticsRepository,
  GuardrailsRepository
} from '../../src/database/index.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { StatisticsService } from '../../src/services/statistics.service.js';
import { CommandService } from '../../src/services/command.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { GuardrailsService } from '../../src/services/guardrails.service.js';
import { EventHandler } from '../../src/bot/event-handler.js';

test('Guardrails & Bot Behavior Rules Suite', async (suite) => {
  function setupTestEnv(initialAdminSuffix = '3811', authorizedGroupJid = '120363412758439456@g.us') {
    const db = Database.createInMemory();
    const messageRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const birthdayRepo = new BirthdayRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const guardrailsRepo = new GuardrailsRepository(db);

    const guardrailsService = new GuardrailsService(guardrailsRepo, {
      botInstanceId: 'bot-test-instance',
      initialAdminSuffixes: [initialAdminSuffix],
      targetGroupJid: authorizedGroupJid
    });

    const mockAiService = {
      generateGroupReply: async (_group: string, prompt: string, user: string, _history: any, options: any) => {
        if (options?.personalityDirective) {
          return `[DIRECTIVA: ${options.personalityDirective}] Hola ${user}`;
        }
        return `Hola ${user}, respuesta normal`;
      },
      generateConversationReply: async (prompt: string) => ({
        text: `Respuesta: ${prompt}`,
        providerUsed: 'mock',
        latencyMs: 10
      })
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
      statisticsService,
      undefined,
      undefined,
      undefined,
      mockAiService,
      initialAdminSuffix,
      guardrailsService
    );

    const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
    let leftGroups: string[] = [];

    const mockSocket = {
      user: { id: '5493515554241:12@s.whatsapp.net', name: 'Mequetrefe' },
      sendMessage: async (jid: string, content: any, options?: any) => {
        sentMessages.push({ jid, content, options });
        return { key: { id: `bot-msg-${Date.now()}` } };
      },
      sendPresenceUpdate: async () => {},
      readMessages: async () => {},
      groupLeave: async (jid: string) => {
        leftGroups.push(jid);
      }
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
      messageRepo,
      guardrailsRepo,
      guardrailsService,
      commandService,
      eventHandler,
      mockSocket,
      sentMessages,
      leftGroups,
      authorizedGroupJid,
      adminJid: `549351999${initialAdminSuffix}@s.whatsapp.net`,
      regularUserJid: '5493511112222@s.whatsapp.net',
      botCleanJid: '5493515554241@s.whatsapp.net'
    };
  }

  await suite.test('Regla 5: WhatsApp Status (@broadcast) debe ignorarse por completo', async () => {
    const env = setupTestEnv();
    const statusMsg = {
      key: { id: 'status-1', remoteJid: 'status@broadcast', fromMe: false },
      message: { conversation: 'Foto de estado con texto' },
      messageTimestamp: 1700000000,
      pushName: 'Alguien'
    } as any;

    await env.eventHandler.handleMessage(statusMsg);

    assert.strictEqual(env.sentMessages.length, 0, 'No debe responder a estados');
    assert.strictEqual(env.messageRepo.getRecentMessages('status@broadcast', 10).length, 0, 'No debe guardar estados en la base de datos');
  });

  await suite.test('Regla 4: Mensajes Privados (DMs) - Usuario común ignorado, Admin permitido para comandos', async () => {
    const env = setupTestEnv();

    // 1. Usuario común en chat privado escribe algo
    const userDmMsg = {
      key: { id: 'dm-user-1', remoteJid: env.regularUserJid, fromMe: false },
      message: { conversation: 'Hola bot, cómo estás?' },
      messageTimestamp: 1700000000,
      pushName: 'Pepe'
    } as any;

    await env.eventHandler.handleMessage(userDmMsg);
    assert.strictEqual(env.sentMessages.length, 0, 'Usuario común debe ser ignorado con silencio absoluto');
    assert.strictEqual(env.messageRepo.getRecentMessages(env.regularUserJid, 10).length, 0, 'No debe registrarse en mensajes de grupo');

    // 2. Admin en chat privado ejecuta comando /admin listar
    const adminDmMsg = {
      key: { id: 'dm-admin-1', remoteJid: env.adminJid, fromMe: false },
      message: { conversation: '/admin listar' },
      messageTimestamp: 1700000001,
      pushName: 'Admin Cristian'
    } as any;

    await env.eventHandler.handleMessage(adminDmMsg);
    assert.strictEqual(env.sentMessages.length, 1, 'Admin debe recibir respuesta a su comando en privado');
    assert.ok(env.sentMessages[0].content.text.includes('ADMINISTRADORES REGISTRADOS'));
  });

  await suite.test('Regla 10: Grupo no autorizado debe ser ignorado 100% hasta aprobación', async () => {
    const env = setupTestEnv();
    const unauthorizedGroupJid = '99999999999999999@g.us';

    // Mensaje en grupo no autorizado
    const unauthMsg = {
      key: { id: 'unauth-1', remoteJid: unauthorizedGroupJid, fromMe: false },
      message: { conversation: '@Mequetrefe hola perro' },
      messageTimestamp: 1700000000,
      pushName: 'Random'
    } as any;

    await env.eventHandler.handleMessage(unauthMsg);
    assert.strictEqual(env.sentMessages.length, 0, 'Grupo no autorizado no recibe respuestas');
    assert.strictEqual(env.messageRepo.getRecentMessages(unauthorizedGroupJid, 10).length, 0, 'Grupo no autorizado no almacena ningún mensaje');

    // Simular creación de solicitud de ingreso
    const joinReq = env.guardrailsService.createGroupJoinRequest(
      unauthorizedGroupJid,
      'Los Pibes de la Esquina',
      env.regularUserJid
    );
    assert.ok(joinReq.id.startsWith('SOL-'));
    assert.strictEqual(joinReq.status, 'pending');

    // Admin aprueba la solicitud vía comando
    const approveResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      `/aprobar ${joinReq.id}`
    );
    assert.strictEqual(approveResult.action, 'group_approved');
    assert.strictEqual(approveResult.actionGroupJid, unauthorizedGroupJid);
    assert.ok(env.guardrailsService.isGroupAuthorized(unauthorizedGroupJid));
  });

  await suite.test('Regla 10 & Timeout: Solicitud de grupo no aprobada tras 12 horas expira y se sale', async () => {
    const env = setupTestEnv();
    const testGroup = '88888888888888@g.us';

    const joinReq = env.guardrailsService.createGroupJoinRequest(testGroup, 'Grupo Abandonado', env.regularUserJid);

    // Adelantar tiempo simulando 12h y 1 minuto después
    const futureTime = Date.now() + 12.1 * 3600 * 1000;
    const expiredRequests = env.guardrailsRepo.getExpiredPendingRequests(futureTime);
    assert.strictEqual(expiredRequests.length, 1);
    assert.strictEqual(expiredRequests[0].id, joinReq.id);

    // Marcar como expirada
    env.guardrailsService.expireGroupRequest(joinReq.id);
    const updated = env.guardrailsRepo.getJoinRequest(joinReq.id);
    assert.strictEqual(updated?.status, 'expired');
    assert.strictEqual(updated?.resolvedBy, 'system_timeout');
  });

  await suite.test('Regla 11: Presentación oficial en grupo autorizado por primera vez', async () => {
    const env = setupTestEnv();
    const newAuthGroup = '77777777777777@g.us';

    // Autorizar grupo con intro_sent = false
    env.guardrailsRepo.authorizeGroup(newAuthGroup, 'Nuevo Grupo', 'admin', false);
    assert.strictEqual(env.guardrailsService.isIntroSent(newAuthGroup), false);

    // Llega un mensaje normal al nuevo grupo
    const msg1 = {
      key: { id: 'msg-new-1', remoteJid: newAuthGroup, fromMe: false },
      message: { conversation: 'Hola muchachos' },
      messageTimestamp: 1700000000,
      pushName: 'Lucas'
    } as any;

    await env.eventHandler.handleMessage(msg1);

    // Se debe haber enviado la introducción
    assert.strictEqual(env.sentMessages.length, 1);
    assert.ok(env.sentMessages[0].content.text.includes('Soy Mequetrefe, el bot asistente de este grupo'));
    assert.strictEqual(env.guardrailsService.isIntroSent(newAuthGroup), true);

    // Segundo mensaje ya no debe re-enviar la introducción
    env.sentMessages.length = 0;
    const msg2 = {
      key: { id: 'msg-new-2', remoteJid: newAuthGroup, fromMe: false },
      message: { conversation: 'Qué hacés che' },
      messageTimestamp: 1700000005,
      pushName: 'Lucas'
    } as any;

    await env.eventHandler.handleMessage(msg2);
    assert.strictEqual(env.sentMessages.length, 0, 'No debe repetir el mensaje de introducción');
  });

  await suite.test('Regla 2: Rate Limiting de Comandos (1/segundo, 30/hora, Admin exento)', async () => {
    const env = setupTestEnv();

    // 1. Usuario normal ejecuta comando
    const check1 = env.guardrailsService.checkCommandRateLimit(
      env.regularUserJid,
      'Pepe',
      env.authorizedGroupJid,
      '/ayuda'
    );
    assert.strictEqual(check1.allowed, true);

    // 2. Usuario normal ejecuta inmediatamente (<1s)
    const check2 = env.guardrailsService.checkCommandRateLimit(
      env.regularUserJid,
      'Pepe',
      env.authorizedGroupJid,
      '/ayuda'
    );
    assert.strictEqual(check2.allowed, false, 'Debe bloquear por superar 1 comando por segundo');

    // 3. Admin queda exento de rate limit inmediato (<1s)
    const adminCheck1 = env.guardrailsService.checkCommandRateLimit(
      env.adminJid,
      'Cristian',
      env.authorizedGroupJid,
      '/ayuda'
    );
    const adminCheck2 = env.guardrailsService.checkCommandRateLimit(
      env.adminJid,
      'Cristian',
      env.authorizedGroupJid,
      '/ayuda'
    );
    assert.strictEqual(adminCheck1.allowed, true);
    assert.strictEqual(adminCheck2.allowed, true, 'Admin debe estar exento de rate limit');
  });

  await suite.test('Regla 3: Batería Social (15 preguntas/hora, degradación progresiva, silencio en 16+)', async () => {
    const env = setupTestEnv();
    const userJid = '5493517778888@s.whatsapp.net';

    // Interacciones 1 a 5: Normal
    for (let i = 1; i <= 5; i++) {
      const res = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.level, 'normal', `Interacción ${i} debe ser nivel normal`);
    }

    // Interacciones 6 a 9: Cansancio con humor
    for (let i = 6; i <= 9; i++) {
      const res = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.level, 'tired_humor', `Interacción ${i} debe ser cansado con humor`);
      assert.ok(res.personalityDirective);
    }

    // Interacciones 10 a 12: Poca paciencia
    for (let i = 10; i <= 12; i++) {
      const res = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.level, 'low_patience', `Interacción ${i} debe ser poca paciencia`);
    }

    // Interacciones 13 a 14: Muy breve y quemado
    for (let i = 13; i <= 14; i++) {
      const res = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.level, 'very_brief', `Interacción ${i} debe ser muy breve`);
    }

    // Interacción 15: Cierre con mensaje obligatorio
    const res15 = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
    assert.strictEqual(res15.allowed, true);
    assert.strictEqual(res15.level, 'exhausted');
    assert.strictEqual(
      res15.finalMessage,
      'Nos vemos dentro de una hora, maestro. Mi batería social necesita cargarse 🔋😴'
    );

    // Interacción 16+: Silencio absoluto
    const res16 = env.guardrailsService.checkSocialBattery(userJid, 'Fede');
    assert.strictEqual(res16.allowed, false, 'Interacción 16 debe ser bloqueada (silencio)');
    assert.strictEqual(res16.level, 'blocked');

    // Admin queda exento de límite de batería social
    for (let i = 1; i <= 20; i++) {
      const adminBattery = env.guardrailsService.checkSocialBattery(env.adminJid, 'Cristian');
      assert.strictEqual(adminBattery.allowed, true);
      assert.strictEqual(adminBattery.level, 'normal');
    }
  });

  await suite.test('Regla 9: Backups de base de datos en JSON con todas las tablas', async () => {
    const env = setupTestEnv();

    const backupResult = env.guardrailsService.createBackup();
    assert.ok(fs.existsSync(backupResult.filePath), 'El archivo de backup debe existir en disco');

    const backupContent = JSON.parse(fs.readFileSync(backupResult.filePath, 'utf-8'));
    assert.strictEqual(backupContent.botInstanceId, 'bot-test-instance');
    assert.ok(backupContent.data.system_config);
    assert.ok(backupContent.data.admin_users);
    assert.ok(backupContent.data.authorized_groups);

    // Limpiar backup generado por el test
    fs.unlinkSync(backupResult.filePath);
  });

  await suite.test('Regla 12: Gestión de Administradores (/admin agregar, listar, quitar)', async () => {
    const env = setupTestEnv();
    const newAdminPhone = '5493517654321';

    // 1. Agregar admin
    const addResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      `/admin ${newAdminPhone}`
    );
    assert.ok(addResult.replyText?.includes('ha sido registrado como nuevo administrador'));
    assert.strictEqual(env.guardrailsService.isAdmin(`${newAdminPhone}@s.whatsapp.net`), true);

    // 2. Listar admins
    const listResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      '/admin listar'
    );
    assert.ok(listResult.replyText?.includes(newAdminPhone));

    // 3. Quitar admin
    const removeResult = await env.commandService.executeCommand(
      env.adminJid,
      env.adminJid,
      'Cristian',
      `/admin quitar ${newAdminPhone}`
    );
    assert.ok(removeResult.replyText?.includes('revocado como administrador'));
    assert.strictEqual(env.guardrailsService.isAdmin(`${newAdminPhone}@s.whatsapp.net`), false);
  });
});
