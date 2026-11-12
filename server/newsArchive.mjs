// Persistent news archive. The live providers (Naver/Bing/Finnhub) only ever return "right now",
// so without this every past article vanished as soon as it fell off the provider's first page —
// the panel showed whatever the last scrape returned (sometimes 4 rows) and nothing older.
// Every successful fetch is upserted here, and the default (non-search) news view reads the live
// pool plus this archive. Everything is best-effort: no DATABASE_URL, or a DB error, just means
// the panel falls back to the live pool alone.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { getPostgresDatabaseUrl } from './postgresPortfolioStore.mjs';

const ARCHIVE_READ_LIMIT = 200;
const ARCHIVE_WRITE_TIMEOUT_MS = 2500;
const ARCHIVE_READ_TIMEOUT_MS = 2500;

let sqlClient = null;
let schemaReadyPromise = null;

function getSql() {
  const databaseUrl = getPostgresDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }
  if (!sqlClient) {
    sqlClient = neon(databaseUrl);
  }
  return sqlClient;
}

export function isNewsArchiveEnabled() {
  return Boolean(getPostgresDatabaseUrl()) && process.env.ATOMFOLIO_NEWS_ARCHIVE !== 'false';
}

async function ensureSchema(sql) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql.query(`CREATE TABLE IF NOT EXISTS atomfolio_news_articles (
        link_hash text PRIMARY KEY,
        language text NOT NULL,
        title text NOT NULL,
        link text NOT NULL,
        description text NOT NULL DEFAULT '',
        source text NOT NULL DEFAULT '',
        thumbnail_url text,
        published_at timestamptz,
        first_seen_at timestamptz NOT NULL DEFAULT now()
      )`);
      await sql.query(
        `CREATE INDEX IF NOT EXISTS atomfolio_news_articles_lang_time_idx
          ON atomfolio_news_articles (language, (COALESCE(published_at, first_seen_at)) DESC)`,
      );
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

function withTimeout(promise, ms) {
  let timerId;
  return Promise.race([
    promise.finally(() => clearTimeout(timerId)),
    new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('news-archive-timeout')), ms);
    }),
  ]);
}

// Bing links are redirect URLs whose tracking params change per fetch; key on the real target so
// the same article isn't archived again on every scrape.
function canonicalLink(link) {
  try {
    const url = new URL(link);
    const target = /(^|\.)bing\.com$/i.test(url.hostname) ? url.searchParams.get('url') : null;
    const canonical = new URL(target || link);
    canonical.hash = '';
    return canonical.toString();
  } catch {
    return String(link ?? '');
  }
}

export function newsLinkHash(link) {
  return createHash('sha256').update(canonicalLink(link)).digest('hex').slice(0, 40);
}

export async function archiveNewsItems(items, { language }) {
  if (!isNewsArchiveEnabled() || !Array.isArray(items) || !items.length) {
    return 0;
  }
  const sql = getSql();
  const rows = items
    .filter((item) => item?.title && item?.link)
    .map((item) => ({
      link_hash: newsLinkHash(item.link),
      language,
      title: String(item.title).slice(0, 400),
      link: String(item.link).slice(0, 2000),
      description: String(item.description ?? '').slice(0, 1000),
      source: String(item.source ?? '').slice(0, 120),
      thumbnail_url: item.thumbnailUrl ? String(item.thumbnailUrl).slice(0, 2000) : null,
      published_at: Number.isFinite(Number(item.publishedAt)) ? new Date(Number(item.publishedAt)).toISOString() : null,
    }));

  if (!rows.length) {
    return 0;
  }

  try {
    await withTimeout(
      (async () => {
        await ensureSchema(sql);
        // One statement for the whole batch: jsonb_to_recordset expands the array server-side.
        await sql.query(
          `INSERT INTO atomfolio_news_articles
             (link_hash, language, title, link, description, source, thumbnail_url, published_at)
           SELECT link_hash, language, title, link, description, source, thumbnail_url, published_at
             FROM jsonb_to_recordset($1::jsonb) AS r(
               link_hash text, language text, title text, link text, description text,
               source text, thumbnail_url text, published_at timestamptz)
           ON CONFLICT (link_hash) DO UPDATE SET
             thumbnail_url = COALESCE(atomfolio_news_articles.thumbnail_url, EXCLUDED.thumbnail_url)`,
          [JSON.stringify(rows)],
        );
      })(),
      ARCHIVE_WRITE_TIMEOUT_MS,
    );
    return rows.length;
  } catch {
    return 0;
  }
}

export async function readArchivedNews({ language, limit = ARCHIVE_READ_LIMIT }) {
  if (!isNewsArchiveEnabled()) {
    return [];
  }
  const sql = getSql();

  try {
    const rows = await withTimeout(
      (async () => {
        await ensureSchema(sql);
        return sql.query(
          `SELECT link_hash, title, link, description, source, thumbnail_url,
                  COALESCE(published_at, first_seen_at) AS published_at
             FROM atomfolio_news_articles
            WHERE language = $1
            ORDER BY COALESCE(published_at, first_seen_at) DESC
            LIMIT $2`,
          [language, Math.min(Math.max(1, limit), 500)],
        );
      })(),
      ARCHIVE_READ_TIMEOUT_MS,
    );

    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: `archive-${row.link_hash}`,
      linkHash: row.link_hash,
      title: row.title,
      link: row.link,
      description: row.description,
      source: row.source,
      publishedAt: row.published_at ? new Date(row.published_at).getTime() : null,
      thumbnailUrl: row.thumbnail_url || null,
      archived: true,
    }));
  } catch {
    return [];
  }
}

// Live items first (they carry fresh thumbnails/ids the client already tracks for NEW badges),
// then archived ones not already present, newest first overall.
export function mergeLiveAndArchivedNews(liveItems, archivedItems) {
  const seen = new Set();
  const merged = [];

  for (const item of [...(liveItems ?? []), ...(archivedItems ?? [])]) {
    if (!item?.link) {
      continue;
    }
    const key = item.linkHash ?? newsLinkHash(item.link);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  return merged.sort((left, right) => {
    const l = Number(left.publishedAt);
    const r = Number(right.publishedAt);
    const lOk = Number.isFinite(l);
    const rOk = Number.isFinite(r);
    if (lOk && rOk) {
      return r - l;
    }
    return lOk ? -1 : rOk ? 1 : 0;
  });
}
