import type { HoroscopeRepository } from '../database/repositories/horoscope.repository.js';

export interface ZodiacSignInfo {
  key: string;
  nameEs: string;
  emoji: string;
  sigastraName: string;
}

export const ZODIAC_SIGNS: Record<string, ZodiacSignInfo> = {
  aries: { key: 'aries', nameEs: 'Aries', emoji: '♈', sigastraName: 'Aries' },
  taurus: { key: 'taurus', nameEs: 'Tauro', emoji: '♉', sigastraName: 'Taurus' },
  gemini: { key: 'gemini', nameEs: 'Géminis', emoji: '♊', sigastraName: 'Gemini' },
  cancer: { key: 'cancer', nameEs: 'Cáncer', emoji: '♋', sigastraName: 'Cancer' },
  leo: { key: 'leo', nameEs: 'Leo', emoji: '♌', sigastraName: 'Leo' },
  virgo: { key: 'virgo', nameEs: 'Virgo', emoji: '♍', sigastraName: 'Virgo' },
  libra: { key: 'libra', nameEs: 'Libra', emoji: '♎', sigastraName: 'Libra' },
  scorpio: { key: 'scorpio', nameEs: 'Escorpio', emoji: '♏', sigastraName: 'Scorpio' },
  sagittarius: { key: 'sagittarius', nameEs: 'Sagitario', emoji: '♐', sigastraName: 'Sagittarius' },
  capricorn: { key: 'capricorn', nameEs: 'Capricornio', emoji: '♑', sigastraName: 'Capricorn' },
  aquarius: { key: 'aquarius', nameEs: 'Acuario', emoji: '♒', sigastraName: 'Aquarius' },
  pisces: { key: 'pisces', nameEs: 'Piscis', emoji: '♓', sigastraName: 'Pisces' }
};

export class HoroscopeService {
  constructor(
    private horoscopeRepo: HoroscopeRepository,
    private timezone: string = 'America/Argentina/Cordoba'
  ) {}

  /**
   * Determina el signo zodiacal a partir del día y mes de nacimiento
   */
  public getSignFromDate(day: number, month: number): ZodiacSignInfo {
    // Aries: 21 Mar - 19 Abr
    if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return ZODIAC_SIGNS.aries;
    // Tauro: 20 Abr - 20 May
    if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return ZODIAC_SIGNS.taurus;
    // Géminis: 21 May - 20 Jun
    if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return ZODIAC_SIGNS.gemini;
    // Cáncer: 21 Jun - 22 Jul
    if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return ZODIAC_SIGNS.cancer;
    // Leo: 23 Jul - 22 Ago
    if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return ZODIAC_SIGNS.leo;
    // Virgo: 23 Ago - 22 Sep
    if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return ZODIAC_SIGNS.virgo;
    // Libra: 23 Sep - 22 Oct
    if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return ZODIAC_SIGNS.libra;
    // Escorpio: 23 Oct - 21 Nov
    if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return ZODIAC_SIGNS.scorpio;
    // Sagitario: 22 Nov - 21 Dic
    if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return ZODIAC_SIGNS.sagittarius;
    // Capricornio: 22 Dic - 19 Ene
    if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return ZODIAC_SIGNS.capricorn;
    // Acuario: 20 Ene - 18 Feb
    if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return ZODIAC_SIGNS.aquarius;
    // Piscis: 19 Feb - 20 Mar
    return ZODIAC_SIGNS.pisces;
  }

  /**
   * Resuelve el signo a partir de texto del usuario (insensible a mayúsculas y tildes)
   */
  public resolveSign(input: string): ZodiacSignInfo | null {
    const normalized = input
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const aliases: Record<string, keyof typeof ZODIAC_SIGNS> = {
      aries: 'aries',
      tauro: 'taurus',
      taurus: 'taurus',
      geminis: 'gemini',
      gemini: 'gemini',
      cancer: 'cancer',
      leo: 'leo',
      virgo: 'virgo',
      libra: 'libra',
      escorpio: 'scorpio',
      escorpion: 'scorpio',
      scorpio: 'scorpio',
      sagitario: 'sagittarius',
      sagittarius: 'sagittarius',
      capricornio: 'capricorn',
      capricorn: 'capricorn',
      acuario: 'aquarius',
      aquarius: 'aquarius',
      piscis: 'pisces',
      pisces: 'pisces'
    };

    const key = aliases[normalized];
    return key ? ZODIAC_SIGNS[key] : null;
  }

