import test from 'node:test';
import assert from 'node:assert';
import {
  Database,
  SummaryRepository,
  MessageRepository,
  BirthdayRepository,
  StatisticsRepository,
  NewsRepository,
  JobExecutionRepository
} from '../../src/database/index.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { InactivityService } from '../../src/services/inactivity.service.js';
import { NewsService } from '../../src/services/news.service.js';
import { WeatherService } from '../../src/services/weather.service.js';
import { SchedulerService } from '../../src/services/scheduler.service.js';
import { AIService } from '../../src/services/ai.service.js';

test('SchedulerService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const summaryRepo = new SummaryRepository(db);
  const messageRepo = new MessageRepository(db);
  const birthdayRepo = new BirthdayRepository(db);
  const statsRepo = new StatisticsRepository(db);
  const newsRepo = new NewsRepository(db);
  const jobExecutionRepo = new JobExecutionRepository(db);

  const mockAiService = {
    generateIncrementalSummary: async () => 'Resumen',
    generateBirthdayMessage: async (names: string[]) => `¡Feliz cumple ${names.join(', ')}! 🎂`,
    generateBirthdayGreeting: async (name: string) => `¡Feliz cumple @${name}! 🎂`,
    generateInactivityNudge: async () => 'Che grupo, ¿todo bien?',
    generateDynamicMorningGreeting: async () => '☀️ *¡Buen día, gente!* Espero que hayan arrancado el día con todo ☕🚀'
  } as unknown as AIService;

  const mockWeatherService = {
    getArgentinaWeatherSummary: async () => '🌤️ *Clima en Argentina:* 18°C y cielo despejado.'
  } as unknown as WeatherService;

  const summaryService = new SummaryService(summaryRepo, messageRepo, mockAiService);
  const birthdayService = new BirthdayService(birthdayRepo, jobExecutionRepo, mockAiService);
  const inactivityService = new InactivityService(messageRepo, statsRepo, mockAiService, {
    thresholdMs: 1000,
    cooldownMs: 1000,
    mentionTopActive: false
  });
  const newsService = new NewsService(newsRepo, mockAiService);

  // Mockear obtención de noticias para pruebas predecibles
  newsService.getLatestUnpublishedNews = async () => [
    {
      id: 'https://test.com/news-1',
      title: 'Noticia Tech 1',
      link: 'https://test.com/news-1',
      source: 'Dev.to (Español)',
      summary: 'Resumen de la noticia de prueba.'
    }
  ];

  const sentMessages: Array<{ groupJid: string; text: string; options?: any }> = [];
  const targetGroupJid = 'target-group@g.us';

  const adapter = {
    sendMessage: async (groupJid: string, text: string, options?: any) => {
      sentMessages.push({ groupJid, text, options });
    },
    getTargetGroupJid: () => targetGroupJid,
    getBotCleanJid: () => 'bot@s.whatsapp.net'
  };

  const scheduler = new SchedulerService(
    summaryService,
    birthdayService,
    inactivityService,
    newsService,
    mockWeatherService,
    mockAiService,
    jobExecutionRepo,
    adapter,
    'America/Argentina/Cordoba'
  );

  await t.test('1. At 00:00 resets summaries and records idempotent execution', async () => {
    summaryRepo.saveCheckpoint({
      groupJid: targetGroupJid,
      cycleDate: '2026-09-11',
      accumulatedSummary: 'Resumen viejo',
      lastMessageId: 'm1',
      lastMessageTimestamp: 1000,
      updatedAt: 1000
    });
    assert.ok(summaryRepo.getCheckpoint(targetGroupJid));

    // Simular fecha 00:00 en Córdoba (2026-09-12T00:00:00 en Córdoba es UTC 03:00)
    const midnightCordoba = new Date('2026-09-12T03:00:00.000Z');

    await scheduler.tick(midnightCordoba);

    const cp = summaryRepo.getCheckpoint(targetGroupJid);
    assert.strictEqual(cp?.accumulatedSummary, null);
    assert.strictEqual(jobExecutionRepo.isJobExecuted('daily_reset:2026-09-12'), true);

    await scheduler.tick(midnightCordoba);
  });

  await t.test('2. At 08:00 dispatches daily morning message and separate news messages with idempotency', async () => {
    sentMessages.length = 0;

    // Simular fecha 08:00 en Córdoba (UTC 11:00)
    const morningCordoba = new Date('2026-09-12T11:00:00.000Z');

    await scheduler.tick(morningCordoba);

    // Debe enviar el saludo (mensaje 1) y la noticia (mensaje 2)
    assert.strictEqual(sentMessages.length, 2);
    assert.strictEqual(sentMessages[0].groupJid, targetGroupJid);
    assert.match(sentMessages[0].text, /¡Buen día/);
    assert.match(sentMessages[0].text, /Hoy es/);
    assert.match(sentMessages[0].text, /Clima en Argentina/);
    assert.match(sentMessages[0].text, /Les dejo algunas noticias =\)/);

    // Mensaje 2: Noticia individual
    assert.match(sentMessages[1].text, /📰 \*Noticia Tech 1\*/);
    assert.match(sentMessages[1].text, /Resumen de la noticia de prueba/);
    assert.match(sentMessages[1].text, /https:\/\/test\.com\/news-1/);

    // Verificar idempotencia: una segunda ejecución a las 09:00 no vuelve a enviar
    await scheduler.tick(morningCordoba);
    assert.strictEqual(sentMessages.length, 2);
  });

  await t.test('3. At 12:00 sends advance birthday notice if tomorrow is someone birthday', async () => {
    sentMessages.length = 0;

    // Simular fecha 12:00 en Córdoba (UTC 15:00)
    const noonCordoba = new Date('2026-09-12T15:00:00.000Z');
    // Mañana en Córdoba es 13/09
    birthdayRepo.save('celebrant@s.whatsapp.net', 13, 9);

    await scheduler.tick(noonCordoba);

    assert.strictEqual(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /Aviso de cumpleaños/i);
    assert.match(sentMessages[0].text, /@celebrant/);

    // Verificar idempotencia del aviso
    await scheduler.tick(noonCordoba);
    assert.strictEqual(sentMessages.length, 1);
  });

  db.close();
});
