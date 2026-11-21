// Live prices for the 유명인 tab. A 13F lists what a fund held on the last day of a quarter and
// is published up to 45 days later, so the holdings themselves can never be "real time". What can
// be live is the price: for every holding this returns the latest price, today's move, and the
// move since the filing's period end — i.e. how that portfolio has done since the snapshot.
//
// One Yahoo daily-chart request per symbol gives all three (latest price, previous close, and the
// close on the period-end date). Results are cached for a minute and fetched a few at a time.
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const CONCURRENCY = 6;
export const MAX_SYMBOLS = 40;

const cache = new Map();

// Yahoo spells share classes with a dash (BRK-B); 13F and the app use a dot.
export function toYahooSymbol(ticker) {
  const symbol = String(ticker ?? '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '-');
  return /^[A-Z0-9][A-Z0-9-]{0,9}$/.test(symbol) && /[A-Z]/.test(symbol) ? symbol : null;
}

export function normalizeSince(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) ? text : null;
}

const percentChange = (now, before) =>
  Number.isFinite(now) && Number.isFinite(before) && before > 0
    ? Number(((now / before - 1) * 100).toFixed(2))
    : null;

// Pure: turn a Yahoo chart result into the numbers the tab shows.
export function summarizeChart(result, since) {
  const meta = result?.meta ?? {};
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const bars = [];
  stamps.forEach((stamp, index) => {
    if (Number.isFinite(closes[index])) bars.push({ at: stamp * 1000, close: closes[index] });
  });
  const last = bars.at(-1);
  const price = Number.isFinite(meta.regularMarketPrice)
    ? meta.regularMarketPrice
    : (last?.close ?? null);
  if (!Number.isFinite(price)) return null;
  // The newest bar is the current (or latest finished) session, so the day before it is the
  // reference for today's move.
  const previous = bars.length >= 2 ? bars[bars.length - 2].close : null;
  let periodClose = null;
  if (since) {
    const cutoff = Date.parse(`${since}T23:59:59Z`);
    for (const bar of bars) {
      if (bar.at <= cutoff) periodClose = bar.close;
      else break;
    }
  }
  return {
    price: Number(price.toFixed(4)),
    currency: meta.currency ?? 'USD',
    dayPct: percentChange(price, previous),
    sincePct: percentChange(price, periodClose),
    periodClose: Number.isFinite(periodClose) ? Number(periodClose.toFixed(4)) : null,
    marketState: meta.marketState ?? null,
    asOf: Number.isFinite(meta.regularMarketTime)
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null,
  };
}

async function fetchOne(symbol, since) {
  const key = `${symbol}|${since ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const url = new URL(`${YAHOO_CHART}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '1y');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('includePrePost', 'false');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 AtomFolio' },
    });
    if (!response.ok) throw new Error(`quote-fetch-failed:${response.status}`);
    const payload = await response.json();
    const value = summarizeChart(payload?.chart?.result?.[0], since);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

// tickers: app-style tickers (AAPL, BRK.B). Unknown or failed symbols are simply left out.
export async function fetchGuruQuotes(tickers, { since = null } = {}) {
  const wanted = new Map();
  for (const ticker of tickers) {
    const symbol = toYahooSymbol(ticker);
    if (symbol && !wanted.has(ticker)) wanted.set(ticker, symbol);
    if (wanted.size >= MAX_SYMBOLS) break;
  }
  const entries = [...wanted.entries()];
  const quotes = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const [ticker, symbol] = entries[cursor++];
      try {
        const quote = await fetchOne(symbol, since);
        if (quote) quotes[ticker] = quote;
      } catch {
        // one symbol failing must not take the others down
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { quotes, since, fetchedAt: new Date().toISOString() };
}