  /**
   * Lista todos los nombres de signos para sugerencias de ayuda
   */
  public getAllSignNames(): string[] {
    return Object.values(ZODIAC_SIGNS).map((s) => s.nameEs);
  }

  /**
   * Obtiene el horóscopo diario para un signo (con caché SQLite de 6 horas)
   * Siempre consulta la versión completa (full=1) para disponer de todos los párrafos sin truncar.
   */
  public async getDailyHoroscope(sign: ZodiacSignInfo, isFull: boolean = false): Promise<string> {
    const cacheKey = 'daily_full';
    let dataJson = this.horoscopeRepo.getCached(cacheKey);

    let parsedData: any = null;
    if (dataJson) {
      try {
        parsedData = JSON.parse(dataJson);
      } catch {
        parsedData = null;
      }
    }

    if (!parsedData) {
      const url = `https://sigastra.com/api/v1/daily?lang=es&full=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error(`Sigastra API respondió con status ${response.status}`);
      }

      dataJson = await response.text();
      parsedData = JSON.parse(dataJson);

      // Guardar en caché con vigencia de 6 horas
      this.horoscopeRepo.setCached(cacheKey, dataJson, 6 * 60 * 60 * 1000);
    }

    const item = parsedData.items?.find((it: any) =>
      it.sign?.toLowerCase() === sign.sigastraName.toLowerCase() ||
      it.editorial?.sign?.toLowerCase() === sign.sigastraName.toLowerCase()
    );

    if (!item) {
      throw new Error(`No se encontró información para el signo ${sign.nameEs}`);
    }

    return this.formatHoroscopeMessage(sign, item, isFull);
  }

  /**
   * Formatea el horóscopo en la plantilla corta (hasta 3 párrafos limpios) o larga (completa)
   */
  public formatHoroscopeMessage(
    sign: ZodiacSignInfo,
    item: any,
    isFull: boolean,
    now: Date = new Date()
  ): string {
    const dateFormatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: this.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    const rawDateStr = dateFormatter.format(now);
    const capitalizedDate = rawDateStr.charAt(0).toUpperCase() + rawDateStr.slice(1);

    const fullText = item.text?.trim() || 'Predicción astrológica no disponible.';
    const paragraphs = fullText.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);

    // Versión corta: hasta 3 párrafos completos, sin Amor/Trabajo/Energía ni Powered by
    if (!isFull) {
      const shortText = paragraphs.slice(0, 3).join('\n\n') || fullText;
      const lines: string[] = [
        `✨ *Horóscopo de Hoy: ${sign.nameEs}* ${sign.emoji}`,
        `📅 ${capitalizedDate}`,
        '━━━━━━━━━━━━━━━━━━━━',
        shortText,
        '',
        `💡 _Para leer la predicción completa usá */h ${sign.nameEs.toLowerCase()} largo*_`
      ];
      return lines.join('\n');
    }

    // Versión completa (largo): todos los párrafos + Amor/Trabajo/Energía + créditos Sigastra
    const lines: string[] = [
      `✨ *Horóscopo Completo: ${sign.nameEs}* ${sign.emoji}`,
      `📅 ${capitalizedDate}`,
      '━━━━━━━━━━━━━━━━━━━━',
      fullText
    ];

    if (item.data) {
      lines.push('');
      if (item.data.loveLine) {
        lines.push(`💖 *Amor:* ${item.data.loveLine.trim()}`);
      }
      if (item.data.workLine) {
        lines.push(`💼 *Trabajo:* ${item.data.workLine.trim()}`);
      }
      if (item.data.energyLine) {
        lines.push(`⚡ *Energía:* ${item.data.energyLine.trim()}`);
      }
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━');
    const canonicalUrl = item.editorial?.canonical || item.url || `https://sigastra.com/es/horoscopo-diario/${sign.sigastraName.toLowerCase()}`;
    lines.push('✨ _Powered by Sigastra_');
    lines.push(`🔗 _Fuente canónica:_ ${canonicalUrl}`);

    return lines.join('\n');
  }
}
