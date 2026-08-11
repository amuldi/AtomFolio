// Same shape as marketDataCache.mjs's in-memory cache (globalThis-backed so it survives
// `node --watch` module reloads and stays warm across requests on a warm serverless instance) —
// sits inside enforceRateLimit('market-news', ...), cutting how often the real Naver/Bing/Finnhub
// calls actually fire without changing the rate limit itself.
const FRESH_TTL_MS = 2.5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const state = globalThis.__ATOMFOLIO_NEWS_CACHE__ ?? new Map();
globalThis.__ATOMFOLIO_NEWS_CACHE__ = state;

function cacheKey({ language, mode, query, tickers }) {
  const sortedTickers = [...(tickers ?? [])].map((ticker) => String(ticker).trim().toLowerCase()).sort();
  return [
    String(language ?? '').trim().toLowerCase(),
    String(mode ?? '').trim().toLowerCase(),
    String(query ?? '').trim().toLowerCase(),
    sortedTickers.join(','),
  ].join('|');
}

function evictOldestEntries() {
  while (state.size > MAX_CACHE_ENTRIES) {
    const oldestKey = state.keys().next().value;
    if (oldestKey == null) {
      return;
    }
    state.delete(oldestKey);
  }
}

export async function getMarketNewsWithCache(
  { query, tickers = [], language, mode, refreshKey },
  { fetcher, ttlMs = FRESH_TTL_MS, now = Date.now() },
) {
  const key = cacheKey({ language, mode, query, tickers });
  const entry = state.get(key);
  // An explicit refresh click always re-fetches — the cache is a background traffic-reduction
  // measure, never something that makes the refresh button feel unresponsive.
  const bypassRead = Boolean(refreshKey);

  if (!bypassRead && entry && now - entry.fetchedAt < ttlMs) {
    return { ...entry.payload, cache: { hit: true, cachedAt: entry.fetchedAt } };
  }

  try {
    const payload = await fetcher({ query, tickers, language, mode, refreshKey });
    state.delete(key);
    state.set(key, { fetchedAt: now, payload });
    evictOldestEntries();
    return { ...payload, cache: { hit: false, cachedAt: now } };
  } catch (error) {
    if (entry) {
      return {
        ...entry.payload,
        stale: true,
        cache: { hit: true, cachedAt: entry.fetchedAt, staleReason: error instanceof Error ? error.message : 'news-fetch-failed' },
      };
    }
    throw error;
  }
}

