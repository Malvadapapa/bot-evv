import { NewsRepository } from '../database/repositories/news.repository.js';
import type { AIService } from './ai.service.js';

export interface TechNewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  summary?: string;
}

export class NewsService {
  constructor(
    private newsRepo: NewsRepository,
    private aiService?: AIService
  ) {}

  /**
   * Obtiene noticias de las fuentes especificadas seleccionadas al azar (por defecto 3).
   * Si no hay noticias inéditas en una fuente, no repite las de días previos.
   */
  public async getLatestUnpublishedNews(count: number = 3): Promise<TechNewsItem[]> {
    const sourcesUnpublished: TechNewsItem[][] = [];

    // 1. Dev.to (en español)
    try {
      const devToItems = await this.fetchDevToNews();
      const unpub = devToItems.filter((item) => !this.newsRepo.isNewsPublished(item.id));
      if (unpub.length > 0) sourcesUnpublished.push(unpub.sort(() => Math.random() - 0.5));
    } catch (err: any) {
      console.warn(`⚠️ [NewsService] Error obteniendo Dev.to: ${err?.message || err}`);
    }

    // 2. Xataka México
    try {
      const xatakaItems = await this.fetchXatakaNews();
      const unpub = xatakaItems.filter((item) => !this.newsRepo.isNewsPublished(item.id));
      if (unpub.length > 0) sourcesUnpublished.push(unpub.sort(() => Math.random() - 0.5));
    } catch (err: any) {
      console.warn(`⚠️ [NewsService] Error obteniendo Xataka México: ${err?.message || err}`);
    }

    // 3. Platzi Blog (Scraping nativo)
    try {
      const platziItems = await this.fetchPlatziBlogNews();
      const unpub = platziItems.filter((item) => !this.newsRepo.isNewsPublished(item.id));
      if (unpub.length > 0) sourcesUnpublished.push(unpub.sort(() => Math.random() - 0.5));
    } catch (err: any) {
      console.warn(`⚠️ [NewsService] Error obteniendo Platzi Blog: ${err?.message || err}`);
    }

    // 4. iProUP Innovación (con fallback El Cronista)
    try {
      const iproupItems = await this.fetchIproupNews();
      const unpub = iproupItems.filter((item) => !this.newsRepo.isNewsPublished(item.id));
      if (unpub.length > 0) sourcesUnpublished.push(unpub.sort(() => Math.random() - 0.5));
    } catch (err: any) {
      console.warn(`⚠️ [NewsService] Error obteniendo iProUP / El Cronista: ${err?.message || err}`);
    }

    // Mezclar el orden de las fuentes para que la rotación sea completamente aleatoria
    const shuffledSources = [...sourcesUnpublished].sort(() => Math.random() - 0.5);
    const finalItems: TechNewsItem[] = [];

    // Selección por turnos (round-robin) para asegurar variedad de fuentes
    while (finalItems.length < count && shuffledSources.some((s) => s.length > 0)) {
      for (const queue of shuffledSources) {
        if (finalItems.length >= count) break;
        if (queue.length > 0) {
          finalItems.push(queue.pop()!);
        }
      }
    }

    // Enriquecer con resumen de IA si no tienen prospecto limpio o proviene de fuentes que vuelcan el post completo (Dev.to / Platzi)
    for (const item of finalItems) {
      const needsAiSummary =
        !item.summary ||
        item.summary.trim().length < 35 ||
        item.summary.length > 180 ||
        item.source.includes('Dev.to') ||
        item.source.includes('Platzi');

      if (needsAiSummary && this.aiService) {
        try {
          const aiSummary = await this.aiService.summarizeNewsArticle(
            item.title,
            item.link,
            item.summary
          );
          if (aiSummary && aiSummary.trim().length > 15) {
            item.summary = this.cleanHtmlText(aiSummary);
          }
        } catch (e: any) {
          console.warn(`⚠️ [NewsService] Falló resumen de IA para "${item.title}": ${e?.message || e}`);
        }
      }

      // Si aún no tiene resumen o el fallback es necesario
      if (!item.summary || item.summary.trim().length === 0) {
        item.summary = `Novedades sobre ${item.title}. Descubre todos los detalles en la nota completa.`;
      }

      // Si el resumen de fallback quedó extenso, acotarlo limpiamente a 1 o 2 oraciones
      if (item.summary && item.summary.length > 240) {
        let trimmed = item.summary
          .replace(/- La noticia .* fue publicada originalmente.*$/i, '')
          .replace(/En Xataka México \| .*$/i, '')
          .trim();

        const sentenceMatch = trimmed.match(/^([^\.\n]+(?:\.[^\.\n]+)?\.)/);
        if (sentenceMatch && sentenceMatch[1].length >= 35 && sentenceMatch[1].length <= 240) {
          item.summary = sentenceMatch[1].trim();
        } else {
          item.summary = trimmed.slice(0, 220).trim() + '...';
        }
      }

      // Registrar inmediatamente para garantizar deduplicación estricta
      this.newsRepo.recordNewsPublished(item.id, item.title, item.source);
    }

    return finalItems;
  }


  /**
   * Formatea una noticia individual para envío en mensaje separado
   */
  public formatSingleNewsItem(item: TechNewsItem): string {
    const summary = item.summary ? `\n\n${item.summary.trim()}` : '';
    return `📰 *${item.title.trim()}*${summary}\n\n🔗 ${item.link.trim()}`;
  }

