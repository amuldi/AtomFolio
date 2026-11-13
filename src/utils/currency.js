// Single shared source of truth for USD/KRW handling — before this module existed, App.jsx had
// its own local DEFAULT_USD_KRW_RATE/normalizeCurrencyCode/convertMarketValueForBase trio for
// *display* formatting only, while src/lib/portfolioAnalyticsSummary.js's resolvePosition summed
// each holding's buyAmount/marketValue as plain numbers with no currency awareness at all. That
// split is exactly how a foreign holding's totals went wrong: a US stock's buyPrice/currentPrice
// arrive in USD (quote.currency from the live-quote provider), but nothing ever converted them
// before adding them to a domestic (KRW) holding's totals — a $1,600 position was being added to a
// ₩700,000 position as if both were the same unit. Every place in the app that needs to know "is
// this KRW or USD" or "what is this worth in KRW" should import from here, not reimplement it.

// Base (display) currencies the user can pick in settings.
export const SUPPORTED_CURRENCIES = ['KRW', 'USD'];
// Every currency a *holding* can be quoted in. Anything outside KRW/USD used to normalize to ''
// and silently fall back to KRW — an Indian stock's ₹7.64 was summed as 7.64원.
export const QUOTE_CURRENCIES = [
  'KRW', 'USD', 'INR', 'JPY', 'EUR', 'GBP', 'CNY', 'HKD', 'CAD', 'AUD', 'TWD', 'SGD', 'CHF',
];
export const DEFAULT_USD_KRW_RATE = 1365;

export function normalizeCurrencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return QUOTE_CURRENCIES.includes(code) ? code : '';
}

// Exchange suffixes (Yahoo convention) whose listing currency isn't USD.
const SUFFIX_CURRENCIES = [
  [/\.(NS|BO)$/, 'INR'],
  [/\.T$/, 'JPY'],
  [/\.HK$/, 'HKD'],
  [/\.L$/, 'GBP'],
  [/\.(SS|SZ)$/, 'CNY'],
  [/\.(TO|V)$/, 'CAD'],
  [/\.AX$/, 'AUD'],
  [/\.(TW|TWO)$/, 'TWD'],
  [/\.SI$/, 'SGD'],
  [/\.SW$/, 'CHF'],
  [/\.(PA|DE|AS|MI|MC|BR|F)$/, 'EUR'],
];

