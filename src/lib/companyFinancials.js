import { searchMarketSymbolSuggestions } from './liveMarketData.js';

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_COMPANY_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts';
const YAHOO_QUOTE_SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const FINANCIALS_CACHE_TTL_MS = 1000 * 60 * 10;
const SEC_TICKER_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const FINANCIALS_FETCH_TIMEOUT_MS = 9000;
const financialsCache = new Map();
const secTickerCache = {
  loadedAt: 0,
  byTicker: new Map(),
};

const SEC_CONCEPTS = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  dilutedEps: ['EarningsPerShareDiluted'],
};

function readRuntimeEnv(key) {
  return typeof globalThis !== 'undefined' ? globalThis.process?.env?.[key] ?? '' : '';
}

function withTimeout(signal, timeoutMs = FINANCIALS_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener?.('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', abort);
    },
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeout = withTimeout(options.signal);

  try {
    return await fetch(url.toString(), {
      ...options,
      signal: timeout.signal,
    });
  } finally {
    timeout.cleanup();
  }
}

function secUserAgent() {
  return readRuntimeEnv('SEC_USER_AGENT') || 'AtomFolio/1.0 contact@example.com';
}

function normalizeTicker(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeSecTicker(value) {
  return normalizeTicker(value)
    .replace(/\.(KS|KQ|BA|TO|V|DU|L|HK|SS|SZ|T)$/i, '')
    .replace(/\./g, '-');
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCompactNumber(value, currency = '') {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  const absValue = Math.abs(numeric);
  const unit =
    absValue >= 1_000_000_000_000
      ? { divisor: 1_000_000_000_000, suffix: 'T' }
      : absValue >= 1_000_000_000
        ? { divisor: 1_000_000_000, suffix: 'B' }
        : absValue >= 1_000_000
          ? { divisor: 1_000_000, suffix: 'M' }
          : { divisor: 1, suffix: '' };
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: absValue >= unit.divisor * 100 ? 0 : 1,
  }).format(numeric / unit.divisor);
  const prefix = currency === 'USD' ? '$' : currency === 'KRW' ? '₩' : '';

  return `${prefix}${formatted}${unit.suffix}`;
}

function formatPercent(value) {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;

  return `${percent > 0 ? '+' : ''}${percent.toFixed(Math.abs(percent) >= 10 ? 1 : 2)}%`;
}

function formatRatio(value, suffix = '') {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  return `${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}${suffix}`;
}

function normalizeYahooValue(value) {
  if (value && typeof value === 'object') {
    return {
      raw: toFiniteNumber(value.raw),
      fmt: String(value.fmt ?? '').trim(),
    };
  }

  return {
    raw: toFiniteNumber(value),
    fmt: '',
  };
}

async function fetchJson(url, signal, headers = {}) {
  const response = await fetchWithTimeout(url, {
    signal,
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': secUserAgent(),
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`fetch-failed:${response.status}`);
  }

  return response.json();
}

async function resolveFinancialSymbol({ ticker, name, signal }) {
  const cleanTicker = normalizeTicker(ticker);

  if (cleanTicker) {
    return {
      symbol: cleanTicker,
      name: String(name ?? '').trim(),
      source: 'input',
    };
  }

  const cleanName = String(name ?? '').trim();
  if (!cleanName) {
    throw new Error('financial-symbol-required');
  }

  const suggestions = await searchMarketSymbolSuggestions(cleanName, { signal, limit: 1 }).catch(() => []);
  const suggestion = suggestions[0];

  if (!suggestion?.symbol) {
    throw new Error('financial-symbol-not-found');
  }

  return {
    symbol: normalizeTicker(suggestion.symbol),
    name: suggestion.displayName || suggestion.rawName || suggestion.name || cleanName,
    source: 'search',
  };
}