  /**
   * Formatea un conjunto de noticias en un solo texto consolidado (legado/fallback)
   */
  public formatNewsBriefing(news: TechNewsItem[]): string {
    if (news.length === 0) {
      return '';
    }

    const lines: string[] = ['📰 *Novedades y Noticias Tech del Día:*'];
    news.forEach((item, idx) => {
      lines.push(`\n${idx + 1}. *${item.title.trim()}*`);
      if (item.summary) {
        lines.push(`   ${item.summary.trim()}`);
      }
      lines.push(`   🔗 ${item.link.trim()}`);
    });

    return lines.join('\n');
  }

  /**
   * Obtiene noticias de Dev.to en español
   */
  public async fetchDevToNews(): Promise<TechNewsItem[]> {
    const urls = [
      'https://dev.to/feed/tag/espanol',
      'https://dev.to/feed/tag/spanish'
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) continue;
        const xml = await res.text();
        const items = this.parseRssItems(xml, 'Dev.to (Español)');
        if (items.length > 0) return items;
      } catch {}
    }
    return [];
  }

  /**
   * Obtiene noticias de Xataka México
   */
  public async fetchXatakaNews(): Promise<TechNewsItem[]> {
    const urls = [
      'https://www.xataka.com.mx/feedburner.xml',
      'https://feeds.weblogssl.com/xatakamexico',
      'https://www.xataka.com.mx/feed'
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) continue;
        const xml = await res.text();
        const items = this.parseRssItems(xml, 'Xataka México');
        if (items.length > 0) return items;
      } catch {}
    }
    return [];
  }

  /**
   * Scraping nativo de Platzi Blog (Next.js / HTML cards)
   */
  public async fetchPlatziBlogNews(): Promise<TechNewsItem[]> {
    const res = await fetch('https://platzi.com/blog/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bot-EVV/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];

    const html = await res.text();
    const items: TechNewsItem[] = [];
    const cardRegex = /<a[^>]+href="https:\/\/platzi\.com\/blog\/([a-z0-9-]+)\/"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = cardRegex.exec(html)) !== null) {
      const slug = match[1];
      const inner = match[2];
      const titleMatch = inner.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);

      if (titleMatch) {
        const title = this.cleanHtmlText(titleMatch[1]);
        const link = `https://platzi.com/blog/${slug}/`;
        if (title && slug && !items.some((i) => i.id === link)) {
          items.push({
            id: link,
            title,
            link,
            source: 'Platzi Blog'
          });
        }
      }
    }

    return items;
  }

  /**
   * Obtiene noticias de iProUP Innovación o El Cronista (reemplazos regionales)
   */
  public async fetchIproupNews(): Promise<TechNewsItem[]> {
    // 1. iProUP Innovación
    try {
      const res = await fetch('https://www.iproup.com/rss/innovacion', {
        headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const xml = await res.text();
        const items = this.parseRssItems(xml, 'iProUP Innovación');
        if (items.length > 0) return items;
      }
    } catch {}

    // 2. El Cronista Noticias (Respaldo)
    try {
      const res = await fetch('https://www.cronista.com/files/rss/news.xml', {
        headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const xml = await res.text();
        return this.parseRssItems(xml, 'El Cronista Tech');
      }
    } catch {}

    return [];
  }

  /**
   * Parser simple de RSS sin dependencias externas
   */
  public parseRssItems(xml: string, sourceName: string): TechNewsItem[] {
    const items: TechNewsItem[] = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const block of itemMatches) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const descMatch = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

      if (titleMatch && linkMatch) {
        const title = this.cleanXml(titleMatch[1]);
        const link = this.cleanXml(linkMatch[1]);
        const rawDesc = descMatch ? descMatch[1] : '';
        const summary = this.cleanHtmlText(rawDesc);
        const id = link.trim();

        if (title && link) {
          items.push({
            id,
            title,
            link,
            source: sourceName,
            summary: summary.length > 0 ? summary : undefined
          });
        }
      }
    }

    return items;
  }

  /**
   * Limpia texto HTML eliminando tags, scripts, iframes y entidades
   */
  public cleanHtmlText(text: string): string {
    if (!text) return '';
    let cleaned = text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      // 1. Desescapar delimitadores HTML para que las etiquetas escapadas (&lt;h1&gt;) sean detectadas
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      // 2. Eliminar scripts, estilos, iframes y encabezados h1-h6 que repiten títulos
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '');

    // 3. Remover absolutamente todas las etiquetas HTML restantes
    while (/<[^>]+>/.test(cleaned)) {
      cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    }

    // 4. Decodificar caracteres acentuados y entidades numéricas
    return cleaned
      .replace(/&aacute;/gi, 'á')
      .replace(/&eacute;/gi, 'é')
      .replace(/&iacute;/gi, 'í')
      .replace(/&oacute;/gi, 'ó')
      .replace(/&uacute;/gi, 'ú')
      .replace(/&ntilde;/gi, 'ñ')
      .replace(/&Aacute;/gi, 'Á')
      .replace(/&Eacute;/gi, 'É')
      .replace(/&Iacute;/gi, 'Í')
      .replace(/&Oacute;/gi, 'Ó')
      .replace(/&Uacute;/gi, 'Ú')
      .replace(/&Ntilde;/gi, 'Ñ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanXml(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
