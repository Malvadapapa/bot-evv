import test from 'node:test';
import assert from 'node:assert';
import { Database, NewsRepository } from '../../src/database/index.js';
import { NewsService } from '../../src/services/news.service.js';

test('NewsService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const newsRepo = new NewsRepository(db);
  const newsService = new NewsService(newsRepo);

  await t.test('Parses RSS XML with CDATA, HTML cleaning and descriptions', () => {
    const mockXml = `
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title><![CDATA[Arcjet: protege tus agentes IA]]></title>
            <link>https://dev.to/arcjet-protege</link>
            <description><![CDATA[<p>Solución práctica para blindar tus agentes de IA.</p><script>alert(1)</script>]]></description>
          </item>
          <item>
            <title>Amazon Prime sube de precio en México</title>
            <link>https://xataka.com.mx/amazon-prime</link>
            <description>Aumento oficial en el costo del servicio.</description>
          </item>
        </channel>
      </rss>
    `;

    const items = newsService.parseRssItems(mockXml, 'Test Source');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, 'Arcjet: protege tus agentes IA');
    assert.strictEqual(items[0].link, 'https://dev.to/arcjet-protege');
    assert.strictEqual(items[0].source, 'Test Source');
    assert.strictEqual(items[0].summary, 'Solución práctica para blindar tus agentes de IA.');
    assert.strictEqual(items[1].title, 'Amazon Prime sube de precio en México');
    assert.strictEqual(items[1].summary, 'Aumento oficial en el costo del servicio.');
  });

  await t.test('Deduplicates published news correctly in SQLite', () => {
    const link = 'https://news.example.com/unique-article-1';
    assert.strictEqual(newsRepo.isNewsPublished(link), false);

    newsRepo.recordNewsPublished(link, 'Unique Article 1', 'Example');
    assert.strictEqual(newsRepo.isNewsPublished(link), true);
  });

  await t.test('Formats single news item for separate message dispatch', () => {
    const item = {
      id: 'https://test.com/news',
      title: 'Nuevo Framework Web',
      link: 'https://test.com/news',
      source: 'Dev.to (Español)',
      summary: 'Revoluciona el rendimiento con compilación nativa.'
    };

    const formatted = newsService.formatSingleNewsItem(item);
    assert.strictEqual(
      formatted,
      '📰 *Nuevo Framework Web*\n\nRevoluciona el rendimiento con compilación nativa.\n\n🔗 https://test.com/news'
    );
  });

  await t.test('Cleans HTML tags, scripts and entities thoroughly', () => {
    const dirty = '<p>Texto inicial &amp; m&aacute;s <script>console.log("hack")</script><iframe src="ad"></iframe></p>';
    const cleaned = newsService.cleanHtmlText(dirty);
    assert.strictEqual(cleaned, 'Texto inicial & más');
  });

  await t.test('Formats legacy news briefing when needed', () => {
    const formatted = newsService.formatNewsBriefing([
      {
        id: '1',
        title: 'Nueva versión de Node.js',
        link: 'https://nodejs.org',
        source: 'Dev.to',
        summary: 'Incluye soporte nativo para SQLite.'
      }
    ]);

    assert.match(formatted, /Novedades y Noticias Tech del Día/);
    assert.match(formatted, /1\. \*Nueva versión de Node\.js\*/);
    assert.match(formatted, /https:\/\/nodejs\.org/);
  });

  db.close();
});
