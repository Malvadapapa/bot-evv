import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, StatisticsRepository } from '../../src/database/index.js';
import { InactivityService } from '../../src/services/inactivity.service.js';
import { AIService } from '../../src/services/ai.service.js';

test('InactivityService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const msgRepo = new MessageRepository(db);
  const statsRepo = new StatisticsRepository(db);

  const mockAiService = {
    generateInactivityNudge: async (context: string, targetMention?: string) => {
      return targetMention
        ? `Che ${targetMention}, ¿qué opinás de lo que venían hablando? (${context})`
        : `Che grupo, ¿todo tranquilo?`;
    },
    generateGhostMemberCallout: async (userPhone: string, userName: string, daysInactive: number) => {
      return `🚨 *BÚSQUEDA DE PARADERO:* ¿Alguien vio a @${userPhone} (${userName})? Lleva ${daysInactive} días ausente.`;
    }
  } as unknown as AIService;

  const thresholdMs = 1000; // 1 segundo para tests
  const cooldownMs = 3000;  // 3 segundos para tests
  const botCleanJid = 'bot@s.whatsapp.net';
  const groupJid = 'group-inactivity@g.us';

  const service = new InactivityService(
    msgRepo,
    statsRepo,
    mockAiService,
    {
      thresholdMs,
      cooldownMs,
      mentionTopActive: true,
      timezone: 'America/Argentina/Cordoba',
      inactiveDaysThreshold: 7,
      maxGhostAlertsPerDay: 4,
      ghostAlertCooldownMs: 2000
    }
  );

  const activeTime = new Date('2026-09-22T14:00:00-03:00'); // 14:00 hs (activo)
  const quietTime = new Date('2026-09-22T03:00:00-03:00');  // 03:00 hs (madrugada / descanso)
  const bufferTime = new Date('2026-09-22T09:30:00-03:00'); // 09:30 hs (buffer post-briefing de 08:00)

  await t.test('Returns null if there are no messages in the group', async () => {
    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid, activeTime);
    assert.strictEqual(res, null);
  });

  await t.test('Quiet hours (00:00 - 08:00): returns null even if silent', async () => {
    const nowMs = quietTime.getTime();
    msgRepo.save({
      id: 'm-night',
      groupJid,
      senderJid: 'user1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Buenas noches a todos',
      timestamp: nowMs - 5000
    });

    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid, quietTime);
    assert.strictEqual(res, null);
  });

  await t.test('Post-briefing buffer (before 10:30): returns null', async () => {
    const nowMs = bufferTime.getTime();
    msgRepo.save({
      id: 'm-buffer',
      groupJid,
      senderJid: 'user1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Buen día grupo',
      timestamp: nowMs - 5000
    });

    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid, bufferTime);
    assert.strictEqual(res, null);
  });

  await t.test('Returns null if silence is below threshold', async () => {
    const nowMs = activeTime.getTime();
    msgRepo.save({
      id: 'm1',
      groupJid,
      senderJid: 'user1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Hola recién llego',
      timestamp: nowMs - 200 // Solo 200ms < 1000ms
    });

    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid, activeTime);
    assert.strictEqual(res, null);
  });

  await t.test('Triggers nudge when silence exceeds threshold in active hours', async () => {
    const oldGroupJid = 'group-old@g.us';
    const oldTime = activeTime.getTime() - 2000; // 2s atrás (> 1s threshold)
    msgRepo.save({
      id: 'm-old',
      groupJid: oldGroupJid,
      senderJid: '5491111111111@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Tema reciente sobre código',
      timestamp: oldTime
    });

    statsRepo.recordMessage(oldGroupJid, '5491111111111@s.whatsapp.net', 'Alice', oldTime);
    statsRepo.recordMessage(oldGroupJid, '5492222222222@s.whatsapp.net', 'Bob', oldTime);

    const nudge = await service.evaluateInactivityNudge(oldGroupJid, botCleanJid, activeTime);
    assert.ok(nudge);
    assert.strictEqual(nudge.type, 'general_nudge');
    assert.match(nudge.text, /¿qué opinás de lo que venían hablando\?/);
    assert.ok(nudge.mentionedJid);
    assert.ok(
      nudge.mentionedJid === '5491111111111@s.whatsapp.net' || nudge.mentionedJid === '5492222222222@s.whatsapp.net'
    );

    // Inmediatamente después del nudge anterior, debe retornar null por cooldown
    const nudgeImmediate = await service.evaluateInactivityNudge(oldGroupJid, botCleanJid, activeTime);
    assert.strictEqual(nudgeImmediate, null);
  });

  await t.test('Ghost member alert: detects members > 7 days inactive with real WhatsApp mention', async () => {
    const ghostGroupJid = 'group-ghost@g.us';
    const nowMs = activeTime.getTime();
    const eightDaysAgo = nowMs - 8 * 24 * 60 * 60 * 1000;
    const ghostUserJid = '5493517778888@s.whatsapp.net';

    // Guardar mensaje de hace 8 días para el usuario ausente
    msgRepo.save({
      id: 'm-ghost-old',
      groupJid: ghostGroupJid,
      senderJid: ghostUserJid,
      senderName: 'Fantasma',
      content: 'Me voy de viaje gente chau',
      timestamp: eightDaysAgo
    });
    statsRepo.recordMessage(ghostGroupJid, ghostUserJid, 'Fantasma', eightDaysAgo);

    // Guardar mensaje de hace 2 horas para otro usuario para que el grupo tenga silencio > 1s
    const twoHoursAgo = nowMs - 2 * 60 * 60 * 1000;
    msgRepo.save({
      id: 'm-active-user',
      groupJid: ghostGroupJid,
      senderJid: '5491111111111@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Alguien por acá?',
      timestamp: twoHoursAgo
    });
    statsRepo.recordMessage(ghostGroupJid, '5491111111111@s.whatsapp.net', 'Alice', twoHoursAgo);

    const alert = await service.evaluateInactivityNudge(ghostGroupJid, botCleanJid, activeTime);
    assert.ok(alert);
    assert.strictEqual(alert.type, 'ghost_alert');
    assert.strictEqual(alert.mentionedJid, ghostUserJid);
    assert.match(alert.text, /BÚSQUEDA DE PARADERO/);
    assert.match(alert.text, /@5493517778888/);
  });

  db.close();
});