// A US-style ticker (letters only, optional short suffix like ".TO"/"-B") reads as USD; a 5-6
// digit KRX code (with or without a .KS/.KQ suffix) reads as KRW. This is only a fallback for
// holdings that haven't been matched to a live quote yet (or never will be, e.g. offline/edge-case
// tickers) — a real quote's own `currency` field always wins when one is available, see
// inferHoldingCurrency below.
const US_STYLE_TICKER_PATTERN = /^[A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;
const KR_STYLE_CODE_PATTERN = /^\d{5,6}(?:\.(?:KS|KQ))?$/;

function inferCurrencyFromTicker(ticker) {
  const value = String(ticker ?? '').trim().toUpperCase();
  if (!value) {
    return '';
  }
  if (KR_STYLE_CODE_PATTERN.test(value)) {
    return 'KRW';
  }
  const suffixMatch = SUFFIX_CURRENCIES.find(([pattern]) => pattern.test(value));
  if (suffixMatch) {
    return suffixMatch[1];
  }
  if (US_STYLE_TICKER_PATTERN.test(value)) {
    return 'USD';
  }
  return '';
}

// Resolves the currency a given holding's buyPrice/currentPrice/marketValue figures are actually
// denominated in, in priority order:
//   1. An explicit currency already recorded on the item (set by a live quote's own
//      `quote.currency`, or an explicit "통화"/"currency" CSV column) — the most trustworthy
//      signal, since it reflects where the security actually trades.
//   2. A ticker-shape guess (US-style letters -> USD, KR-style 5-6 digit code -> KRW) — used when
//      no live quote has resolved yet, or never will.
//   3. KRW, as the app's long-standing default for anything unrecognized.
export function inferHoldingCurrency(item) {
  const explicit =
    normalizeCurrencyCode(item?.currency) ||
    normalizeCurrencyCode(item?.marketCurrency) ||
    normalizeCurrencyCode(item?.fields?.find?.((field) => /^(통화|currency)$/i.test(String(field?.label ?? '').trim()))?.value);

  if (explicit) {
    return explicit;
  }

  const ticker = String(item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim();
  const inferred = inferCurrencyFromTicker(ticker);

  return inferred || 'KRW';
}

// krwRates: { INR: 14.15, JPY: 8.3, ... } — KRW per one unit of each extra currency (Yahoo's
// `${CODE}KRW=X`). Every currency gets direct rates to/from KRW and USD; other pairs are crossed
// through KRW in convertCurrencyAmount.
export function buildFxRates(usdKrwRate = DEFAULT_USD_KRW_RATE, krwRates = {}) {
  const numeric = Number(usdKrwRate);
  const rate = Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_USD_KRW_RATE;
  const rates = {
    USD: { KRW: rate },
    KRW: { USD: 1 / rate },
  };

  for (const [code, value] of Object.entries(krwRates ?? {})) {
    const currency = normalizeCurrencyCode(code);
    const toKrw = Number(value);
    if (!currency || currency === 'KRW' || currency === 'USD' || !Number.isFinite(toKrw) || toKrw <= 0) {
      continue;
    }
    rates[currency] = { KRW: toKrw, USD: toKrw / rate };
    rates.KRW[currency] = 1 / toKrw;
    rates.USD[currency] = rate / toKrw;
  }

  return rates;
}

// Converts a plain numeric amount from one currency to another. Returns the original value
// unconverted (not null/NaN) when no rate is available for the requested pair, matching how the
// rest of the app already prefers "show the number as-is" over "show nothing" when FX data is
// momentarily missing.
export function convertCurrencyAmount(value, fromCurrency, toCurrency, fxRates = buildFxRates()) {
  const numeric = Number(value);
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency) || from;

  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (!from || !to || from === to) {
    return numeric;
  }

  const direct = fxRates?.[from]?.[to];
  if (Number.isFinite(direct)) {
    return numeric * direct;
  }

  // Cross through KRW (e.g. INR -> JPY) when only each side's KRW rate is known.
  const viaKrw = (fxRates?.[from]?.KRW ?? (from === 'KRW' ? 1 : NaN)) * (fxRates?.KRW?.[to] ?? (to === 'KRW' ? 1 : NaN));
  return Number.isFinite(viaKrw) ? numeric * viaKrw : numeric;
}

// Currencies (other than KRW/USD, which are always fetched) whose KRW rate is needed to value the
// given holdings.
export function collectExtraQuoteCurrencies(items) {
  const found = new Set();
  for (const item of items ?? []) {
    const native = inferHoldingCurrency(item);
    const purchase = normalizeCurrencyCode(
      item?.purchaseCurrency ??
        item?.fields?.find?.((field) => /^(매수통화|purchasecurrency)$/i.test(String(field?.label ?? '').trim()))?.value,
    );
    for (const code of [native, purchase]) {
      if (code && code !== 'KRW' && code !== 'USD') {
        found.add(code);
      }
    }
  }
  return [...found].sort();
}

const KRW_FORMATTER = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const USD_FORMATTER = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Formats a plain numeric amount with its currency's own symbol/precision — KRW as a whole-won
// integer (₩1,234,000), USD with cents ($1,234.50). Kept intentionally simple (no compact/rounded
// notation) since callers that want a compact "1.2억" style summary already have their own
// formatter (formatAnalyticsCompactValue in App.jsx) layered on top of this.
export function formatCurrencyAmount(value, currency) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }

  const code = normalizeCurrencyCode(currency) || 'KRW';
  const sign = numeric < 0 ? '-' : '';
  const magnitude = Math.abs(numeric);

  if (code === 'USD') {
    return `${sign}$${USD_FORMATTER.format(magnitude)}`;
  }

  if (code !== 'KRW') {
    try {
      return `${sign}${new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(magnitude)}`;
    } catch {
      return `${sign}${magnitude.toLocaleString('en-US')} ${code}`;
    }
  }

  return `${sign}₩${KRW_FORMATTER.format(magnitude)}`;
}