async function loadSecTickerMap(signal) {
  if (secTickerCache.byTicker.size && Date.now() - secTickerCache.loadedAt < SEC_TICKER_CACHE_TTL_MS) {
    return secTickerCache.byTicker;
  }

  const payload = await fetchJson(SEC_TICKERS_URL, signal, {
    'user-agent': secUserAgent(),
  });
  const nextMap = new Map();

  Object.values(payload ?? {}).forEach((entry) => {
    const ticker = normalizeSecTicker(entry?.ticker);
    const cik = Number(entry?.cik_str);

    if (!ticker || !Number.isFinite(cik)) {
      return;
    }

    nextMap.set(ticker, {
      cik,
      ticker,
      title: String(entry?.title ?? '').trim(),
    });
  });

  secTickerCache.byTicker = nextMap;
  secTickerCache.loadedAt = Date.now();
  return nextMap;
}

function secFactUnits(companyFacts, concept) {
  return companyFacts?.facts?.['us-gaap']?.[concept]?.units ?? null;
}

function collectSecFactCandidates(companyFacts, concepts, units, forms) {
  const unitList = Array.isArray(units) ? units : [units];
  const formSet = new Set(forms);

  return concepts.flatMap((concept) => {
    const availableUnits = secFactUnits(companyFacts, concept);
    if (!availableUnits) {
      return [];
    }

    return unitList.flatMap((unit) => {
      const rows = Array.isArray(availableUnits[unit]) ? availableUnits[unit] : [];

      return rows
        .filter((row) => Number.isFinite(Number(row?.val)) && (!formSet.size || formSet.has(row?.form)))
        .map((row) => ({
          ...row,
          concept,
          unit,
          value: Number(row.val),
        }));
    });
  });
}

function pickLatestSecFact(companyFacts, concepts, units = 'USD', forms = ['10-K', '10-Q']) {
  const candidates = collectSecFactCandidates(companyFacts, concepts, units, forms);

  return candidates.sort((left, right) => {
    const filedDiff = Date.parse(right.filed ?? '') - Date.parse(left.filed ?? '');
    if (Number.isFinite(filedDiff) && filedDiff !== 0) {
      return filedDiff;
    }

    return Date.parse(right.end ?? '') - Date.parse(left.end ?? '');
  })[0] ?? null;
}

function pickLatestSecMetric({ companyFacts, key, label, concepts, unit = 'USD', forms = ['10-K', '10-Q'], format }) {
  const fact = pickLatestSecFact(companyFacts, concepts, unit, forms);

  if (!fact) {
    return null;
  }

  return {
    key,
    label,
    value: fact.value,
    displayValue: format ? format(fact.value) : formatCompactNumber(fact.value, fact.unit),
    currency: fact.unit === 'USD' ? 'USD' : '',
    unit: fact.unit,
    period: [fact.fy, fact.fp].filter(Boolean).join(' '),
    periodEnd: fact.end ?? '',
    filedAt: fact.filed ?? '',
    form: fact.form ?? '',
    source: 'SEC EDGAR',
    sourceUrl: companyFacts?.sourceUrl ?? '',
  };
}

