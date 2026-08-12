import { fetchLiveQuoteWithKisRouting } from './marketData/liveQuoteRouter.mjs';

// Was 3 minutes; live portfolio/lookup views poll far more often than that in practice, so most
// requests were serving quotes that were already stale relative to how fresh the UI implies they
// are. 10s keeps the "share one cache entry across every concurrent request for the same ticker"
// benefit (see getLiveMarketDataWithCache below) while actually refreshing at a cadence closer to
// what "실시간" labels on the UI (MarketLivePreview, the KIS source label itself) imply.
const FRESH_TTL_MS = 10 * 1000;
const MAX_CACHE_ENTRIES = 500;

// Entries are kept past the TTL so the last successful quote can be served
// with stale=true when every upstream provider fails.
const state = globalThis.__ATOMFOLIO_MARKET_QUOTE_CACHE__ ?? new Map();

globalThis.__ATOMFOLIO_MARKET_QUOTE_CACHE__ = state;

function cacheKey(ticker, name) {
  return `${String(ticker ?? '').trim().toLowerCase()}|${String(name ?? '').trim().toLowerCase()}`;
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

function toResponsePayload(entry, { stale, staleReason = '' } = {}) {
  return {
    ...entry.payload,
    stale,
    cache: {
      hit: true,
      cachedAt: new Date(entry.fetchedAt).toISOString(),
      ...(staleReason ? { staleReason } : {}),
    },
  };
}

export async function getLiveMarketDataWithCache(
  { ticker, name } = {},
  {
    fetcher = fetchLiveQuoteWithKisRouting,
    ttlMs = FRESH_TTL_MS,
    now = Date.now(),
  } = {},
) {
  const key = cacheKey(ticker, name);
  const entry = state.get(key);

  if (entry && now - entry.fetchedAt < ttlMs) {
    return toResponsePayload(entry, { stale: false });
  }

  try {
    const payload = await fetcher({ ticker, name });
    state.delete(key);
    state.set(key, { fetchedAt: now, payload });
    evictOldestEntries();
    return { ...payload, stale: false };
  } catch (error) {
    if (entry) {
      return toResponsePayload(entry, {
        stale: true,
        staleReason: error instanceof Error ? error.message : 'Provider fetch failed.',
      });
    }
    throw error;
  }
}

export function getMarketDataCacheStats() {
  return {
    entries: state.size,
    freshTtlMs: FRESH_TTL_MS,
  };
}

export function resetMarketDataCache() {
  state.clear();
}
