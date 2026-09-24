import test from 'node:test';
import assert from 'node:assert';
import { Database, BirthdayRepository, JobExecutionRepository } from '../../src/database/index.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { AIService } from '../../src/services/ai.service.js';

test('BirthdayService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const birthdayRepo = new BirthdayRepository(db);
  const jobExecutionRepo = new JobExecutionRepository(db);
  const mockAiService = {
    generateBirthdayGreeting: async (user: string) => `¡Feliz cumple @${user}! 🎉`
  } as unknown as AIService;

  const service = new BirthdayService(birthdayRepo, jobExecutionRepo, mockAiService);

  await t.test('Validates and parses DD/MM dates strictly', () => {
    assert.deepStrictEqual(service.parseBirthday('15/05'), { day: 15, month: 5 });
    assert.deepStrictEqual(service.parseBirthday('1/1'), { day: 1, month: 1 });
    assert.deepStrictEqual(service.parseBirthday('31-12'), { day: 31, month: 12 });

    // Fechas inválidas
    assert.strictEqual(service.parseBirthday('32/01'), null);
    assert.strictEqual(service.parseBirthday('15/13'), null);
    assert.strictEqual(service.parseBirthday('31/04'), null); // Abril tiene 30 días
    assert.strictEqual(service.parseBirthday('hola'), null);
    assert.strictEqual(service.parseBirthday('15-05-1990'), null);
  });

  await t.test('Registers and retrieves birthday dates with gender preference', () => {
    service.registerBirthday('juan@s.whatsapp.net', 15, 5, 'male');
    const saved = service.getBirthday('juan@s.whatsapp.net');
    assert.ok(saved);
    assert.strictEqual(saved.day, 15);
    assert.strictEqual(saved.month, 5);
    assert.strictEqual(saved.gender, 'male');

    // Actualizar pronombre
    service.updateGender('juan@s.whatsapp.net', 'female');
    const updated = service.getBirthday('juan@s.whatsapp.net');
    assert.strictEqual(updated?.gender, 'female');
  });

  await t.test('Job executions are strictly idempotent', async () => {
    const groupJid = 'group-1@g.us';
    // Registrar un cumpleañero para hoy
    const { getCordobaDayAndMonth } = await import('../../src/utils/date.js');
    const { day, month } = getCordobaDayAndMonth();
    service.registerBirthday('cumpleanero@s.whatsapp.net', day, month);

    // Primera ejecución genera mensaje
    const msg1 = await service.getTodayCelebrationMessage(groupJid);
    assert.ok(msg1);
    assert.match(msg1.text, /¡Feliz cumple @cumpleanero!/);
    assert.deepStrictEqual(msg1.mentions, ['cumpleanero@s.whatsapp.net']);

    // Segunda ejecución inmediata retorna null (idempotente)
    const msg2 = await service.getTodayCelebrationMessage(groupJid);
    assert.strictEqual(msg2, null);
  });

  await t.test('Tomorrow advance notification resolves LID to real name and returns mentions', async () => {
    const groupJid = 'group-2@g.us';
    const { getTomorrowCordobaDayAndMonth } = await import('../../src/utils/date.js');
    const tomorrow = getTomorrowCordobaDayAndMonth();
    service.registerBirthday('242425150869604@lid', tomorrow.day, tomorrow.month, 'female', 'Natalia');

    const notice = service.getTomorrowAdvanceNotification(groupJid);
    assert.ok(notice);
    assert.match(notice.text, /Aviso de cumpleaños/);
    assert.match(notice.text, /\*Natalia\* \(@242425150869604\)/);
    assert.deepStrictEqual(notice.mentions, ['242425150869604@lid']);
  });

  db.close();
});