async function fetchSecFinancials(symbol, signal) {
  const secTicker = normalizeSecTicker(symbol);
  if (!secTicker) {
    return null;
  }

  const tickerMap = await loadSecTickerMap(signal);
  const company = tickerMap.get(secTicker);

  if (!company) {
    return null;
  }

  const cik = String(company.cik).padStart(10, '0');
  const sourceUrl = `${SEC_COMPANY_FACTS_URL}/CIK${cik}.json`;
  const companyFactsPayload = await fetchJson(sourceUrl, signal, {
    'user-agent': secUserAgent(),
  });
  const companyFacts = {
    ...companyFactsPayload,
    sourceUrl,
  };
  const annualForms = ['10-K', '20-F', '40-F'];
  const recentForms = ['10-Q', '10-K', '20-F', '40-F'];
  const statementMetrics = [
    pickLatestSecMetric({
      companyFacts,
      key: 'revenue',
      label: '매출',
      concepts: SEC_CONCEPTS.revenue,
      forms: annualForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'operatingIncome',
      label: '영업이익',
      concepts: SEC_CONCEPTS.operatingIncome,
      forms: annualForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'netIncome',
      label: '순이익',
      concepts: SEC_CONCEPTS.netIncome,
      forms: annualForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'operatingCashFlow',
      label: '영업현금흐름',
      concepts: SEC_CONCEPTS.operatingCashFlow,
      forms: annualForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'assets',
      label: '총자산',
      concepts: SEC_CONCEPTS.assets,
      forms: recentForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'liabilities',
      label: '총부채',
      concepts: SEC_CONCEPTS.liabilities,
      forms: recentForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'equity',
      label: '자본총계',
      concepts: SEC_CONCEPTS.equity,
      forms: recentForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'cash',
      label: '현금성자산',
      concepts: SEC_CONCEPTS.cash,
      forms: recentForms,
    }),
    pickLatestSecMetric({
      companyFacts,
      key: 'dilutedEps',
      label: '희석 EPS',
      concepts: SEC_CONCEPTS.dilutedEps,
      unit: ['USD/shares', 'USD-per-shares'],
      forms: annualForms,
      format: (value) => `$${Number(value).toFixed(2)}`,
    }),
  ].filter(Boolean);

  return {
    symbol: secTicker,
    name: company.title,
    cik: company.cik,
    source: 'SEC EDGAR',
    sourceUrl,
    updatedAt: Date.now(),
    sections: statementMetrics.length
      ? [
          {
            key: 'sec-statements',
            title: '최근 공시 재무',
            source: 'SEC EDGAR',
            metrics: statementMetrics,
          },
        ]
      : [],
  };
}

