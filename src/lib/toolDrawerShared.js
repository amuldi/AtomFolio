// Helpers shared between App.jsx and the tool-drawer component family
// (ToolSideDrawer.jsx, MarketPreview.jsx) — split out of App.jsx rather than left there so
// neither side has to import from the other (App.jsx default-exports the App component;
// importing plain helpers back out of it would make App.jsx <-> ToolSideDrawer.jsx a real
// circular import).
//
// compactLabel here is deliberately NOT the same function as utils/format.js's own
// compactLabel — that one treats value 0/false as blank ('') via String(value ?? ''), this
// one returns '' for ANY falsy value including 0. Different behavior, not yet reconciled;
// kept exactly as it already behaved in App.jsx rather than silently switched to the other
// implementation during this split.
import {
  buildFxRates,
  convertCurrencyAmount,
  DEFAULT_USD_KRW_RATE,
  inferHoldingCurrency,
  normalizeCurrencyCode as normalizeCurrencyCodeShared,
} from '../utils/currency.js';
import { formatMarketPrice } from './liveMarketData.js';
import { isPortfolioAtomItem, explainExcludedPortfolioAtomItem } from '../utils/portfolioItems.js';

export const MAX_PORTFOLIOS = 20;
export const TOOL_DRAWER_DEFAULT_WIDTH = 522;
export const DEFAULT_REBALANCE_TARGET_WEIGHTS = {
  stock: 60,
  dividend: 15,
  goldCash: 15,
  reit: 5,
  other: 5,
};

// Used by both App.jsx's own buildImportRecordFromPortfolioEntry (the sync-history record) and
// ToolSideDrawer's buildUploadReviewPreview (the upload-diagnostics banner) — the two places that
// turn a portfolio entry's raw agentReview/parserDiagnostics fields into one settled status.
export function resolveEntryReviewStatus(entry) {
  if (!entry) {
    return 'ok';
  }

  if (
    entry.ingestSource === 'client-local-fallback' ||
    entry.ingestSource === 'server-with-local-timeline'
  ) {
    return entry.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review';
  }

  return entry.agentReview?.status ?? entry.parserDiagnostics?.reviewStatus ?? 'ok';
}

export function formatDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function parseManualPriceValue(value) {
  const match = String(value ?? '')
    .replace(/,/g, '')
    .match(/[+-]?\d*\.?\d+/);
  const numeric = Number.parseFloat(match?.[0] ?? '');

  return Number.isFinite(numeric) ? numeric : NaN;
}

function parseSignedDisplayValue(value) {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/[−–—]/g, '-');
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const shouldNegate = /^\(.*\)$/.test(trimmed) || /(?:손실|loss|▼|↓)/i.test(trimmed);
  return shouldNegate && numeric > 0 ? -numeric : numeric;
}

export function getSignedValueToneClass(value, positiveClass = 'is-up', negativeClass = 'is-down') {
  const numeric = parseSignedDisplayValue(value);

  if (numeric > 0) {
    return positiveClass;
  }

  if (numeric < 0) {
    return negativeClass;
  }

  return '';
}

// DEFAULT_USD_KRW_RATE now comes from utils/currency.js — the one shared constant every currency
// conversion in the app (this file's own display formatting and
// lib/portfolioAnalyticsSummary.js's totals math) is built on top of.
export const DEFAULT_DISPLAY_FX_RATES = buildFxRates(DEFAULT_USD_KRW_RATE);

export function compactLabel(value, max = 18) {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function summarizePortfolioEntryAccounts(entry, language) {
  const sourceItems = (entry?.timelineItems?.length ? entry.timelineItems : entry?.items) ?? [];
  const labels = [];

  sourceItems.forEach((item) => {
    const rawLabel =
      item?.accountType ??
      item?.accountId ??
      item?.account ??
      item?.accountName ??
      item?.accountLabel ??
      '';
    const label = String(rawLabel).trim();

    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  });

  const visibleLabels = labels.slice(0, 3).map((label) => compactLabel(label, 12));
  const extraCount = Math.max(0, labels.length - visibleLabels.length);
  const accountText = visibleLabels.length
    ? `${visibleLabels.join(', ')}${extraCount ? ` +${extraCount}` : ''}`
    : language === 'en'
      ? 'Unclassified portfolio'
      : '포트폴리오 정보 없음';
  const rowCount = sourceItems.length;
  const items = entry?.items ?? [];
  const securityCount = items.length;
  const atomVisibleItems = items.filter((item) => isPortfolioAtomItem(item));
  const atomVisibleCount = atomVisibleItems.length;
  // Only populated when something was actually excluded — summarizePortfolioEntryAccounts runs on
  // every render of every account-list card, so skip building the reason list on the (common) path
  // where every parsed item made it into the atom scene.
  const excludedItems =
    atomVisibleCount < securityCount
      ? items
          .filter((item) => !isPortfolioAtomItem(item))
          .map((item) => ({
            label: item?.label || item?.stockName || item?.name || '(이름 없음)',
            reason: explainExcludedPortfolioAtomItem(item),
          }))
      : [];

  return {
    accountText,
    rowCount,
    securityCount,
    atomVisibleCount,
    excludedItems,
  };
}

export function buildMarketSparklinePath(points, width = 320, height = 138) {
  const validPoints = points.filter((point) => Number.isFinite(point.close)).slice(-96);

  if (validPoints.length < 2) {
    return null;
  }

  const paddingX = 10;
  const paddingY = 12;
  const values = validPoints.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, Math.abs(max) * 0.01);
  const step = (width - paddingX * 2) / Math.max(1, validPoints.length - 1);
  const coords = validPoints.map((point, index) => {
    const x = paddingX + step * index;
    const y = height - paddingY - ((point.close - min) / range) * (height - paddingY * 2);
    return {
      x,
      y,
      time: point.time,
      close: point.close,
    };
  });
  const line = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${coords.at(-1).x.toFixed(2)} ${height - paddingY} L${coords[0].x.toFixed(2)} ${height - paddingY} Z`;

  return { line, area, min, max, latest: values.at(-1), first: values[0], points: coords };
}

export function buildMarketInfoUrl(data) {
  const symbol = String(data?.symbol ?? '')
    .trim()
    .toUpperCase();

  if (!symbol) {
    return '';
  }

  const koreanCodeMatch = symbol.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);

  if (koreanCodeMatch) {
    return `https://finance.naver.com/item/main.naver?code=${koreanCodeMatch[1]}`;
  }

  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

