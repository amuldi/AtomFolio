// Single shared source of truth for USD/KRW handling — before this module existed, App.jsx had
// its own local DEFAULT_USD_KRW_RATE/normalizeCurrencyCode/convertMarketValueForBase trio for
// *display* formatting only, while src/lib/portfolioAnalyticsSummary.js's resolvePosition summed
// each holding's buyAmount/marketValue as plain numbers with no currency awareness at all. That
// split is exactly how a foreign holding's totals went wrong: a US stock's buyPrice/currentPrice
// arrive in USD (quote.currency from the live-quote provider), but nothing ever converted them
// before adding them to a domestic (KRW) holding's totals — a $1,600 position was being added to a
// ₩700,000 position as if both were the same unit. Every place in the app that needs to know "is
// this KRW or USD" or "what is this worth in KRW" should import from here, not reimplement it.

export const SUPPORTED_CURRENCIES = ['KRW', 'USD'];
export const DEFAULT_USD_KRW_RATE = 1365;

export function normalizeCurrencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code) ? code : '';
}

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

export function buildFxRates(usdKrwRate = DEFAULT_USD_KRW_RATE) {
  const numeric = Number(usdKrwRate);
  const rate = Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_USD_KRW_RATE;

  return {
    USD: { KRW: rate },
    KRW: { USD: 1 / rate },
  };
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

  const rate = fxRates?.[from]?.[to];

  return Number.isFinite(rate) ? numeric * rate : numeric;
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

  return `${sign}₩${KRW_FORMATTER.format(magnitude)}`;
}
