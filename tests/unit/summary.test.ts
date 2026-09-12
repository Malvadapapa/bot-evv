import test from 'node:test';
import assert from 'node:assert';
import { Database, MessageRepository, SummaryRepository } from '../../src/database/index.js';
import { SummaryService } from '../../src/services/summary.service.js';
import { AIService } from '../../src/services/ai.service.js';

test('SummaryService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const summaryRepo = new SummaryRepository(db);
  const messageRepo = new MessageRepository(db);

  await t.test('Requires API key when no external provider is configured', async () => {
    // AIService sin externalProvider
    const aiService = new AIService({});
    const service = new SummaryService(summaryRepo, messageRepo, aiService);

    // Guardar un mensaje
    messageRepo.save({
      id: 'msg-err-1',
      groupJid: 'group-err@g.us',
      senderJid: 'user-1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Discutiendo el backend',
      timestamp: 1000
    });

    await assert.rejects(
      async () => {
        await service.getOrGenerateSummary('group-err@g.us');
      },
      (err: any) => {
        assert.match(err.message, /requiere configurar una API Key externa/i);
        return true;
      }
    );
  });

  await t.test('Generates summary and updates checkpoint incrementally', async () => {
    // Mock external provider
    const mockAiService = {
      generateIncrementalSummary: async (prev: string | null, msgs: any[]) => {
        return prev ? `${prev} + Resumen de ${msgs.length} mensajes` : `Resumen de ${msgs.length} mensajes`;
      }
    } as unknown as AIService;

    const service = new SummaryService(summaryRepo, messageRepo, mockAiService);

    // 1. Mensajes 1 a 3
    messageRepo.save({
      id: 'm-1',
      groupJid: 'group-1@g.us',
      senderJid: 'u-1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Tema 1',
      timestamp: 1000
    });
    messageRepo.save({
      id: 'm-2',
      groupJid: 'group-1@g.us',
      senderJid: 'u-2@s.whatsapp.net',
      senderName: 'Bob',
      content: 'Tema 2',
      timestamp: 2000
    });

    const firstSummary = await service.getOrGenerateSummary('group-1@g.us');
    assert.match(firstSummary, /Resumen de 2 mensajes/);

    const cp1 = summaryRepo.getCheckpoint('group-1@g.us');
    assert.strictEqual(cp1?.lastMessageId, 'm-2');
    assert.strictEqual(cp1?.lastMessageTimestamp, 2000);

    // 2. Consulta inmediata sin nuevos mensajes
    const secondCall = await service.getOrGenerateSummary('group-1@g.us');
    assert.match(secondCall, /No hay mensajes nuevos desde el último checkpoint/);

    // 3. Nuevos mensajes 3
    messageRepo.save({
      id: 'm-3',
      groupJid: 'group-1@g.us',
      senderJid: 'u-1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Tema 3',
      timestamp: 3000
    });

    const thirdSummary = await service.getOrGenerateSummary('group-1@g.us');
    assert.match(thirdSummary, /Resumen de 2 mensajes \+ Resumen de 1 mensajes/);

    const cp2 = summaryRepo.getCheckpoint('group-1@g.us');
    assert.strictEqual(cp2?.lastMessageId, 'm-3');
    assert.strictEqual(cp2?.lastMessageTimestamp, 3000);
  });

  db.close();
});
