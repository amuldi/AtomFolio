// Finnhub-backed news provider — server-only. FINNHUB_API_KEY never leaves this process: it's
// read straight from process.env and only ever appended to a server-side outbound fetch URL,
// never returned in any response body or passed to a client-facing module.
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1/';
const FINNHUB_TIMEOUT_MS = 8000;
const COMPANY_NEWS_LOOKBACK_DAYS = 7;

function getApiKey() {
  return String(process.env.FINNHUB_API_KEY ?? '').trim();
}

export function isFinnhubConfigured() {
  return Boolean(getApiKey());
}

function safeLink(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function fetchFinnhubJson(pathname, params, signal) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('finnhub-not-configured');
  }

  const url = new URL(pathname, FINNHUB_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('token', apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINNHUB_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromParent, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`finnhub-request-failed:${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.('abort', abortFromParent);
  }
}

function mapFinnhubItem(raw) {
  const link = safeLink(raw?.url);
  const title = String(raw?.headline ?? '').trim();

  if (!title || !link) {
    return null;
  }

  const publishedAt = Number.isFinite(raw?.datetime) ? raw.datetime * 1000 : null;

  return {
    id: raw?.id != null ? `finnhub-${raw.id}` : `${link}-${publishedAt ?? 0}`,
    title,
    link,
    description: String(raw?.summary ?? '').trim(),
    source: String(raw?.source ?? '').trim() || 'Finnhub',
    publishedAt,
    thumbnailUrl: safeLink(raw?.image) || null,
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function fetchFinnhubGeneralNews({ signal } = {}) {
  const raw = await fetchFinnhubJson('news', { category: 'general' }, signal);
  return (Array.isArray(raw) ? raw : []).map(mapFinnhubItem).filter(Boolean);
}

export async function fetchFinnhubCompanyNews(symbol, { signal, daysBack = COMPANY_NEWS_LOOKBACK_DAYS } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 86400000);
  const raw = await fetchFinnhubJson(
    'company-news',
    { symbol, from: isoDate(from), to: isoDate(to) },
    signal,
  );
  return (Array.isArray(raw) ? raw : []).map(mapFinnhubItem).filter(Boolean);
}

// One request per symbol (Finnhub has no multi-symbol company-news endpoint) — run in parallel,
// and a single symbol's request failing (bad ticker, rate limit) doesn't drop the others.
export async function fetchFinnhubCompanyNewsForSymbols(symbols, options = {}) {
  const results = await Promise.allSettled(
    symbols.map((symbol) => fetchFinnhubCompanyNews(symbol, options)),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}
