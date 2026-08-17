// Ticker/company preview widgets rendered inside the tool drawer's manual-add flow — split
// out of App.jsx alongside ToolSideDrawer.jsx, their only consumer.
import { useCallback, useEffect, useState } from 'react';
import { fetchCompanyFinancials } from '../../lib/companyFinancials.js';
import {
  fetchLiveMarketData,
  formatMarketChangePercent,
  formatMarketTime,
} from '../../lib/liveMarketData.js';
import {
  DEFAULT_DISPLAY_FX_RATES,
  buildMarketInfoUrl,
  buildMarketSparklinePath,
  compactLabel,
  formatFinancialMetricMeta,
  formatMarketChangeForBase,
  formatMarketPointTime,
  formatMarketPriceForBase,
  formatMoneyMetricForBase,
  getSignedValueToneClass,
  resolveMarketDisplayName,
} from '../../lib/toolDrawerShared.js';
import { formatCurrencyAmount } from '../../utils/currency.js';
import {
  resolveHoldingAccount,
  resolveHoldingMetric,
  resolveHoldingName,
  resolveHoldingTicker,
} from '../../utils/holdings.js';
import { resolveHoldingPosition } from '../../lib/portfolioAnalyticsSummary.js';

export function CompanyFinancialsPreview({ financials, status, error, language }) {
  const sections = Array.isArray(financials?.sections)
    ? financials.sections.filter((section) => section?.metrics?.length)
    : [];
  const sourceLinks = Array.isArray(financials?.sourceUrls)
    ? financials.sourceUrls.filter((source) => source?.url)
    : [];
  const hasSections = sections.length > 0;
  const title = language === 'en' ? 'Company Financials' : '기업 재무정보';

  if (status === 'idle') {
    return null;
  }

  return (
    <div className={`tool-drawer__financials is-${status}`}>
      <div className="tool-drawer__financials-head">
        <strong>{title}</strong>
        <small>
          {status === 'loading'
            ? language === 'en'
              ? 'checking filings'
              : '공시 확인 중'
            : financials?.updatedAt
              ? formatMarketTime(financials.updatedAt, language)
              : ''}
        </small>
      </div>

      {status === 'loading' ? (
        <p className="tool-drawer__financials-message">
          {language === 'en'
            ? 'Loading verified financial data.'
            : '확인 가능한 재무정보를 불러오는 중입니다.'}
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="tool-drawer__financials-message">
          {error ||
            (language === 'en'
              ? 'Could not load financial data.'
              : '재무정보를 가져오지 못했습니다.')}
        </p>
      ) : null}

      {status === 'empty' ? (
        <p className="tool-drawer__financials-message">
          {language === 'en'
            ? 'No verifiable company financials are available for this ticker.'
            : '이 티커에서 확인 가능한 기업 재무정보가 없습니다.'}
        </p>
      ) : null}

      {hasSections ? (
        <div className="tool-drawer__financials-sections">
          {sections.slice(0, 2).map((section) => (
            <section key={section.key} className="tool-drawer__financials-section">
              <div className="tool-drawer__financials-section-head">
                <strong>{section.title}</strong>
                <small>{section.source}</small>
              </div>
              <dl className="tool-drawer__financials-grid">
                {section.metrics.slice(0, 8).map((metric) => (
                  <div
                    key={`${section.key}-${metric.key}`}
                    className="tool-drawer__financial-metric"
                  >
                    <dt>{metric.label}</dt>
                    <dd>
                      <strong>{metric.displayValue || '-'}</strong>
                      <span>{formatFinancialMetricMeta(metric, language)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : null}

      {sourceLinks.length ? (
        <div className="tool-drawer__financials-source">
          <span>{language === 'en' ? 'Source' : '출처'}</span>
          {sourceLinks.slice(0, 2).map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MarketLivePreview({
  data,
  status,
  error,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  onApplyQuote,
  showApply = true,
  showStats = true,
}) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [financialsStatus, setFinancialsStatus] = useState('idle');
  const [financialsError, setFinancialsError] = useState('');
  const isLoading = status === 'loading';
  const hasData = Boolean(data);
  const path = hasData ? buildMarketSparklinePath(data.points ?? []) : null;
  const changeAmountText = hasData
    ? formatMarketChangeForBase(data.change, data.currency, baseCurrency, fxRates)
    : '';
  const changePercentText = hasData ? formatMarketChangePercent(data.changePercent) : '';
  const tone = getSignedValueToneClass(data?.changePercent);
  const marketUrl = buildMarketInfoUrl(data);
  const displayName = resolveMarketDisplayName(data);

  const handleChartPointerMove = useCallback(
    (event) => {
      if (!path?.points?.length) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 320;
      const nearest = path.points.reduce((closest, point) =>
        Math.abs(point.x - relativeX) < Math.abs(closest.x - relativeX) ? point : closest,
      );

      setHoveredPoint(nearest);
    },
    [path],
  );

  useEffect(() => {
    const symbol = String(data?.symbol ?? '').trim();

    if (!hasData || !symbol) {
      setFinancials(null);
      setFinancialsStatus('idle');
      setFinancialsError('');
      return undefined;
    }

    const controller = new AbortController();
    setFinancialsStatus('loading');
    setFinancialsError('');

    fetchCompanyFinancials({
      ticker: symbol,
      name: displayName,
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }

        setFinancials(payload);
        setFinancialsStatus(
          payload?.status === 'empty' || !payload?.sections?.length ? 'empty' : 'ready',
        );
      })
      .catch((financialsFetchError) => {
        if (controller.signal.aborted || financialsFetchError?.name === 'AbortError') {
          return;
        }

        setFinancials(null);
        setFinancialsStatus('error');
        setFinancialsError(
          language === 'en'
            ? 'Could not load company financials.'
            : '기업 재무정보를 가져오지 못했습니다.',
        );
      });

    return () => {
      controller.abort();
    };
  }, [data?.symbol, displayName, hasData, language]);

  const handleChartOpen = useCallback(() => {
    if (!marketUrl || typeof window === 'undefined') {
      return;
    }

    window.open(marketUrl, '_blank', 'noopener,noreferrer');
  }, [marketUrl]);

  if (!hasData && status === 'idle') {
    return (
      <section className="tool-drawer__market-preview is-empty">
        <p>
          {language === 'en'
            ? 'Enter a ticker to load live market data and a chart.'
            : '티커/코드를 입력하면 실시간 시세와 차트가 표시됩니다.'}
        </p>
      </section>
    );
  }

  return (
    <section className={`tool-drawer__market-preview${tone ? ` ${tone}` : ''}`}>
      <div className="tool-drawer__market-head">
        <span>
          <strong>{hasData ? data.symbol : language === 'en' ? 'Loading' : '조회 중'}</strong>
          <em title={displayName}>{hasData ? displayName : ''}</em>
        </span>
        <small>
          {isLoading
            ? language === 'en'
              ? 'updating'
              : '갱신 중'
            : hasData
              ? formatMarketTime(data.updatedAt, language)
              : ''}
        </small>
      </div>

      {hasData && showStats ? (
        <div className="tool-drawer__market-stats">
          <strong>
            {formatMarketPriceForBase(data.latestPrice, data.currency, baseCurrency, fxRates)}
          </strong>
          <span>
            {changeAmountText}
            {changePercentText ? ` · ${changePercentText}` : ''}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        className="tool-drawer__market-chart"
        disabled={!marketUrl}
        onClick={handleChartOpen}
        onPointerMove={handleChartPointerMove}
        onPointerLeave={() => setHoveredPoint(null)}
        aria-label={language === 'en' ? 'Open stock information' : '주식 정보 웹으로 이동'}
      >
        {path ? (
          <svg
            viewBox="0 0 320 138"
            role="img"
            aria-label={language === 'en' ? 'Live stock chart' : '실시간 주식 차트'}
          >
            <defs>
              <linearGradient id="manualMarketArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 247, 232, 0.26)" />
                <stop offset="100%" stopColor="rgba(255, 247, 232, 0)" />
              </linearGradient>
            </defs>
            <path className="tool-drawer__market-area" d={path.area} />
            <path className="tool-drawer__market-line" d={path.line} />
            {hoveredPoint ? (
              <g className="tool-drawer__market-hover-mark" aria-hidden="true">
                <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1="8" y2="130" />
                <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.2" />
              </g>
            ) : null}
          </svg>
        ) : (
          <p>
            {error ||
              (isLoading
                ? language === 'en'
                  ? 'Loading market chart...'
                  : '시세 차트를 불러오는 중입니다.'
                : language === 'en'
                  ? 'No chart data available.'
                  : '차트 데이터를 가져오지 못했습니다.')}
          </p>
        )}
        {hoveredPoint ? (
          <span
            className="tool-drawer__market-hover"
            style={{ left: `${(hoveredPoint.x / 320) * 100}%` }}
          >
            <em>{formatMarketPointTime(hoveredPoint.time, language)}</em>
            <strong>
              {formatMarketPriceForBase(hoveredPoint.close, data?.currency, baseCurrency, fxRates)}
            </strong>
          </span>
        ) : null}
      </button>

      <CompanyFinancialsPreview
        financials={financials}
        status={financialsStatus}
        error={financialsError}
        language={language}
      />

      <div className="tool-drawer__market-foot">
        <span>{hasData ? `${data.source} · ${data.range}/${data.interval}` : error}</span>
        {showApply ? (
          <button type="button" disabled={!hasData} onClick={onApplyQuote}>
            {language === 'en' ? 'Use quote' : '현재가 적용'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function StockDetailCard({
  item,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  onEdit,
  onClose,
}) {
  const ticker = resolveHoldingTicker(item);
  const name = resolveHoldingName(item);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticker && name.length < 2) {
      setStatus('idle');
      setData(null);
      setError('');
      return undefined;
    }

    const controller = new AbortController();

    const load = async () => {
      setStatus('loading');
      setError('');

      try {
        const nextData = await fetchLiveMarketData({
          ticker,
          name,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setData(nextData);
        setStatus('ready');
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setData(null);
        setStatus('error');
        setError(
          language === 'en' ? 'Could not load details.' : '상세 시세를 가져오지 못했습니다.',
        );
      }
    };

    load();
    const intervalId = window.setInterval(load, 30000);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [language, name, ticker]);

  const shares = resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']);
  const buyPrice = resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']);
  const returnRate =
    String(item?.detail ?? item?.return ?? '').trim() ||
    resolveHoldingMetric(item, ['수익률', 'return']);
  const returnRateToneClass = getSignedValueToneClass(returnRate);
  // 평가금액/평가손익 — the two figures requirement 5 asks this card to always show. Uses the same
  // resolveHoldingPosition the holdings list row and the 요약 totals are built from, so this card
  // can never disagree with either of them about what a holding is worth.
  const position = resolveHoldingPosition(item, { baseCurrency, fxRates });
  // 매수가's own currency (position.purchaseCurrency) is *not* necessarily the same as the live
  // quote's currency (data?.currency below) — that's the whole point of purchaseCurrency being its
  // own field now (see resolvePosition's own comment in portfolioAnalyticsSummary.js). Converting
  // 매수가 for display using the quote's currency instead would silently reintroduce the same
  // currency-mixing bug just for this one card.
  const currentPriceText = data
    ? formatMarketPriceForBase(data.latestPrice, data.currency, baseCurrency, fxRates)
    : '-';
  const yesterdayChange = data
    ? `${formatMarketChangeForBase(data.change, data.currency, baseCurrency, fxRates)} ${formatMarketChangePercent(data.changePercent)}`
    : '-';
  const buyPriceText = formatMoneyMetricForBase(
    buyPrice,
    position.purchaseCurrency,
    baseCurrency,
    fxRates,
  );
  const yesterdayChangeToneClass = getSignedValueToneClass(data?.changePercent);
  const marketValueText =
    position.marketValue != null ? formatCurrencyAmount(position.marketValue, baseCurrency) : '-';
  const profitAmountText =
    position.profitAmount != null
      ? `${position.profitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.profitAmount, baseCurrency)}`
      : '-';
  const nativeProfitAmountText =
    position.nativeProfitAmount != null
      ? `${position.nativeProfitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.nativeProfitAmount, position.nativeCurrency)}`
      : null;
  const profitToneClass = getSignedValueToneClass(position.profitAmount);
  const isForeignHolding = position.nativeCurrency !== baseCurrency;

  return (
    <section className="tool-drawer__holding-detail">
      <div className="tool-drawer__holding-detail-head">
        <span>
          <strong>{compactLabel(name, 22)}</strong>
          <em>{ticker || resolveHoldingAccount(item)}</em>
        </span>
        <div className="tool-drawer__holding-detail-actions">
          <button type="button" onClick={onEdit}>
            {language === 'en' ? 'Edit' : '수정'}
          </button>
          {onClose ? (
            <button
              type="button"
              className="tool-drawer__holding-detail-close"
              onClick={onClose}
              aria-label={language === 'en' ? 'Close stock details' : '종목 정보 닫기'}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="tool-drawer__holding-metrics">
        <div>
          <span>{language === 'en' ? 'Live' : '현재가'}</span>
          <strong>{currentPriceText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Vs prev.' : '전일 대비'}</span>
          <strong className={yesterdayChangeToneClass}>{yesterdayChange}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Shares' : '보유수량'}</span>
          <strong>{shares || '-'}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Buy' : '매수가'}</span>
          <strong>{buyPriceText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Return' : '수익률'}</span>
          <strong className={returnRateToneClass}>{returnRate || '-'}</strong>
        </div>
        <div>
          <span>
            {language === 'en' ? 'Market value' : '평가금액'}
            {isForeignHolding ? ` (${baseCurrency})` : ''}
          </span>
          <strong>{marketValueText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Unrealized P/L' : '평가손익'}</span>
          <strong className={profitToneClass}>
            {profitAmountText}
            {isForeignHolding && nativeProfitAmountText ? (
              <small className="tool-drawer__holding-metrics-native">
                {nativeProfitAmountText}
              </small>
            ) : null}
          </strong>
        </div>
      </div>

      <MarketLivePreview
        data={data}
        status={status}
        error={error}
        language={language}
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onApplyQuote={() => {}}
        showApply={false}
        showStats={false}
      />
    </section>
  );
}