export function formatMarketPointTime(value, language = 'ko') {
  if (!Number.isFinite(Number(value))) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(value)));
}

export function resolveMarketDisplayName(data) {
  return String(data?.displayName ?? data?.name ?? data?.rawName ?? data?.symbol ?? '').trim();
}

// Thin wrappers kept under their original names (used all over this file) so every existing call
// site stays untouched — the actual currency logic now lives in utils/currency.js, the one shared
// standard both this file and lib/portfolioAnalyticsSummary.js build on, instead of each keeping
// its own slightly-different copy.
export function normalizeCurrencyCode(value) {
  return normalizeCurrencyCodeShared(value);
}

// Resolves which currency the manual-entry "매수가" (buy price) field should be treated/labeled
// as, so the input can show an explicit "USD"/"원" unit instead of leaving it ambiguous (the root
// UX cause of the buy-price/live-price currency mismatch: a plain number field with no unit lets a
// user type a KRW-scale number for a US stock without any signal that it should be USD). A resolved
// live quote's own currency wins when available; otherwise falls back to the same ticker-shape
// inference used for portfolio totals, so the label is already correct before a quote even loads.
export function resolveManualBuyPriceCurrency(ticker, marketData) {
  return normalizeCurrencyCode(marketData?.currency) || inferHoldingCurrency({ ticker }) || 'KRW';
}

export function inferCurrencyFromText(value) {
  const text = String(value ?? '').trim();

  if (/₩|KRW|원/i.test(text)) {
    return 'KRW';
  }

  if (/\$|USD|달러/i.test(text)) {
    return 'USD';
  }

  return '';
}

export function normalizeUsdKrwRate(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_USD_KRW_RATE;
}

export function buildDisplayFxRates(usdKrwRate = DEFAULT_USD_KRW_RATE) {
  return buildFxRates(normalizeUsdKrwRate(usdKrwRate));
}

export function convertMarketValueForBase(
  value,
  sourceCurrency,
  baseCurrency,
  fxRates = DEFAULT_DISPLAY_FX_RATES,
) {
  const numeric = parseManualPriceValue(value);
  const source = normalizeCurrencyCode(sourceCurrency);
  const target = normalizeCurrencyCode(baseCurrency) || source;

  if (!Number.isFinite(numeric)) {
    return { value: null, currency: target || source };
  }

  if (!source || !target || source === target) {
    return { value: numeric, currency: target || source };
  }

  const rate = fxRates?.[source]?.[target];

  if (!Number.isFinite(rate)) {
    return { value: numeric, currency: source };
  }

  return { value: convertCurrencyAmount(numeric, source, target, fxRates), currency: target };
}

export function formatMarketPriceForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const converted = convertMarketValueForBase(value, sourceCurrency, baseCurrency, fxRates);

  return formatMarketPrice(converted.value, converted.currency);
}

export function formatMarketChangeForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const converted = convertMarketValueForBase(value, sourceCurrency, baseCurrency, fxRates);

  if (!Number.isFinite(converted.value)) {
    return '-';
  }

  const sign = converted.value > 0 ? '+' : converted.value < 0 ? '-' : '';

  return `${sign}${formatMarketPrice(Math.abs(converted.value), converted.currency)}`;
}

export function formatMoneyMetricForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '-';
  }

  const numeric = parseManualPriceValue(trimmed);

  if (!Number.isFinite(numeric)) {
    return trimmed;
  }

  return formatMarketPriceForBase(
    numeric,
    inferCurrencyFromText(trimmed) || sourceCurrency,
    baseCurrency,
    fxRates,
  );
}

export function formatFinancialMetricMeta(metric, language = 'ko') {
  const periodEnd = metric?.periodEnd
    ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
        year: 'numeric',
        month: 'short',
      }).format(new Date(metric.periodEnd))
    : '';
  const parts = [metric?.period, periodEnd, metric?.form].filter(Boolean);

  return parts.join(' · ');
}
