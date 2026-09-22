import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, MentionRepository, SummaryRepository, BirthdayRepository, StatisticsRepository } from '../../src/database/index.js';
import { CommandService } from '../../src/services/command.service.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { StatisticsService } from '../../src/services/statistics.service.js';
import { AIService } from '../../src/services/ai.service.js';

test('CommandService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const msgRepo = new MessageRepository(db);
  const mentionRepo = new MentionRepository(db);
  const summaryRepo = new SummaryRepository(db);
  const bdayRepo = new BirthdayRepository(db);
  const statsRepo = new StatisticsRepository(db);

  const mockAiService = {
    generateIncrementalSummary: async () => 'Resumen de prueba generado con éxito.'
  } as unknown as AIService;

  const summaryService = new SummaryService(summaryRepo, msgRepo, mockAiService);
  const mentionService = new MentionService(mentionRepo);
  const markerService = new ContextMarkerService(mentionRepo, msgRepo);
  const birthdayService = new BirthdayService(bdayRepo);
  const statisticsService = new StatisticsService(statsRepo);

  const commandService = new CommandService(
    summaryService,
    mentionService,
    markerService,
    birthdayService,
    statisticsService
  );

  const groupJid = 'test-group@g.us';
  const userJid = 'user1@s.whatsapp.net';
  const userName = 'Alice';

  await t.test('isCommand correctly detects slash commands and test! commands', () => {
    assert.strictEqual(commandService.isCommand('/resumen'), true);
    assert.strictEqual(commandService.isCommand('  /ayuda  '), true);
    assert.strictEqual(commandService.isCommand('@123456 /registrarse 12/05'), true);
    assert.strictEqual(commandService.isCommand('@123456 /micumple 12/05'), true);
    assert.strictEqual(commandService.isCommand('test!noticias'), true);
    assert.strictEqual(commandService.isCommand('test!comentario Cristian lo dejó la novia'), true);
    assert.strictEqual(commandService.isCommand('/test!noticias'), true);
    assert.strictEqual(commandService.isCommand('!test!noticias'), true);
    assert.strictEqual(commandService.isCommand('Hola que tal'), false);
    assert.strictEqual(commandService.isCommand('@Bot mequetrefe'), false);
  });

  await t.test('Executes /ayuda and returns list of commands', async () => {
    const res = await commandService.executeCommand(groupJid, userJid, userName, '/ayuda');
    assert.strictEqual(res.handled, true);
    assert.match(res.replyText!, /COMANDOS DISPONIBLES/);
    assert.match(res.replyText!, /\/resumen/);
    assert.match(res.replyText!, /\/menciones/);
    assert.match(res.replyText!, /\/marcar/);
    assert.match(res.replyText!, /\/registrarse/);
    assert.match(res.replyText!, /\/top/);
  });

  await t.test('Executes /registrarse (and /micumple alias) registration and query', async () => {
    // 1. Consulta sin tener registrado
    const resQueryEmpty = await commandService.executeCommand(groupJid, userJid, userName, '/registrarse');
    assert.strictEqual(resQueryEmpty.handled, true);
    assert.match(resQueryEmpty.replyText!, /Aún no te has registrado/);

    // 2. Formato inválido
    const resInvalid = await commandService.executeCommand(groupJid, userJid, userName, '/registrarse 32/13');
    assert.strictEqual(resInvalid.handled, true);
    assert.match(resInvalid.replyText!, /Formato de fecha inválido/);

    // 3. Registro exitoso con /registrarse
    const resSuccess = await commandService.executeCommand(groupJid, userJid, userName, '/registrarse 25/12');
    assert.strictEqual(resSuccess.handled, true);
    assert.match(resSuccess.replyText!, /Guardé tu cumpleaños para el \*25\/12\*/);

    // 4. Consulta teniendo registrado con /registrarse
    const resQueryFilled = await commandService.executeCommand(groupJid, userJid, userName, '/registrarse');
    assert.strictEqual(resQueryFilled.handled, true);
    assert.match(resQueryFilled.replyText!, /Tu fecha de registro es el \*25\/12\*/);

    // 5. Consulta usando el alias /micumple
    const resAlias = await commandService.executeCommand(groupJid, userJid, userName, '/micumple');
    assert.strictEqual(resAlias.handled, true);
    assert.match(resAlias.replyText!, /Tu fecha de registro es el \*25\/12\*/);
  });

  await t.test('Executes /top and returns leaderboard', async () => {
    statsRepo.recordMessage(groupJid, userJid, userName, Date.now());
    statsRepo.recordMessage(groupJid, userJid, userName, Date.now() + 1);
    statsRepo.recordMessage(groupJid, 'user2@s.whatsapp.net', 'Bob', Date.now() + 2);

    const res = await commandService.executeCommand(groupJid, userJid, userName, '/top');
    assert.strictEqual(res.handled, true);
    assert.match(res.replyText!, /TOP \d+ USUARIOS MÁS ACTIVOS/);
    assert.match(res.replyText!, /Alice/);
    assert.match(res.replyText!, /Bob/);
  });

  await t.test('Executes /menciones and /marcar', async () => {
    // Sin menciones
    const resMencionesEmpty = await commandService.executeCommand(groupJid, userJid, userName, '/menciones');
    assert.strictEqual(resMencionesEmpty.handled, true);
    assert.match(resMencionesEmpty.replyText!, /No tienes menciones registradas/);

    // Agregar una mención para user1
    msgRepo.save({
      id: 'msg-mention-1',
      groupJid,
      senderJid: 'user2@s.whatsapp.net',
      senderName: 'Bob',
      content: 'Hola @Alice mira esto',
      timestamp: Date.now()
    });
    mentionService.recordMentions(
      groupJid,
      'msg-mention-1',
      'user2@s.whatsapp.net',
      'Bob',
      'Hola @Alice mira esto',
      [userJid],
      Date.now()
    );

    const resMencionesFilled = await commandService.executeCommand(groupJid, userJid, userName, '/menciones 1');
    assert.strictEqual(resMencionesFilled.handled, true);
    assert.match(resMencionesFilled.replyText!, /Tus últimas menciones/);

    // /marcar
    const resMarcar = await commandService.executeCommand(groupJid, userJid, userName, '/marcar');
    assert.strictEqual(resMarcar.handled, true);
    assert.strictEqual(resMarcar.quotedMessageId, 'msg-mention-1');
    assert.match(resMarcar.replyText!, /Contexto de tu última mención/);
  });

  await t.test('Executes /resumen with checkpointing', async () => {
    msgRepo.save({
      id: 'm-sum-1',
      groupJid,
      senderJid: userJid,
      senderName: userName,
      content: 'Debatiendo la arquitectura del bot',
      timestamp: Date.now()
    });

    const res = await commandService.executeCommand(groupJid, userJid, userName, '/resumen');
    assert.strictEqual(res.handled, true);
    assert.match(res.replyText!, /Resumen actualizado de hoy/);
  });

  await t.test('Handles unknown commands cleanly', async () => {
    const res = await commandService.executeCommand(groupJid, userJid, userName, '/cualquiercosa');
    assert.strictEqual(res.handled, true);
    assert.match(res.replyText!, /Comando no reconocido: `\/cualquiercosa`/);
  });

  await t.test('test! commands: rejected for non-admin, executed for admin ending in 3811', async () => {
    let briefingCalled = false;
    let briefingJid = '';
    let briefingIsTest = false;

    const mockScheduler = {
      sendMorningBriefing: async (jid: string, isTest: boolean) => {
        briefingCalled = true;
        briefingJid = jid;
        briefingIsTest = isTest;
      }
    } as any;

    const mockAi = {
      generateSpontaneousIntervention: async (target: string, context: string) => {
        return `Che ${target}, tranqui que no pasa nada (${context})`;
      },
      generateSpontaneousChimeIn: async (context: string) => {
        return `Acotación sobre: ${context}`;
      }
    } as any;

    const cmdService = new CommandService(
      summaryService,
      mentionService,
      markerService,
      birthdayService,
      statisticsService,
      mockScheduler,
      undefined,
      undefined,
      mockAi,
      '3811'
    );

    const nonAdminJid = '5491199998888@s.whatsapp.net';
    const adminJid = '5493512343811@s.whatsapp.net';

    // 1. Usuario no admin intenta test!noticias -> rechazado
    const resDenied = await cmdService.executeCommand(groupJid, nonAdminJid, 'Hacker', 'test!noticias');
    assert.strictEqual(resDenied.handled, true);
    assert.match(resDenied.replyText!, /reservado exclusivamente para el administrador/);
    assert.strictEqual(briefingCalled, false);

    // 2. Admin intenta test!noticias -> permitido
    const resAllowed = await cmdService.executeCommand(groupJid, adminJid, 'Cristian', 'test!noticias');
    assert.strictEqual(resAllowed.handled, true);
    assert.strictEqual(briefingCalled, true);
    assert.strictEqual(briefingJid, groupJid);
    assert.strictEqual(briefingIsTest, true);

    // 3. Usuario no admin intenta test!comentario -> rechazado
    const resComentarioDenied = await cmdService.executeCommand(groupJid, nonAdminJid, 'Hacker', 'test!comentario a cristian lo dejo la novia');
    assert.strictEqual(resComentarioDenied.handled, true);
    assert.match(resComentarioDenied.replyText!, /reservado exclusivamente para el administrador/);

    // 4. Admin intenta test!comentario con temática -> permitido
    const resComentarioAllowed = await cmdService.executeCommand(groupJid, adminJid, 'Cristian', 'test!comentario a cristian lo dejo la novia');
    assert.strictEqual(resComentarioAllowed.handled, true);
    assert.match(resComentarioAllowed.replyText!, /🧪 \*\[TEST ACOTACIÓN\]\*/);
    assert.match(resComentarioAllowed.replyText!, /Acotación sobre: Conversación del grupo: "a cristian lo dejo la novia"/);
  });

  await t.test('Executes /noticias with and without number', async () => {
    let newsOnlyCalled = false;
    let newsOnlyCount = 0;
    let newsOnlyJid = '';

    const mockScheduler = {
      sendNewsBriefingOnly: async (jid: string, count: number) => {
        newsOnlyCalled = true;
        newsOnlyCount = count;
        newsOnlyJid = jid;
      }
    } as any;

    const cmdService = new CommandService(
      summaryService,
      mentionService,
      markerService,
      birthdayService,
      statisticsService,
      mockScheduler
    );

    // 1. Sin número: envía 1 sola
    const res1 = await cmdService.executeCommand(groupJid, userJid, userName, '/noticias');
    assert.strictEqual(res1.handled, true);
    assert.strictEqual(newsOnlyCalled, true);
    assert.strictEqual(newsOnlyCount, 1);
    assert.strictEqual(newsOnlyJid, groupJid);

    // 2. Con número: /noticias 2
    newsOnlyCalled = false;
    const res2 = await cmdService.executeCommand(groupJid, userJid, userName, '/noticias 2');
    assert.strictEqual(res2.handled, true);
    assert.strictEqual(newsOnlyCalled, true);
    assert.strictEqual(newsOnlyCount, 2);
  });

  await t.test('Executes /h with birthday resolution and custom sign', async () => {
    let requestedSignName = '';
    let requestedIsFull = false;

    const mockHoroscopeService = {
      resolveSign: (input: string) => {
        if (input.toLowerCase() === 'virgo') {
          return { key: 'virgo', nameEs: 'Virgo', emoji: '♍', sigastraName: 'Virgo' };
        }
        if (input.toLowerCase() === 'libra') {
          return { key: 'libra', nameEs: 'Libra', emoji: '♎', sigastraName: 'Libra' };
        }
        return null;
      },
      getSignFromDate: (day: number, month: number) => {
        return { key: 'virgo', nameEs: 'Virgo', emoji: '♍', sigastraName: 'Virgo' };
      },
      getAllSignNames: () => ['Aries', 'Tauro', 'Virgo', 'Libra'],
      getDailyHoroscope: async (sign: any, isFull: boolean) => {
        requestedSignName = sign.nameEs;
        requestedIsFull = isFull;
        return `Horóscopo ${isFull ? 'Completo' : 'Corto'} de ${sign.nameEs}`;
      }
    } as any;

    const cmdService = new CommandService(
      summaryService,
      mentionService,
      markerService,
      birthdayService,
      statisticsService,
      undefined,
      undefined,
      mockHoroscopeService
    );

    const testUser = 'astro_user@s.whatsapp.net';

    // 1. Usuario sin cumpleaños registrado pide /h
    const resNoBirthday = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h');
    assert.strictEqual(resNoBirthday.handled, true);
    assert.match(resNoBirthday.replyText!, /No tengo registrado tu cumpleaños/);

    // 2. Registramos cumpleaños para el usuario (15/09)
    birthdayService.registerBirthday(testUser, 15, 9);

    // 3. Pide /h sin argumentos -> resuelve su signo (Virgo) y formato corto
    const resShort = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h');
    assert.strictEqual(resShort.handled, true);
    assert.strictEqual(requestedSignName, 'Virgo');
    assert.strictEqual(requestedIsFull, false);
    assert.strictEqual(resShort.replyText, 'Horóscopo Corto de Virgo');

    // 4. Pide /h largo -> resuelve su signo y formato completo
    const resLong = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h largo');
    assert.strictEqual(resLong.handled, true);
    assert.strictEqual(requestedSignName, 'Virgo');
    assert.strictEqual(requestedIsFull, true);
    assert.strictEqual(resLong.replyText, 'Horóscopo Completo de Virgo');

    // 5. Pide otro signo explícito /h libra
    const resExplicit = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h libra');
    assert.strictEqual(resExplicit.handled, true);
    assert.strictEqual(requestedSignName, 'Libra');
    assert.strictEqual(requestedIsFull, false);

    // 6. Pide /h largo virgo
    const resExplicitLong = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h largo virgo');
    assert.strictEqual(resExplicitLong.handled, true);
    assert.strictEqual(requestedSignName, 'Virgo');
    assert.strictEqual(requestedIsFull, true);

    // 7. Pide signo inválido
    const resInvalid = await cmdService.executeCommand(groupJid, testUser, 'Astro', '/h dinosaurio');
    assert.strictEqual(resInvalid.handled, true);
    assert.match(resInvalid.replyText!, /Signo no reconocido: "\*dinosaurio\*"/);
  });

  await t.test('Ignores normal text without slash', async () => {
    const res = await commandService.executeCommand(groupJid, userJid, userName, 'Hola bot');
    assert.strictEqual(res.handled, false);
    assert.strictEqual(res.replyText, undefined);
  });

  db.close();
});
