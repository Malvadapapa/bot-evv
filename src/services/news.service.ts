import { NewsRepository } from '../database/repositories/news.repository.js';

export interface TechNewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
}

export class NewsService {
  private sources = [
    { name: 'Dev.to Tech', url: 'https://dev.to/feed' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' }
  ];

  constructor(private newsRepo: NewsRepository) {}

  /**
   * Obtiene y deduplica las noticias más recientes
   */
  public async getLatestUnpublishedNews(count: number = 3): Promise<TechNewsItem[]> {
    const rawItems: TechNewsItem[] = [];

    for (const source of this.sources) {
      try {
        const response = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bot-EVV/1.0' },
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) continue;
        const xml = await response.text();
        const items = this.parseRssItems(xml, source.name);
        rawItems.push(...items);
      } catch (err: any) {
        console.warn(`⚠️ [NewsService] No se pudo obtener feed ${source.name}: ${err?.message || err}`);
      }
    }

    // Filtrar aquellas que ya hayan sido publicadas previamente
    const freshNews: TechNewsItem[] = [];
    for (const item of rawItems) {
      if (!this.newsRepo.isNewsPublished(item.id)) {
        freshNews.push(item);
        if (freshNews.length >= count) break;
      }
    }

    // Registrar como publicadas
    for (const item of freshNews) {
      this.newsRepo.recordNewsPublished(item.id, item.title, item.source);
    }

    return freshNews;
  }

  /**
   * Formatea las noticias para el mensaje matutino o broadcast
   */
  public formatNewsBriefing(news: TechNewsItem[]): string {
    if (news.length === 0) {
      return '';
    }

    const lines: string[] = ['📰 *Novedades y Noticias Tech del Día:*'];
    news.forEach((item, idx) => {
      lines.push(`${idx + 1}. *${item.title.trim()}*`);
      lines.push(`   🔗 ${item.link.trim()}`);
    });

    return lines.join('\n');
  }

  /**
   * Parser simple de RSS sin dependencias externas
   */
  public parseRssItems(xml: string, sourceName: string): TechNewsItem[] {
    const items: TechNewsItem[] = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const block of itemMatches) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);

      if (titleMatch && linkMatch) {
        const title = this.cleanXml(titleMatch[1]);
        const link = this.cleanXml(linkMatch[1]);
        const id = link.trim();

        if (title && link) {
          items.push({ id, title, link, source: sourceName });
        }
      }
    }

    return items;
  }

  private cleanXml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
