import test from 'node:test';
import assert from 'node:assert';
import {
  Database,
  MessageRepository,
  MentionRepository,
  SummaryRepository,
  BirthdayRepository,
  StatisticsRepository,
  JobExecutionRepository,
  NewsRepository
} from '../../src/database/index.js';

test('Database & Repositories Unit Tests', async (t) => {
  const db = Database.createInMemory();

  await t.test('MessageRepository stores and queries messages and context', () => {
    const repo = new MessageRepository(db);
    const now = 1000000;

    repo.save({
      id: 'msg-1',
      groupJid: 'group-1@g.us',
      senderJid: 'user-1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Hola mundo 1',
      timestamp: now
    });

    repo.save({
      id: 'msg-2',
      groupJid: 'group-1@g.us',
      senderJid: 'user-2@s.whatsapp.net',
      senderName: 'Bob',
      content: 'Hola mundo 2',
      timestamp: now + 1000
    });

    repo.save({
      id: 'msg-3',
      groupJid: 'group-1@g.us',
      senderJid: 'user-1@s.whatsapp.net',
      senderName: 'Alice',
      content: 'Hola mundo 3',
      timestamp: now + 2000
    });

    const messages = repo.getMessagesSince('group-1@g.us', now);
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].id, 'msg-2');
    assert.strictEqual(messages[1].id, 'msg-3');

    const ctx = repo.getContextAround('group-1@g.us', now + 1000, 1, 1);
    assert.strictEqual(ctx.before.length, 1);
    assert.strictEqual(ctx.before[0].id, 'msg-1');
    assert.strictEqual(ctx.after.length, 1);
    assert.strictEqual(ctx.after[0].id, 'msg-3');
  });

  await t.test('MentionRepository tracks mentions and isolates user view', () => {
    const repo = new MentionRepository(db);
    const now = Date.now();

    repo.save({
      id: 'm-1',
      groupJid: 'group-1@g.us',
      messageId: 'msg-1',
      mentionedUserJid: 'pedro@s.whatsapp.net',
      mentionedByUserJid: 'juan@s.whatsapp.net',
      mentionedByName: 'Juan',
      messageContent: '@Pedro revisar servidor',
      timestamp: now
    });

    repo.save({
      id: 'm-2',
      groupJid: 'group-1@g.us',
      messageId: 'msg-2',
      mentionedUserJid: 'maria@s.whatsapp.net',
      mentionedByUserJid: 'juan@s.whatsapp.net',
      mentionedByName: 'Juan',
      messageContent: '@Maria viste esto?',
      timestamp: now + 500
    });

    // Pedro solo ve sus menciones
    const pedroMentions = repo.getUserMentions('pedro@s.whatsapp.net', 1, 5);
    assert.strictEqual(pedroMentions.total, 1);
    assert.strictEqual(pedroMentions.mentions[0].mentionedUserJid, 'pedro@s.whatsapp.net');

    // Maria solo ve las suyas
    const mariaMentions = repo.getUserMentions('maria@s.whatsapp.net', 1, 5);
    assert.strictEqual(mariaMentions.total, 1);
    assert.strictEqual(mariaMentions.mentions[0].mentionedUserJid, 'maria@s.whatsapp.net');

    // Carlos no tiene menciones
    const carlosMentions = repo.getUserMentions('carlos@s.whatsapp.net', 1, 5);
    assert.strictEqual(carlosMentions.total, 0);
  });

  await t.test('SummaryRepository handles daily checkpoints and resets', () => {
    const repo = new SummaryRepository(db);

    repo.saveCheckpoint({
      groupJid: 'group-1@g.us',
      cycleDate: '2026-09-12',
      accumulatedSummary: 'Resumen inicial',
      lastMessageId: 'msg-100',
      lastMessageTimestamp: 5000,
      updatedAt: Date.now()
    });

    const cp = repo.getCheckpoint('group-1@g.us');
    assert.ok(cp);
    assert.strictEqual(cp.cycleDate, '2026-09-12');
    assert.strictEqual(cp.accumulatedSummary, 'Resumen inicial');
    assert.strictEqual(cp.lastMessageTimestamp, 5000);

    // Reset para nuevo día
    repo.resetCheckpoint('group-1@g.us', '2026-09-13');
    const resetCp = repo.getCheckpoint('group-1@g.us');
    assert.ok(resetCp);
    assert.strictEqual(resetCp.cycleDate, '2026-09-13');
    assert.strictEqual(resetCp.accumulatedSummary, null);
    assert.strictEqual(resetCp.lastMessageTimestamp, 0);
  });

  await t.test('BirthdayRepository registers and queries dates correctly', () => {
    const repo = new BirthdayRepository(db);

    repo.save('juan@s.whatsapp.net', 15, 9);
    repo.save('maria@s.whatsapp.net', 15, 9);
    repo.save('pedro@s.whatsapp.net', 20, 10);

    const bday = repo.get('juan@s.whatsapp.net');
    assert.ok(bday);
    assert.strictEqual(bday.day, 15);
    assert.strictEqual(bday.month, 9);

    const list15Sept = repo.getByDate(15, 9);
    assert.strictEqual(list15Sept.length, 2);

    const listEmpty = repo.getByDate(1, 1);
    assert.strictEqual(listEmpty.length, 0);
  });

  await t.test('StatisticsRepository increments activity and returns Top 10', () => {
    const repo = new StatisticsRepository(db);
    const now = Date.now();

    repo.recordMessage('group-1@g.us', 'user-1@s.whatsapp.net', 'User 1', now);
    repo.recordMessage('group-1@g.us', 'user-1@s.whatsapp.net', 'User 1', now + 1);
    repo.recordMessage('group-1@g.us', 'user-2@s.whatsapp.net', 'User 2', now + 2);

    const top = repo.getTopActiveUsers('group-1@g.us', 10);
    assert.strictEqual(top.length, 2);
    assert.strictEqual(top[0].userJid, 'user-1@s.whatsapp.net');
    assert.strictEqual(top[0].messageCount, 2);
    assert.strictEqual(top[1].userJid, 'user-2@s.whatsapp.net');
    assert.strictEqual(top[1].messageCount, 1);
  });

  await t.test('JobExecutionRepository guarantees idempotency', () => {
    const repo = new JobExecutionRepository(db);
    const jobKey = 'daily_greeting:group-1@g.us:2026-09-12';

    assert.strictEqual(repo.isJobExecuted(jobKey), false);
    repo.recordJobExecution(jobKey, 'group-1@g.us');
    assert.strictEqual(repo.isJobExecuted(jobKey), true);
  });

  db.close();
});