async function fetchYahooFinancials(symbol, signal) {
  const cleanSymbol = normalizeTicker(symbol);
  if (!cleanSymbol) {
    return null;
  }

  const modules = 'price,summaryDetail,defaultKeyStatistics,financialData';
  const url = new URL(`${YAHOO_QUOTE_SUMMARY_URL}/${encodeURIComponent(cleanSymbol)}`);
  url.searchParams.set('modules', modules);
  const payload = await fetchJson(url.toString(), signal, {
    'user-agent': 'Mozilla/5.0 AtomFolio/1.0',
  });
  const result = payload?.quoteSummary?.result?.[0];

  if (!result) {
    return null;
  }

  const price = result.price ?? {};
  const summaryDetail = result.summaryDetail ?? {};
  const stats = result.defaultKeyStatistics ?? {};
  const financialData = result.financialData ?? {};
  const currency = String(price.currency ?? financialData.financialCurrency ?? '').trim() || 'USD';
  const metric = ({ key, label, sourceValue, formatter = 'compact', unit = '' }) => {
    const value = normalizeYahooValue(sourceValue);
    if (!Number.isFinite(value.raw) && !value.fmt) {
      return null;
    }

    const displayValue =
      value.fmt ||
      (formatter === 'percent'
        ? formatPercent(value.raw)
        : formatter === 'ratio'
          ? formatRatio(value.raw, unit)
          : formatCompactNumber(value.raw, currency));

    return {
      key,
      label,
      value: value.raw,
      displayValue,
      currency,
      unit,
      source: 'Yahoo Finance',
      filedAt: '',
      periodEnd: '',
    };
  };
  const metrics = [
    metric({ key: 'marketCap', label: '시가총액', sourceValue: price.marketCap ?? summaryDetail.marketCap }),
    metric({ key: 'enterpriseValue', label: '기업가치', sourceValue: stats.enterpriseValue }),
    metric({ key: 'totalRevenue', label: '매출(TTM)', sourceValue: financialData.totalRevenue }),
    metric({ key: 'ebitda', label: 'EBITDA', sourceValue: financialData.ebitda }),
    metric({ key: 'totalCash', label: '현금', sourceValue: financialData.totalCash }),
    metric({ key: 'totalDebt', label: '부채', sourceValue: financialData.totalDebt }),
    metric({ key: 'trailingPe', label: 'PER', sourceValue: summaryDetail.trailingPE ?? stats.trailingPE, formatter: 'ratio', unit: 'x' }),
    metric({ key: 'forwardPe', label: '선행 PER', sourceValue: summaryDetail.forwardPE ?? stats.forwardPE, formatter: 'ratio', unit: 'x' }),
    metric({ key: 'priceToBook', label: 'PBR', sourceValue: stats.priceToBook, formatter: 'ratio', unit: 'x' }),
    metric({ key: 'debtToEquity', label: '부채비율', sourceValue: financialData.debtToEquity, formatter: 'ratio' }),
    metric({ key: 'returnOnEquity', label: 'ROE', sourceValue: financialData.returnOnEquity, formatter: 'percent' }),
    metric({ key: 'profitMargins', label: '순이익률', sourceValue: financialData.profitMargins, formatter: 'percent' }),
    metric({ key: 'revenueGrowth', label: '매출 성장률', sourceValue: financialData.revenueGrowth, formatter: 'percent' }),
  ].filter(Boolean);

  return {
    symbol: normalizeTicker(price.symbol ?? cleanSymbol),
    name: String(price.longName ?? price.shortName ?? cleanSymbol).trim(),
    source: 'Yahoo Finance',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(cleanSymbol)}/key-statistics`,
    updatedAt: Date.now(),
    sections: metrics.length
      ? [
          {
            key: 'yahoo-key-statistics',
            title: '시장 재무지표',
            source: 'Yahoo Finance',
            metrics,
          },
        ]
      : [],
  };
}

function mergeFinancialPayloads({ resolved, secFinancials, yahooFinancials }) {
  const sections = [
    ...(secFinancials?.sections ?? []),
    ...(yahooFinancials?.sections ?? []),
  ].filter((section) => section.metrics?.length);
  const sourceLabels = [...new Set(sections.map((section) => section.source).filter(Boolean))];
  const sourceUrls = [
    ...(secFinancials?.sourceUrl ? [{ label: 'SEC EDGAR', url: secFinancials.sourceUrl }] : []),
    ...(yahooFinancials?.sourceUrl ? [{ label: 'Yahoo Finance', url: yahooFinancials.sourceUrl }] : []),
  ];

  return {
    symbol: yahooFinancials?.symbol || secFinancials?.symbol || resolved.symbol,
    name: yahooFinancials?.name || secFinancials?.name || resolved.name || resolved.symbol,
    updatedAt: Date.now(),
    status: sections.length ? 'ok' : 'empty',
    source: sourceLabels.join(' · '),
    sourceUrls,
    sections,
    warnings: sections.length
      ? []
      : [
          {
            code: 'financials-unavailable',
            message: '확인 가능한 기업 재무정보를 가져오지 못했습니다.',
          },
        ],
  };
}

export async function fetchCompanyFinancialsFromProviders({ ticker, name, signal } = {}) {
  const resolved = await resolveFinancialSymbol({ ticker, name, signal });
  const cacheKey = normalizeTicker(resolved.symbol || resolved.name);
  const cached = financialsCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < FINANCIALS_CACHE_TTL_MS) {
    return cached.payload;
  }

  const [secResult, yahooResult] = await Promise.allSettled([
    fetchSecFinancials(resolved.symbol, signal),
    fetchYahooFinancials(resolved.symbol, signal),
  ]);
  const secFinancials = secResult.status === 'fulfilled' ? secResult.value : null;
  const yahooFinancials = yahooResult.status === 'fulfilled' ? yahooResult.value : null;
  const payload = mergeFinancialPayloads({ resolved, secFinancials, yahooFinancials });

  financialsCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload,
  });

  return payload;
}

export async function fetchCompanyFinancials({ ticker, name, signal } = {}) {
  if (typeof window !== 'undefined') {
    const url = new URL('/api/market/financials', window.location.origin);
    const cleanTicker = String(ticker ?? '').trim();
    const cleanName = String(name ?? '').trim();

    if (cleanTicker) {
      url.searchParams.set('ticker', cleanTicker);
    }
    if (cleanName) {
      url.searchParams.set('name', cleanName);
    }

    try {
      const response = await fetchWithTimeout(url.toString(), { signal, cache: 'no-store' });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Fall through to direct providers when a local API is not available.
    }
  }

  return fetchCompanyFinancialsFromProviders({ ticker, name, signal });
}
