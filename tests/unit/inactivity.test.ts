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
    generateInactivityNudge: async (context: string, targetUser?: string) => {
      return targetUser
        ? `Che @${targetUser}, ¿qué opinás de lo que venían hablando? (${context})`
        : `Che grupo, ¿todo tranquilo?`;
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
      mentionTopActive: true
    }
  );

  await t.test('Returns null if there are no messages in the group', async () => {
    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid);
    assert.strictEqual(res, null);
  });

  await t.test('Returns null if silence is below threshold', async () => {
    const now = Date.now();
    msgRepo.save({
      id: 'm1',
      groupJid,
      senderJid: 'user1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Hola recién llego',
      timestamp: now
    });

    const res = await service.evaluateInactivityNudge(groupJid, botCleanJid);
    assert.strictEqual(res, null);
  });

  await t.test('Triggers nudge when silence exceeds threshold', async () => {
    const oldGroupJid = 'group-old@g.us';
    const oldTime = Date.now() - 2000; // 2s atrás (> 1s threshold)
    msgRepo.save({
      id: 'm-old',
      groupJid: oldGroupJid,
      senderJid: 'user1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Tema viejo sobre código',
      timestamp: oldTime
    });

    statsRepo.recordMessage(oldGroupJid, 'user1@s.whatsapp.net', 'Alice', oldTime);
    statsRepo.recordMessage(oldGroupJid, 'user2@s.whatsapp.net', 'Bob', oldTime);

    const nudge = await service.evaluateInactivityNudge(oldGroupJid, botCleanJid);
    assert.ok(nudge);
    assert.match(nudge.text, /¿qué opinás de lo que venían hablando\?/);
    assert.ok(nudge.mentionedJid);
    assert.ok(
      nudge.mentionedJid === 'user1@s.whatsapp.net' || nudge.mentionedJid === 'user2@s.whatsapp.net'
    );

    // Inmediatamente después del nudge anterior, debe retornar null por cooldown
    const nudgeImmediate = await service.evaluateInactivityNudge(oldGroupJid, botCleanJid);
    assert.strictEqual(nudgeImmediate, null);
  });

  db.close();
});
