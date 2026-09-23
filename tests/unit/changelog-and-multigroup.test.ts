import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_VERSION, buildUpdateBroadcastMessage } from '../../src/config/changelog.js';
import { buildMetaAIPrompt } from '../../src/config/character.js';
import { Database } from '../../src/database/db.js';
import { MessageRepository } from '../../src/database/repositories/message.repository.js';
import { MentionRepository } from '../../src/database/repositories/mention.repository.js';
import { SummaryRepository } from '../../src/database/repositories/summary.repository.js';
import { BirthdayRepository } from '../../src/database/repositories/birthday.repository.js';
import { StatisticsRepository } from '../../src/database/repositories/statistics.repository.js';
import { JobExecutionRepository } from '../../src/database/repositories/job-execution.repository.js';
import { NewsRepository } from '../../src/database/repositories/news.repository.js';
import { GuardrailsRepository } from '../../src/database/repositories/guardrails.repository.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { StatisticsService } from '../../src/services/statistics.service.js';
import { InactivityService } from '../../src/services/inactivity.service.js';
import { NewsService } from '../../src/services/news.service.js';
import { WeatherService } from '../../src/services/weather.service.js';
import { AIService } from '../../src/services/ai.service.js';
import { SchedulerService, type SchedulerTargetAdapter } from '../../src/services/scheduler.service.js';
import { GuardrailsService } from '../../src/services/guardrails.service.js';
import { CommandService } from '../../src/services/command.service.js';

test('Changelog, Multi-Group Scheduler & Context Isolation Suite', async (t) => {
  await t.test('1. Changelog template contains version, highlights, and fixes properly formatted', () => {
    const message = buildUpdateBroadcastMessage(CURRENT_VERSION);
    assert.match(message, /¡Mequetrefe se actualizó a la versión v1\.2\.0!/);
    assert.match(message, /Novedades y Mejoras:/);
    assert.match(message, /Aislamiento estricto de contexto entre grupos/);
    assert.match(message, /Correcciones y Ajustes:/);
    assert.match(message, /Corregido el scheduler/);
    assert.match(message, /\/ayuda/);
  });

  await t.test('2. Meta AI prompt enforces strict group isolation without cross-chat memory', () => {
    const prompt = buildMetaAIPrompt('hola', 'Juan: che loco cómo va');
    assert.match(prompt, /Aislamiento: chat independiente/);
    assert.match(prompt, /No uses memoria ni recuerdos de charlas anteriores/);
    assert.match(prompt, /Contexto previo exclusivo de este grupo:/);
  });

  await t.test('3. SchedulerService correctly dispatches to MULTIPLE authorized groups at 08:00', async () => {
    const db = Database.createInMemory();
    const msgRepo = new MessageRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const bdayRepo = new BirthdayRepository(db);
    const statsRepo = new StatisticsRepository(db);
    const jobRepo = new JobExecutionRepository(db);
    const newsRepo = new NewsRepository(db);
    const guardrailsRepo = new GuardrailsRepository(db);

    const group1 = '120363001@g.us'; // EVV
    const group2 = '120363002@g.us'; // Pruebas

    guardrailsRepo.authorizeGroup(group1, 'Grupo EVV', 'admin', true);
    guardrailsRepo.authorizeGroup(group2, 'Grupo Pruebas', 'admin', true);

    const sentMessages: Array<{ target: string; text: string }> = [];

    const adapter: SchedulerTargetAdapter = {
      sendMessage: async (target: string, text: string) => {
        sentMessages.push({ target, text });
      },
      getTargetGroupJids: () => [group1, group2],
      getBotCleanJid: () => '123456789@s.whatsapp.net'
    };

    const aiService = new AIService({});
    const summaryService = new SummaryService(summaryRepo, msgRepo, aiService);
    const bdayService = new BirthdayService(bdayRepo, jobRepo, aiService);
    const newsService = new NewsService(newsRepo, aiService);
    const weatherService = new WeatherService();
    const inactivityService = new InactivityService(msgRepo, statsRepo, aiService, {
      thresholdMs: 1000,
      cooldownMs: 1000
    });

    const scheduler = new SchedulerService(
      summaryService,
      bdayService,
      inactivityService,
      newsService,
      weatherService,
      aiService,
      jobRepo,
      adapter
    );

    // Mock fecha 08:00
    const mockDate = new Date('2026-09-23T08:00:00-03:00');
    await scheduler.tick(mockDate);

    // Ambos grupos deben haber recibido mensajes
    const group1Messages = sentMessages.filter((m) => m.target === group1);
    const group2Messages = sentMessages.filter((m) => m.target === group2);

    assert.ok(group1Messages.length > 0, 'Grupo EVV debe haber recibido el saludo matutino');
    assert.ok(group2Messages.length > 0, 'Grupo Pruebas debe haber recibido el saludo matutino');

    // Verificar que la ejecución se registró para ambos grupos en job_executions
    assert.ok(jobRepo.isJobExecuted(`daily_morning_message:${group1}:2026-09-23`));
    assert.ok(jobRepo.isJobExecuted(`daily_morning_message:${group2}:2026-09-23`));
  });

  await t.test('4. broadcastCustomMessage delivers to all target groups', async () => {
    const db = Database.createInMemory();
    const sent: string[] = [];

    const adapter: SchedulerTargetAdapter = {
      sendMessage: async (target: string) => {
        sent.push(target);
      },
      getTargetGroupJids: () => ['grupo_a@g.us', 'grupo_b@g.us'],
      getBotCleanJid: () => 'bot@s.whatsapp.net'
    };

    const scheduler = new SchedulerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new JobExecutionRepository(db),
      adapter
    );

    const delivered = await scheduler.broadcastCustomMessage('¡Hola grupos!');
    assert.equal(delivered.length, 2);
    assert.deepEqual(sent, ['grupo_a@g.us', 'grupo_b@g.us']);
  });

  await t.test('5. Command /novedades responds with current version highlights', async () => {
    const db = Database.createInMemory();
    const summaryRepo = new SummaryRepository(db);
    const msgRepo = new MessageRepository(db);
    const mentionRepo = new MentionRepository(db);
    const bdayRepo = new BirthdayRepository(db);
    const statsRepo = new StatisticsRepository(db);

    const summaryService = new SummaryService(summaryRepo, msgRepo);
    const mentionService = new MentionService(mentionRepo);
    const contextMarkerService = new ContextMarkerService(mentionRepo, msgRepo);
    const birthdayService = new BirthdayService(bdayRepo, new JobExecutionRepository(db));
    const statsService = new StatisticsService(statsRepo);

    const cmdService = new CommandService(
      summaryService,
      mentionService,
      contextMarkerService,
      birthdayService,
      statsService
    );

    const res = await cmdService.executeCommand('grupo@g.us', 'user@s.whatsapp.net', 'Juan', '/novedades');
    assert.equal(res.handled, true);
    assert.match(res.replyText || '', /¡Mequetrefe se actualizó a la versión v1\.2\.0!/);
  });
});
