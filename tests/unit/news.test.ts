import test from 'node:test';
import assert from 'node:assert';
import { Database, NewsRepository } from '../../src/database/index.js';
import { NewsService } from '../../src/services/news.service.js';

test('NewsService Unit Tests', async (t) => {
  const db = Database.createInMemory();
  const newsRepo = new NewsRepository(db);
  const newsService = new NewsService(newsRepo);

  await t.test('Parses RSS XML with CDATA and standard tags', () => {
    const mockXml = `
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title><![CDATA[Node.js 24 Released with SQLite Support]]></title>
            <link>https://dev.to/nodejs-24</link>
          </item>
          <item>
            <title>TypeScript 5.8 Announcements &amp; Changes</title>
            <link>https://news.ycombinator.com/item?id=12345</link>
          </item>
        </channel>
      </rss>
    `;

    const items = newsService.parseRssItems(mockXml, 'Test Source');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, 'Node.js 24 Released with SQLite Support');
    assert.strictEqual(items[0].link, 'https://dev.to/nodejs-24');
    assert.strictEqual(items[0].source, 'Test Source');
    assert.strictEqual(items[1].title, 'TypeScript 5.8 Announcements & Changes');
    assert.strictEqual(items[1].link, 'https://news.ycombinator.com/item?id=12345');
  });

  await t.test('Deduplicates published news correctly', () => {
    const link = 'https://news.example.com/unique-article-1';
    assert.strictEqual(newsRepo.isNewsPublished(link), false);

    newsRepo.recordNewsPublished(link, 'Unique Article 1', 'Example');
    assert.strictEqual(newsRepo.isNewsPublished(link), true);
  });

  await t.test('Formats news briefing for WhatsApp message', () => {
    const formatted = newsService.formatNewsBriefing([
      {
        id: '1',
        title: 'Nueva versión de Node.js',
        link: 'https://nodejs.org',
        source: 'Dev.to'
      },
      {
        id: '2',
        title: 'Novedades de SQLite',
        link: 'https://sqlite.org',
        source: 'Hacker News'
      }
    ]);

    assert.match(formatted, /Novedades y Noticias Tech del Día/);
    assert.match(formatted, /1\. \*Nueva versión de Node\.js\*/);
    assert.match(formatted, /2\. \*Novedades de SQLite\*/);
    assert.match(formatted, /https:\/\/nodejs\.org/);
    assert.match(formatted, /https:\/\/sqlite\.org/);
  });

  await t.test('Returns empty string when no news available', () => {
    const formatted = newsService.formatNewsBriefing([]);
    assert.strictEqual(formatted, '');
  });

  db.close();
});
