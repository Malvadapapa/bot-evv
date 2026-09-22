import test from 'node:test';
import assert from 'node:assert';
import { Database, HoroscopeRepository } from '../../src/database/index.js';
import { HoroscopeService, ZODIAC_SIGNS } from '../../src/services/horoscope.service.js';

test('HoroscopeService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const horoscopeRepo = new HoroscopeRepository(db);
  const horoscopeService = new HoroscopeService(horoscopeRepo, 'America/Argentina/Cordoba');

  await t.test('Calculates zodiac sign accurately from birth date boundaries', () => {
    // Aries: 21 Mar - 19 Abr
    assert.strictEqual(horoscopeService.getSignFromDate(21, 3).key, 'aries');
    assert.strictEqual(horoscopeService.getSignFromDate(19, 4).key, 'aries');

    // Tauro: 20 Abr - 20 May
    assert.strictEqual(horoscopeService.getSignFromDate(20, 4).key, 'taurus');
    assert.strictEqual(horoscopeService.getSignFromDate(20, 5).key, 'taurus');

    // Géminis: 21 May - 20 Jun
    assert.strictEqual(horoscopeService.getSignFromDate(21, 5).key, 'gemini');
    assert.strictEqual(horoscopeService.getSignFromDate(20, 6).key, 'gemini');

    // Cáncer: 21 Jun - 22 Jul
    assert.strictEqual(horoscopeService.getSignFromDate(21, 6).key, 'cancer');
    assert.strictEqual(horoscopeService.getSignFromDate(22, 7).key, 'cancer');

    // Leo: 23 Jul - 22 Ago
    assert.strictEqual(horoscopeService.getSignFromDate(23, 7).key, 'leo');
    assert.strictEqual(horoscopeService.getSignFromDate(22, 8).key, 'leo');

    // Virgo: 23 Ago - 22 Sep
    assert.strictEqual(horoscopeService.getSignFromDate(23, 8).key, 'virgo');
    assert.strictEqual(horoscopeService.getSignFromDate(22, 9).key, 'virgo');

    // Libra: 23 Sep - 22 Oct
    assert.strictEqual(horoscopeService.getSignFromDate(23, 9).key, 'libra');
    assert.strictEqual(horoscopeService.getSignFromDate(22, 10).key, 'libra');

    // Escorpio: 23 Oct - 21 Nov
    assert.strictEqual(horoscopeService.getSignFromDate(23, 10).key, 'scorpio');
    assert.strictEqual(horoscopeService.getSignFromDate(21, 11).key, 'scorpio');

    // Sagitario: 22 Nov - 21 Dic
    assert.strictEqual(horoscopeService.getSignFromDate(22, 11).key, 'sagittarius');
    assert.strictEqual(horoscopeService.getSignFromDate(21, 12).key, 'sagittarius');

    // Capricornio: 22 Dic - 19 Ene
    assert.strictEqual(horoscopeService.getSignFromDate(22, 12).key, 'capricorn');
    assert.strictEqual(horoscopeService.getSignFromDate(19, 1).key, 'capricorn');

    // Acuario: 20 Ene - 18 Feb
    assert.strictEqual(horoscopeService.getSignFromDate(20, 1).key, 'aquarius');
    assert.strictEqual(horoscopeService.getSignFromDate(18, 2).key, 'aquarius');

    // Piscis: 19 Feb - 20 Mar
    assert.strictEqual(horoscopeService.getSignFromDate(19, 2).key, 'pisces');
    assert.strictEqual(horoscopeService.getSignFromDate(20, 3).key, 'pisces');
  });

  await t.test('Resolves sign aliases, accents and casings tolerantly', () => {
    assert.strictEqual(horoscopeService.resolveSign('virgo')?.key, 'virgo');
    assert.strictEqual(horoscopeService.resolveSign('VIRGO')?.key, 'virgo');
    assert.strictEqual(horoscopeService.resolveSign('  Virgo  ')?.key, 'virgo');

    assert.strictEqual(horoscopeService.resolveSign('géminis')?.key, 'gemini');
    assert.strictEqual(horoscopeService.resolveSign('geminis')?.key, 'gemini');

    assert.strictEqual(horoscopeService.resolveSign('cáncer')?.key, 'cancer');
    assert.strictEqual(horoscopeService.resolveSign('cancer')?.key, 'cancer');

    assert.strictEqual(horoscopeService.resolveSign('escorpión')?.key, 'scorpio');
    assert.strictEqual(horoscopeService.resolveSign('escorpio')?.key, 'scorpio');

    assert.strictEqual(horoscopeService.resolveSign('capricornio')?.key, 'capricorn');
    assert.strictEqual(horoscopeService.resolveSign('capricorn')?.key, 'capricorn');

    assert.strictEqual(horoscopeService.resolveSign('inexistente'), null);
  });

  await t.test('Caches and retrieves horoscope data in SQLite with TTL', () => {
    const key = 'test_daily';
    const payload = JSON.stringify({ items: [{ sign: 'Virgo', text: 'Excelente día' }] });

    assert.strictEqual(horoscopeRepo.getCached(key), null);

    horoscopeRepo.setCached(key, payload, 6 * 60 * 60 * 1000);
    const cached = horoscopeRepo.getCached(key);
    assert.strictEqual(cached, payload);

    // Con TTL vencido (-1 ms) no debe retornar nada
    horoscopeRepo.setCached(key, payload, -1000);
    assert.strictEqual(horoscopeRepo.getCached(key), null);
  });

  await t.test('Formats short horoscope message with up to 3 paragraphs and without extra lines', () => {
    const mockItem = {
      sign: 'Virgo',
      text: 'Párrafo 1.\n\nPárrafo 2.\n\nPárrafo 3.\n\nPárrafo 4.',
      url: 'https://sigastra.com/es/horoscopo-diario/virgo',
      data: {
        loveLine: 'El corazón pide sinceridad hoy.',
        workLine: 'Tu precisión rinde frutos.',
        energyLine: 'Oscilás entre la acción y la pausa.'
      }
    };

    const formatted = horoscopeService.formatHoroscopeMessage(
      ZODIAC_SIGNS.virgo,
      mockItem,
      false,
      new Date('2026-09-22T10:00:00Z')
    );

    assert.match(formatted, /✨ \*Horóscopo de Hoy: Virgo\* ♍/);
    assert.match(formatted, /Párrafo 1\.\n\nPárrafo 2\.\n\nPárrafo 3\./);
    assert.doesNotMatch(formatted, /Párrafo 4/);
    assert.doesNotMatch(formatted, /Amor:/);
    assert.doesNotMatch(formatted, /Trabajo:/);
    assert.doesNotMatch(formatted, /Energía:/);
    assert.doesNotMatch(formatted, /Powered by Sigastra/);
    assert.match(formatted, /💡 _Para leer la predicción completa usá \*\/h virgo largo\*_/);
  });

  await t.test('Formats long horoscope message with canonical URL and full text', () => {
    const mockItem = {
      sign: 'Virgo',
      text: 'Párrafo 1 completo.\n\nPárrafo 2 completo.',
      url: 'https://sigastra.com/es/horoscopo-diario/virgo',
      editorial: {
        canonical: 'https://sigastra.com/es/horoscopo-diario/virgo'
      },
      data: {
        loveLine: 'El corazón pide sinceridad hoy.',
        workLine: 'Tu precisión rinde frutos.',
        energyLine: 'Oscilás entre la acción y la pausa.'
      }
    };

    const formatted = horoscopeService.formatHoroscopeMessage(
      ZODIAC_SIGNS.virgo,
      mockItem,
      true,
      new Date('2026-09-22T10:00:00Z')
    );

    assert.match(formatted, /✨ \*Horóscopo Completo: Virgo\* ♍/);
    assert.match(formatted, /Párrafo 1 completo\.\n\nPárrafo 2 completo\./);
    assert.match(formatted, /💖 \*Amor:\* El corazón pide sinceridad hoy\./);
    assert.match(formatted, /💼 \*Trabajo:\* Tu precisión rinde frutos\./);
    assert.match(formatted, /⚡ \*Energía:\* Oscilás entre la acción y la pausa\./);
    assert.match(formatted, /✨ _Powered by Sigastra_/);
    assert.match(formatted, /🔗 _Fuente canónica:_ https:\/\/sigastra\.com\/es\/horoscopo-diario\/virgo/);
  });

  db.close();
});
