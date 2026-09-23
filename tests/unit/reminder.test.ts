import test from 'node:test';
import assert from 'node:assert';
import { Database } from '../../src/database/db.js';
import { ReminderRepository } from '../../src/database/repositories/reminder.repository.js';
import { ReminderService } from '../../src/services/reminder.service.js';
import { BirthdayService } from '../../src/services/birthday.service.js';
import { BirthdayRepository } from '../../src/database/repositories/birthday.repository.js';
import { JobExecutionRepository } from '../../src/database/repositories/job-execution.repository.js';
import { AIService } from '../../src/services/ai.service.js';

test('Reminder and Registration Feature Tests', async (t) => {
  await t.test('1. ReminderService: parses relative and absolute times accurately', () => {
    const db = Database.createInMemory();
    const repo = new ReminderRepository(db);
    const service = new ReminderService(repo);

    // Relativo: "en 30m"
    const parsedRel = service.parseReminderRequest(
      'Mequetrefe avisá en 30m que saquen las pizzas',
      'user1@s.whatsapp.net',
      'Leandro'
    );
    assert.strictEqual(parsedRel.isReminder, true);
    assert.strictEqual(parsedRel.message, 'saquen las pizzas');
    assert.match(parsedRel.timeLabel || '', /en 30 minutos/);
    assert.ok(parsedRel.targetTimestamp && parsedRel.targetTimestamp > Date.now());

    // Absoluto con tercero: "recordale a @cristian mañana a las 9am que se lave la cara"
    const cristianJid = '5493512345678@s.whatsapp.net';
    const parsedTarget = service.parseReminderRequest(
      'recordale a @cristian mañana a las 9am que se lave la cara',
      'user1@s.whatsapp.net',
      'Leandro',
      [cristianJid]
    );
    assert.strictEqual(parsedTarget.isReminder, true);
    assert.strictEqual(parsedTarget.targetJid, cristianJid);
    assert.strictEqual(parsedTarget.message, 'se lave la cara');
    assert.match(parsedTarget.timeLabel || '', /mañana a las 9:00 hs/);

    // Grupo completo: "avisá a todos a las 20hs reunión"
    const parsedGroup = service.parseReminderRequest(
      'avisá a todos a las 20:00 reunión de equipo',
      'user1@s.whatsapp.net',
      'Leandro'
    );
    assert.strictEqual(parsedGroup.isReminder, true);
    assert.strictEqual(parsedGroup.isGroupBroadcast, true);
    assert.strictEqual(parsedGroup.message, 'reunión de equipo');

    db.close();
  });

  await t.test('2. Reminder Limits: Normal users limited to 2, admin unlimited', () => {
    const db = Database.createInMemory();
    const repo = new ReminderRepository(db);
    const service = new ReminderService(repo);

    const normalUser = 'normal@s.whatsapp.net';
    const adminUser = 'admin@s.whatsapp.net';
    const groupJid = 'group@g.us';
    const futureTime = Date.now() + 3600000;

    // Normal user 1st reminder
    const r1 = service.createReminder({
      groupJid,
      createdByJid: normalUser,
      createdByName: 'Normal',
      message: 'Primer aviso',
      targetTimestamp: futureTime,
      timeLabel: 'en 1 hora',
      isAdmin: false
    });
    assert.strictEqual(r1.success, true);

    // Normal user 2nd reminder
    const r2 = service.createReminder({
      groupJid,
      createdByJid: normalUser,
      createdByName: 'Normal',
      message: 'Segundo aviso',
      targetTimestamp: futureTime + 1000,
      timeLabel: 'en 1 hora',
      isAdmin: false
    });
    assert.strictEqual(r2.success, true);

    // Normal user 3rd reminder (must fail limit)
    const r3 = service.createReminder({
      groupJid,
      createdByJid: normalUser,
      createdByName: 'Normal',
      message: 'Tercer aviso',
      targetTimestamp: futureTime + 2000,
      timeLabel: 'en 1 hora',
      isAdmin: false
    });
    assert.strictEqual(r3.success, false);
    assert.match(r3.error || '', /Ya tenés 2 recordatorios pendientes/);

    // Admin user can create 3 or more reminders
    for (let i = 1; i <= 4; i++) {
      const adminR = service.createReminder({
        groupJid,
        createdByJid: adminUser,
        createdByName: 'Admin',
        message: `Aviso admin ${i}`,
        targetTimestamp: futureTime + i * 1000,
        timeLabel: 'en 1 hora',
        isAdmin: true
      });
      assert.strictEqual(adminR.success, true);
    }

    db.close();
  });

  await t.test('3. Natural Templates: Confirmation, third-party delivery, group delivery, self delivery', () => {
    const db = Database.createInMemory();
    const repo = new ReminderRepository(db);
    const service = new ReminderService(repo);

    const reminder = {
      id: 'rec_test',
      groupJid: 'group@g.us',
      createdByJid: '5493510001@s.whatsapp.net',
      createdByName: 'Leandro',
      targetJid: '5493510002@s.whatsapp.net',
      targetName: 'Cristian',
      message: 'lavate la cara',
      targetTimestamp: Date.now() + 3600000,
      status: 'pending' as const,
      createdAt: Date.now()
    };

    // Confirmación para tercero (debe mostrar el nombre de la persona, no JID crudo)
    const confirm = service.formatConfirmationMessage(reminder, 'mañana a las 9:00 hs');
    assert.match(confirm, /Agendado para mañana a las 9:00 hs|anotado para mañana a las 9:00 hs|guardo para mañana a las 9:00 hs|agendé para mañana a las 9:00 hs/i);
    assert.match(confirm, /Para: @Cristian/);
    assert.match(confirm, /lavate la cara/);

    // Confirmación personal (auto-recordatorio no debe incluir línea "Para:")
    const selfReminder = { ...reminder, targetJid: null, targetName: 'Leandro' };
    const selfConfirm = service.formatConfirmationMessage(selfReminder, 'en 15 segundos');
    assert.strictEqual(selfConfirm.includes('Para:'), false);

    // Entrega a tercero (menciona al destinatario y remitente)
    const deliveryTarget = service.formatDeliveryMessage(reminder);
    assert.match(deliveryTarget.text, /@5493510002/);
    assert.match(deliveryTarget.text, /@5493510001/);
    assert.match(deliveryTarget.text, /"lavate la cara" 🔔/);
    assert.ok(deliveryTarget.mentions.includes('5493510002@s.whatsapp.net'));
    assert.ok(deliveryTarget.mentions.includes('5493510001@s.whatsapp.net'));

    // Entrega al grupo
    const groupReminder = { ...reminder, targetJid: '@all' };
    const deliveryGroup = service.formatDeliveryMessage(groupReminder);
    assert.match(deliveryGroup.text, /@5493510001/);
    assert.match(deliveryGroup.text, /"lavate la cara" 📢/);

    // Entrega auto-recordatorio
    const deliverySelf = service.formatDeliveryMessage(selfReminder);
    assert.match(deliverySelf.text, /@5493510001/);
    assert.match(deliverySelf.text, /"lavate la cara" 🔔/);
    assert.ok(deliverySelf.mentions.includes('5493510001@s.whatsapp.net'));

    db.close();
  });

  await t.test('3b. Bot mention filtering & Natural Modal Triggers', () => {
    const db = Database.createInMemory();
    const repo = new ReminderRepository(db);
    const botLid = '143839226503193@lid';
    const service = new ReminderService(repo, 'America/Argentina/Cordoba', undefined, undefined, [botLid]);

    // Caso 1: "@Mequetrefe podes recordarme dentro de 15 segundos que soy pro?"
    // El bot viene en mentionedJids por la mención inicial -> Debe ser auto-recordatorio
    const p1 = service.parseReminderRequest(
      '@Mequetrefe podes recordarme dentro de 15 segundos que soy pro?',
      '5493519999@s.whatsapp.net',
      'Cristian',
      [botLid]
    );
    assert.strictEqual(p1.isReminder, true);
    assert.strictEqual(p1.targetJid, null);
    assert.strictEqual(p1.targetName, 'Cristian');
    assert.strictEqual(p1.message, 'soy pro');
    assert.strictEqual(p1.timeLabel, 'en 15 segundos');

    // Caso 2: "@Mequetrefe recorda a @Nattalia Coder en 1m que se duerma"
    // mentionedJids contiene al bot Y a Natalia -> El bot debe descartarse y Natalia ser el target
    const nataliaLid = '144075193655382@lid';
    const p2 = service.parseReminderRequest(
      '@Mequetrefe recorda a @Nattalia Coder en 1m que se duerma',
      '5493519999@s.whatsapp.net',
      'Cristian',
      [botLid, nataliaLid]
    );
    assert.strictEqual(p2.isReminder, true);
    assert.strictEqual(p2.targetJid, nataliaLid);
    assert.strictEqual(p2.targetName, 'Nattalia Coder');
    assert.strictEqual(p2.message, 'se duerma');
    assert.strictEqual(p2.timeLabel, 'en 1 minuto');

    // Caso 3: Comando explícito sin prefijo de barra en args
    // "/recordar en 15 segundos que soy pro" -> args: "en 15 segundos que soy pro", isExplicitCommand: true
    const p3 = service.parseReminderRequest(
      'en 15 segundos que soy pro',
      '5493519999@s.whatsapp.net',
      'Cristian',
      [],
      true
    );
    assert.strictEqual(p3.isReminder, true);
    assert.strictEqual(p3.message, 'soy pro');
    assert.strictEqual(p3.timeLabel, 'en 15 segundos');

    // Caso 4: "/recordar a las 05:02 recordame que soy pro"
    const p4 = service.parseReminderRequest(
      'a las 05:02 recordame que soy pro',
      '5493519999@s.whatsapp.net',
      'Cristian',
      [],
      true
    );
    assert.strictEqual(p4.isReminder, true);
    assert.strictEqual(p4.message, 'soy pro');
    assert.match(p4.timeLabel || '', /a las 5:02 hs/);

    db.close();
  });

  await t.test('4. Cancellation permissions: User can only cancel own, admin can cancel any', () => {
    const db = Database.createInMemory();
    const repo = new ReminderRepository(db);
    const service = new ReminderService(repo);

    const user1 = 'user1@s.whatsapp.net';
    const user2 = 'user2@s.whatsapp.net';
    const admin = 'admin@s.whatsapp.net';

    const r = service.createReminder({
      groupJid: 'group@g.us',
      createdByJid: user1,
      createdByName: 'User 1',
      message: 'Prueba',
      targetTimestamp: Date.now() + 60000,
      timeLabel: 'en 1m',
      isAdmin: false
    });
    assert.ok(r.reminder);
    const id = r.reminder.id;

    // User 2 tries to cancel User 1's reminder -> Fails
    const cancelByOther = service.cancelReminder(id, user2, false);
    assert.strictEqual(cancelByOther.success, false);

    // Admin cancels User 1's reminder -> Succeeds
    const cancelByAdmin = service.cancelReminder(id, admin, true);
    assert.strictEqual(cancelByAdmin.success, true);
    assert.match(cancelByAdmin.message, /cancelado con éxito/);

    db.close();
  });

  await t.test('5. parseRegistrationInput: Handles brackets and pronoun in single line', () => {
    const db = Database.createInMemory();
    const bRepo = new BirthdayRepository(db);
    const jRepo = new JobExecutionRepository(db);
    const ai = {} as unknown as AIService;
    const service = new BirthdayService(bRepo, jRepo, ai);

    // Caso con corchetes en ambos: "[27/06] [el]"
    const p1 = service.parseRegistrationInput('[27/06] [el]');
    assert.strictEqual(p1.valid, true);
    assert.strictEqual(p1.day, 27);
    assert.strictEqual(p1.month, 6);
    assert.strictEqual(p1.gender, 'male');

    // Caso fecha normal y corchetes en pronombre: "25/03 [ella]"
    const p2 = service.parseRegistrationInput('25/03 [ella]');
    assert.strictEqual(p2.valid, true);
    assert.strictEqual(p2.day, 25);
    assert.strictEqual(p2.month, 3);
    assert.strictEqual(p2.gender, 'female');

    // Caso todo junto sin corchetes: "15/08 el"
    const p3 = service.parseRegistrationInput('15/08 el');
    assert.strictEqual(p3.valid, true);
    assert.strictEqual(p3.day, 15);
    assert.strictEqual(p3.month, 8);
    assert.strictEqual(p3.gender, 'male');

    // Solo fecha con corchetes: "[05/11]"
    const p4 = service.parseRegistrationInput('[05/11]');
    assert.strictEqual(p4.valid, true);
    assert.strictEqual(p4.day, 5);
    assert.strictEqual(p4.month, 11);
    assert.strictEqual(p4.gender, undefined);

    db.close();
  });
});
