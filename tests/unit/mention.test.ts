import test from 'node:test';
import assert from 'node:assert';
import { Database, MentionRepository, MessageRepository } from '../../src/database/index.js';
import { MentionService } from '../../src/services/mention.service.js';
import { ContextMarkerService } from '../../src/services/context-marker.service.js';

test('MentionService & ContextMarkerService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const mentionRepo = new MentionRepository(db);
  const messageRepo = new MessageRepository(db);
  const mentionService = new MentionService(mentionRepo);
  const markerService = new ContextMarkerService(mentionRepo, messageRepo);

  await t.test('Records mentions and ignores self-mentions', () => {
    mentionService.recordMentions(
      'group-1@g.us',
      'msg-1',
      'juan@s.whatsapp.net',
      'Juan',
      '@Pedro y @Juan vamos a la reunión',
      ['pedro@s.whatsapp.net', 'juan@s.whatsapp.net'],
      1000
    );

    // Pedro fue mencionado por Juan
    const pedroMentions = mentionRepo.getUserMentions('pedro@s.whatsapp.net');
    assert.strictEqual(pedroMentions.total, 1);
    assert.strictEqual(pedroMentions.mentions[0].mentionedByName, 'Juan');

    // Juan se mencionó a sí mismo -> fue ignorado
    const juanMentions = mentionRepo.getUserMentions('juan@s.whatsapp.net');
    assert.strictEqual(juanMentions.total, 0);
  });

  await t.test('getUserMentionsFormatted provides pagination and isolated output', () => {
    // Agregar 6 menciones para Pedro
    for (let i = 1; i <= 6; i++) {
      mentionService.recordMentions(
        'group-1@g.us',
        `msg-p-${i}`,
        'maria@s.whatsapp.net',
        'Maria',
        `@Pedro mensaje ${i}`,
        ['pedro@s.whatsapp.net'],
        2000 + i * 100
      );
    }

    const page1 = mentionService.getUserMentionsFormatted('pedro@s.whatsapp.net', 1, 5);
    assert.match(page1, /Página 1\/2/);
    assert.match(page1, /Total: 7/); // 1 anterior + 6 nuevas = 7

    const page2 = mentionService.getUserMentionsFormatted('pedro@s.whatsapp.net', 2, 5);
    assert.match(page2, /Página 2\/2/);

    const emptyUser = mentionService.getUserMentionsFormatted('carlos@s.whatsapp.net', 1, 5);
    assert.match(emptyUser, /No tienes menciones registradas/);
  });

  await t.test('ContextMarkerService (/marcar) reconstructs conversation context', () => {
    const groupJid = 'group-1@g.us';
    const baseTime = 10000;

    // Mensajes antes
    messageRepo.save({ id: 'm-before-1', groupJid, senderJid: 'u1', senderName: 'Alice', content: '¿Vieron el PR?', timestamp: baseTime - 2000 });
    messageRepo.save({ id: 'm-before-2', groupJid, senderJid: 'u2', senderName: 'Bob', content: 'Sí, tiene conflictos', timestamp: baseTime - 1000 });

    // Mensaje de mención
    messageRepo.save({ id: 'm-target', groupJid, senderJid: 'u3', senderName: 'Charlie', content: '@David vos podés arreglarlo?', timestamp: baseTime });
    mentionService.recordMentions(groupJid, 'm-target', 'u3', 'Charlie', '@David vos podés arreglarlo?', ['david@s.whatsapp.net'], baseTime);

    // Mensajes después
    messageRepo.save({ id: 'm-after-1', groupJid, senderJid: 'u1', senderName: 'Alice', content: 'Avisanos cuando puedas', timestamp: baseTime + 1000 });

    const marker = markerService.getContextForUser(groupJid, 'david@s.whatsapp.net', 2, 2);
    assert.ok(marker);
    assert.strictEqual(marker.quotedMessageId, 'm-target');
    assert.match(marker.text, /Contexto de tu última mención/);
    assert.match(marker.text, /¿Vieron el PR\?/);
    assert.match(marker.text, /Avisanos cuando puedas/);
  });

  db.close();
});
