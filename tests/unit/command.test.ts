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

  await t.test('isCommand correctly detects slash commands', () => {
    assert.strictEqual(commandService.isCommand('/resumen'), true);
    assert.strictEqual(commandService.isCommand('  /ayuda  '), true);
    assert.strictEqual(commandService.isCommand('@123456 /micumple 12/05'), true);
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
    assert.match(res.replyText!, /\/micumple/);
    assert.match(res.replyText!, /\/top/);
  });

  await t.test('Executes /micumple registration and query', async () => {
    // 1. Consulta sin tener registrado
    const resQueryEmpty = await commandService.executeCommand(groupJid, userJid, userName, '/micumple');
    assert.strictEqual(resQueryEmpty.handled, true);
    assert.match(resQueryEmpty.replyText!, /Aún no tienes un cumpleaños registrado/);

    // 2. Formato inválido
    const resInvalid = await commandService.executeCommand(groupJid, userJid, userName, '/micumple 32/13');
    assert.strictEqual(resInvalid.handled, true);
    assert.match(resInvalid.replyText!, /Formato de fecha inválido/);

    // 3. Registro exitoso
    const resSuccess = await commandService.executeCommand(groupJid, userJid, userName, '/micumple 25/12');
    assert.strictEqual(resSuccess.handled, true);
    assert.match(resSuccess.replyText!, /Guardé tu cumpleaños para el \*25\/12\*/);

    // 4. Consulta teniendo registrado
    const resQueryFilled = await commandService.executeCommand(groupJid, userJid, userName, '/micumple');
    assert.strictEqual(resQueryFilled.handled, true);
    assert.match(resQueryFilled.replyText!, /Tu fecha de cumpleaños registrada es el \*25\/12\*/);
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

  await t.test('Ignores normal text without slash', async () => {
    const res = await commandService.executeCommand(groupJid, userJid, userName, 'Hola bot');
    assert.strictEqual(res.handled, false);
    assert.strictEqual(res.replyText, undefined);
  });

  db.close();
});
