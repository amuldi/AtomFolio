// The side drawer that holds every 'tool' (계좌/요약/모의/뉴스/설정 tabs) — the single
// largest piece of what used to be App.jsx, split out on its own since nothing outside this
// file renders any of it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAllocationPercent, textFor } from '../../utils/format.js';
import { clamp } from '../../utils/math.js';
import { convertCurrencyAmount, formatCurrencyAmount } from '../../utils/currency.js';
import {
  buildGroupedHoldingItems,
  formatHoldingListMeta,
  resolveHoldingAccount,
  resolveHoldingMetric,
  resolveHoldingName,
  resolveHoldingTicker,
} from '../../utils/holdings.js';
import {
  fetchLiveMarketData,
  fetchMarketSymbolSuggestions,
  formatMarketChangePercent,
  formatMarketInputPrice,
  formatMarketPrice,
  formatMarketTime,
} from '../../lib/liveMarketData.js';
import {
  createPortfolioAnalyticsSummary,
  resolveHoldingPosition,
} from '../../lib/portfolioAnalyticsSummary.js';
import { createPortfolioScorecard } from '../../lib/portfolioScoring.js';
import {
  SketchGearIcon,
  SketchBurstIcon,
  SketchTwinIcon,
  SketchAccountStackIcon,
  SketchManualAccountIcon,
  SketchNewsIcon,
} from './icons.jsx';
import { MarketLivePreview, StockDetailCard } from './MarketPreview.jsx';
import { MarketNewsPanel } from './MarketNewsPanel.jsx';
import { HeatmapCard as HeatmapCardView } from '../cards/HeatmapCard.jsx';
import { PortfolioScoreCard as PortfolioScoreCardView } from '../cards/PortfolioScoreCard.jsx';
import { PortfolioAllocationCard as PortfolioAllocationCardView } from '../allocation/index.jsx';
import DigitalTwinPanel from '../panels/DigitalTwinPanel.jsx';
import {
  DEFAULT_DISPLAY_FX_RATES,
  DEFAULT_REBALANCE_TARGET_WEIGHTS,
  MAX_PORTFOLIOS,
  TOOL_DRAWER_DEFAULT_WIDTH,
  compactLabel,
  formatDateKey,
  getSignedValueToneClass,
  normalizeCurrencyCode,
  parseManualPriceValue,
  resolveEntryReviewStatus,
  resolveManualBuyPriceCurrency,
  resolveMarketDisplayName,
  summarizePortfolioEntryAccounts,
} from '../../lib/toolDrawerShared.js';

const TOOL_DRAWER_MAX_WIDTH = 760;

// How close the cursor has to get to a screen edge, while dragging the drawer's dock handle,
// before that edge highlights as the drop target. Top is deliberately never a candidate — there's
// nothing at the top of this app worth docking under (the 탐색/관리 toggle lives there).
const DOCK_EDGE_HOVER_THRESHOLD_PX = 80;

// Drag-to-dock release snap duration range — see settlePanel's durationMs formula in
// handleDockDragPointerDown for how release velocity scales between these two.
const DOCK_DRAG_SNAP_DURATION_MS = 320;
const DOCK_DRAG_SNAP_MIN_DURATION_MS = 140;

function reviewStatusLabel(text, status) {
  if (status === 'blocked') {
    return text.reviewStatusBlocked;
  }

  if (status === 'needs-review') {
    return text.reviewStatusNeedsReview;
  }

  return text.reviewStatusOk;
}

function buildUploadReviewPreview(entry) {
  if (!entry) {
    return null;
  }

  const status = resolveEntryReviewStatus(entry);
  if (status === 'ok') {
    return null;
  }

  const summary = String(entry.agentReview?.summary ?? '').trim();
  const warnings = (entry.agentReview?.warnings ?? entry.parserDiagnostics?.warnings ?? [])
    .filter((warning) => String(warning?.message ?? '').trim())
    .slice(0, 3);

  if (!summary && !warnings.length) {
    return null;
  }

  return {
    status,
    summary,
    warnings,
  };
}

function compactFileName(fileName, max = 18) {
  const cleanName = String(fileName ?? '').trim();

  if (!cleanName || cleanName.length <= max) {
    return cleanName;
  }

  const extensionMatch = cleanName.match(/(\.[^.]{1,5})$/);
  const extension = extensionMatch?.[1] ?? '';
  const baseName = extension ? cleanName.slice(0, -extension.length) : cleanName;
  const extensionBudget = extension ? extension.length : 0;
  const availableBase = Math.max(6, max - extensionBudget - 1);
  const frontLength = Math.max(4, Math.ceil(availableBase * 0.58));
  const backLength = Math.max(3, availableBase - frontLength);

  if (baseName.length <= frontLength + backLength + 1) {
    return `${compactLabel(baseName, max - extensionBudget)}${extension}`;
  }

  return `${baseName.slice(0, frontLength)}…${baseName.slice(-backLength)}${extension}`;
}

function formatAnalyticsCompactValue(value, language = 'ko') {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const absoluteValue = Math.abs(value);
  const formatter = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    maximumFractionDigits: absoluteValue >= 100000 ? 1 : 0,
    notation: absoluteValue >= 100000 ? 'compact' : 'standard',
  });

  return formatter.format(value);
}

function formatAnalyticsSignedValue(value, language = 'ko') {
  if (!Number.isFinite(value)) {
    return '-';
  }

  return (value > 0 ? '+' : '') + formatAnalyticsCompactValue(value, language);
}

function formatAnalyticsPercentValue(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const fixed = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return (value > 0 ? '+' : '') + trimmed + '%';
}

function concentrationLevelLabel(level, language = 'ko') {
  if (language === 'en') {
    return level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low';
  }

  return level === 'high' ? '높음' : level === 'medium' ? '보통' : '낮음';
}

// Same-currency case only (buyPriceValue and latestPrice already denominated the same way) — the
// return% is then completely exchange-rate-independent, since the currency unit cancels out of
// the ratio. Kept as its own function (rather than folded into
// calculateManualReturnRatePreview below) because it's still exactly right on its own whenever
// there's no cross-currency question to begin with — e.g. every domestic holding.
function calculateReturnRateFromBuyPrice(buyPriceValue, latestPrice) {
  const buyPrice = parseManualPriceValue(buyPriceValue);
  const currentPrice = Number(latestPrice);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(currentPrice)) {
    return '';
  }

  return formatMarketChangePercent(((currentPrice - buyPrice) / buyPrice) * 100);
}

// Mirrors resolvePosition's own same-currency-vs-cross-currency split (portfolioAnalyticsSummary.js)
// so the manual-entry form's live 수익률 preview can never disagree with what actually gets
// computed once the holding is saved. shares deliberately isn't a parameter — it's a common
// multiplicative factor on both the buy and market amount, so it cancels out of the ratio
// regardless of what it is, the same way calculateReturnRateFromBuyPrice above never needed it.
function calculateManualReturnRate(
  buyPriceValue,
  purchaseCurrency,
  latestPrice,
  nativeCurrency,
  fxRates,
) {
  if (!purchaseCurrency || !nativeCurrency || purchaseCurrency === nativeCurrency) {
    return calculateReturnRateFromBuyPrice(buyPriceValue, latestPrice);
  }

  const buyPrice = parseManualPriceValue(buyPriceValue);
  const currentPrice = Number(latestPrice);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(currentPrice)) {
    return '';
  }

  const buyPriceKrw = convertCurrencyAmount(buyPrice, purchaseCurrency, 'KRW', fxRates);
  const currentPriceKrw = convertCurrencyAmount(currentPrice, nativeCurrency, 'KRW', fxRates);

  if (!Number.isFinite(buyPriceKrw) || buyPriceKrw <= 0 || !Number.isFinite(currentPriceKrw)) {
    return '';
  }

  return formatMarketChangePercent(((currentPriceKrw - buyPriceKrw) / buyPriceKrw) * 100);
}

function excludedAtomReasonLabel(reason, language) {
  if (language === 'en') {
    switch (reason) {
      case 'invalid-item':
        return 'unreadable row';
      default:
        return 'no recognizable name, ticker, or holding data';
    }
  }

  switch (reason) {
    case 'invalid-item':
      return '읽을 수 없는 행';
    default:
      return '알아볼 수 있는 이름·티커·보유 데이터 없음';
  }
}

export function ToolSideDrawer({
  open,
  activeTool,
  onSelectTool,
  groupOptions,
  activeGroupKey,
  onGroupChange,
  heatmap,
  allocation,
  analyticsSummary,
  scorecard,
  overallScorecard,
  scoreAxes,
  scoreWeightPreset,
  onScoreWeightPresetChange,
  items,
  timelineItems,
  portfolioEntries = [],
  activePortfolio = null,
  activePortfolioId,
  onSelectPortfolio,
  onFocusHolding,
  onClearHoldingFocus,
  onClearPortfolio,
  onOpenPortfolioPicker,
  onCreateManualAtom,
  onCreateManualPortfolio,
  onAppendManualHoldings,
  onUpdatePortfolioHolding,
  onRemovePortfolioHolding,
  pendingManualTicker = null,
  drawerWidth = TOOL_DRAWER_DEFAULT_WIDTH,
  onDrawerWidthChange,
  dock = 'left',
  onDockChange,
  onDockDragHoverEdgeChange,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  dateBasis = 'kst',
  layerStyle,
  onInteract,
  renderSettingsPanel,
}) {
  const text = textFor(language);
  // Imperative target for the drag-to-dock gesture's live follow + release settle (see
  // handleDockDragPointerDown) — mutated directly via style.transform on every pointermove/on
  // release, never through React state, so a 60fps drag doesn't mean 60fps of re-renders.
  const panelRef = useRef(null);
  const [resizing, setResizing] = useState(false);
  const [manualAccountName, setManualAccountName] = useState('');
  const [manualStockName, setManualStockName] = useState('');
  const [manualTicker, setManualTicker] = useState('');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  // Which currency the *user* means by whatever's typed into 매수가 — null follows the resolved
  // security's own currency (resolveManualBuyPriceCurrency), 'USD'/'KRW' is an explicit override
  // from the toggle next to the field. Needed because a static "USD" label alone isn't enough:
  // Korean users very commonly think of (and type) a foreign holding's buy price in 원 terms even
  // when the field is labeled USD — see handleManualBuyPriceChange's own comment for the bug this
  // caused (a real QQQM buy price of 370,000원 typed into a USD-labeled field, compared directly
  // against the ~$300 native quote, produced a nonsensical -99.9% return).
  const [manualBuyPriceCurrencyOverride, setManualBuyPriceCurrencyOverride] = useState(null);
  const [manualShares, setManualShares] = useState('');
  const [manualReturnRate, setManualReturnRate] = useState('');
  const [manualAssetClass, setManualAssetClass] = useState('주식');
  const [manualRows, setManualRows] = useState([]);
  const [manualMarketData, setManualMarketData] = useState(null);
  const [manualMarketStatus, setManualMarketStatus] = useState('idle');
  const [manualMarketError, setManualMarketError] = useState('');
  const [manualMarketSuggestions, setManualMarketSuggestions] = useState([]);
  const [manualSuggestionStatus, setManualSuggestionStatus] = useState('idle');
  const [manualSuggestionLocked, setManualSuggestionLocked] = useState(false);
  const [editingHolding, setEditingHolding] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  // Whether the user has explicitly picked a 자산군 themselves for the *current* stock name/ticker
  // query — separate from what manualAssetClass currently equals, because equality alone can't
  // tell "the user chose 리츠 on purpose" apart from "리츠 is just left over from the previous
  // ticker the user looked up before this one" (a real bug: typing a new ticker after a REIT was
  // still showing 리츠 from an earlier lookup silently kept 리츠 instead of re-inferring, since the
  // old guard only ever auto-filled when the current value was blank or the '주식' default).
  // Reset to false by handleManualStockNameChange/the ticker input's own onChange (typing a new
  // query reopens auto-classification) and by clearManualStockFields (a fresh add starts clean);
  // set to true only by the 자산군 <select>'s own onChange, so it stays out of every other effect's
  // dependency array while still being read synchronously by all three auto-fill sites below.
  const manualAssetClassTouchedRef = useRef(false);
  const manualSuggestionRef = useRef(null);
  // Bumped on every loadMarketData() call below (the initial lookup and each 30s background
  // refresh tick share one AbortController for the whole effect lifetime, so controller.signal
  // .aborted alone can't tell two *different* ticks apart) — a response only gets applied if its
  // own token still matches the latest one issued, so a slow tick's response arriving after a
  // faster, later tick's can't clobber the newer data with stale numbers.
  const manualMarketRequestTokenRef = useRef(0);
  const manualDraftRef = useRef({
    stockName: '',
    ticker: '',
    buyPrice: '',
    returnRate: '',
  });
  // The security's actual trading currency (from a resolved live quote, or ticker-shape inference)
  // vs. whichever currency the user has told the 매수가 field they're typing in right now (the
  // toggle's override, or the same native currency by default). Unlike an earlier version of this
  // form, manualBuyPrice is *never* pre-converted into manualBuyPriceNativeCurrency — it's stored
  // exactly as typed, alongside manualBuyPriceEntryCurrency as its own explicit purchaseCurrency
  // field, and resolvePosition (portfolioAnalyticsSummary.js) does the currency-aware comparison at
  // read time instead, with whatever the live exchange rate is *then*. Converting once at entry
  // time turned a real, fixed cost basis (370,000원, paid once, never changes) into a synthetic
  // USD figure computed off that day's rate — which is itself a source of drift, on top of being
  // exactly the shape of number that caused the original currency-mixing bug in the first place.
  const manualBuyPriceNativeCurrency = resolveManualBuyPriceCurrency(
    manualTicker,
    manualMarketData,
  );
  const manualBuyPriceEntryCurrency =
    manualBuyPriceCurrencyOverride || manualBuyPriceNativeCurrency;
  // Command palette's "add" hands off here rather than reimplementing ticker lookup itself — see
  // App.jsx's openManualToolWithTicker. requestedAt (not just the ticker string) is what the
  // effect keys off of, so asking to add the same ticker twice in a row still seeds the field a
  // second time instead of being a no-op prop change on an unchanged string.
  const lastAppliedManualTickerRequestRef = useRef(null);
  useEffect(() => {
    if (
      !pendingManualTicker ||
      lastAppliedManualTickerRequestRef.current === pendingManualTicker.requestedAt
    ) {
      return;
    }
    lastAppliedManualTickerRequestRef.current = pendingManualTicker.requestedAt;
    setEditingHolding(null);
    setManualRows([]);
    setManualAccountName('');
    setManualStockName('');
    setManualSuggestionLocked(false);
    setManualTicker(pendingManualTicker.ticker ?? '');
    setManualBuyPriceCurrencyOverride(null);
  }, [pendingManualTicker]);
  const tools = [
    {
      key: 'accounts',
      label: language === 'en' ? 'Portfolios' : '포트폴리오 목록',
      // Short enough to sit under the icon without widening the rail — label is still the full
      // string above for aria-label/title (screen readers and the hover tooltip), this is only
      // ever rendered as small on-rail text (see tool-drawer__button-label in the JSX below).
      shortLabel: language === 'en' ? 'Funds' : '계좌',
      icon: <SketchAccountStackIcon />,
      available: true,
    },
    {
      // No rail button — reachable via the "Add Stock" button inside the accounts panel and via
      // holding-edit flows (onSelectTool('manual')). Kept in `tools` so those still resolve; just
      // not its own top-level icon, since it duplicated the button already in the accounts panel.
      key: 'manual',
      label: language === 'en' ? 'Add Stock' : '종목 추가',
      shortLabel: language === 'en' ? 'Add' : '추가',
      icon: <SketchManualAccountIcon />,
      available: true,
      hidden: true,
    },
    {
      key: 'overview',
      label: language === 'en' ? 'Overview' : '요약',
      shortLabel: language === 'en' ? 'Summary' : '요약',
      icon: <SketchBurstIcon />,
      available: Boolean(
        analyticsSummary || heatmap || allocation || scorecard || groupOptions.length,
      ),
    },
    {
      key: 'compare',
      label: language === 'en' ? 'Compare' : '비교',
      shortLabel: language === 'en' ? 'Compare' : '비교',
      icon: <SketchAccountStackIcon />,
      available: portfolioEntries.length >= 2,
    },
    {
      key: 'twin',
      label: language === 'en' ? 'Investment Simulation' : '투자 시뮬레이션',
      shortLabel: language === 'en' ? 'Sim' : '모의',
      icon: <SketchTwinIcon />,
      available: true,
    },
    {
      key: 'news',
      label: language === 'en' ? 'Market News' : '시장 뉴스',
      shortLabel: language === 'en' ? 'News' : '뉴스',
      icon: <SketchNewsIcon />,
      available: true,
    },
    {
      key: 'settings',
      label: text.settings,
      shortLabel: text.settings,
      icon: <SketchGearIcon />,
      available: true,
    },
  ].filter((tool) => tool.available);
  const resolvedTool =
    tools.find((tool) => tool.key === activeTool) ??
    tools.find((tool) => tool.key === 'accounts') ??
    null;
  const clampDrawerWidth = useCallback((nextWidth) => {
    if (typeof window === 'undefined') {
      return clamp(nextWidth, 300, TOOL_DRAWER_MAX_WIDTH);
    }

    const viewportWidth = window.innerWidth;
    const minWidth = Math.min(300, Math.max(248, viewportWidth - 72));
    const maxWidth = Math.max(minWidth, Math.min(TOOL_DRAWER_MAX_WIDTH, viewportWidth - 34));

    return clamp(nextWidth, minWidth, maxWidth);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      onDrawerWidthChange?.((current) => clampDrawerWidth(current));
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampDrawerWidth, onDrawerWidthChange]);

  useEffect(() => {
    manualDraftRef.current = {
      stockName: manualStockName,
      ticker: manualTicker,
      buyPrice: manualBuyPrice,
      returnRate: manualReturnRate,
    };
  }, [manualBuyPrice, manualReturnRate, manualStockName, manualTicker]);

  useEffect(() => {
    const query = manualStockName.trim();

    if (
      !open ||
      resolvedTool?.key !== 'manual' ||
      manualSuggestionLocked ||
      (query.length < 2 && !/[가-힣]/.test(query))
    ) {
      setManualMarketSuggestions([]);
      setManualSuggestionStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    setManualSuggestionStatus('loading');

    const timerId = window.setTimeout(async () => {
      try {
        const suggestions = await fetchMarketSymbolSuggestions({
          query,
          limit: 8,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setManualMarketSuggestions(suggestions);
        setManualSuggestionStatus('ready');
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setManualMarketSuggestions([]);
        setManualSuggestionStatus('error');
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timerId);
    };
  }, [manualStockName, manualSuggestionLocked, open, resolvedTool?.key]);

  useEffect(() => {
    const ticker = manualTicker.trim();
    const name = manualStockName.trim();

    if (!open || resolvedTool?.key !== 'manual' || (!ticker && name.length < 2)) {
      setManualMarketStatus('idle');
      setManualMarketError('');
      setManualMarketData(null);
      return undefined;
    }

    const controller = new AbortController();
    const queryKey = `${ticker}|${name}`;
    let intervalId = 0;

    const loadMarketData = async (silent = false) => {
      // One AbortController covers the whole effect lifetime (both this call and every 30s
      // background refresh tick below share it), so controller.signal.aborted alone only ever
      // tells us the *effect* ended — it can't tell two different ticks apart. A request token
      // per call is what stops a slow tick's response from landing after (and clobbering) a
      // faster, later tick's — same pattern as loadNews's own requestIdRef.
      const requestId = ++manualMarketRequestTokenRef.current;

      if (!silent) {
        setManualMarketStatus('loading');
        setManualMarketError('');
        setManualMarketData(null);
      }

      try {
        const nextData = await fetchLiveMarketData({
          ticker,
          name,
          signal: controller.signal,
        });

        if (manualMarketRequestTokenRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        setManualMarketData({ ...nextData, queryKey });
        setManualMarketStatus('ready');
        setManualMarketError('');

        const currentDraft = manualDraftRef.current;
        const nextBuyPrice =
          currentDraft.buyPrice.trim() || formatMarketInputPrice(nextData.latestPrice);
        if (!currentDraft.buyPrice.trim() && nextBuyPrice) {
          setManualBuyPrice(nextBuyPrice);
        }
        const nextReturnRate = calculateReturnRateFromBuyPrice(nextBuyPrice, nextData.latestPrice);
        if (nextReturnRate) {
          setManualReturnRate(nextReturnRate);
        }
        if (nextData.assetClass && !manualAssetClassTouchedRef.current) {
          setManualAssetClass(nextData.assetClass);
        }
      } catch {
        if (manualMarketRequestTokenRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        setManualMarketStatus('error');
        setManualMarketError(
          language === 'en'
            ? 'Could not load live market data.'
            : '실시간 시세를 가져오지 못했습니다.',
        );
        setManualMarketData(null);
      }
    };

    const timerId = window.setTimeout(() => {
      loadMarketData(false);
      intervalId = window.setInterval(() => loadMarketData(true), 30000);
    }, 520);

    return () => {
      controller.abort();
      window.clearTimeout(timerId);
      window.clearInterval(intervalId);
    };
  }, [language, manualStockName, manualTicker, open, resolvedTool?.key]);

  useEffect(() => {
    if (!manualBuyPrice.trim()) {
      setManualReturnRate('');
      return;
    }

    const nextReturnRate = calculateManualReturnRate(
      manualBuyPrice,
      manualBuyPriceEntryCurrency,
      manualMarketData?.latestPrice,
      manualBuyPriceNativeCurrency,
      fxRates,
    );

    if (!nextReturnRate) {
      return;
    }

    setManualReturnRate((current) => (current === nextReturnRate ? current : nextReturnRate));
  }, [
    manualBuyPrice,
    manualBuyPriceEntryCurrency,
    manualBuyPriceNativeCurrency,
    manualMarketData,
    fxRates,
  ]);

  const handleResizePointerDown = useCallback(
    (event) => {
      if (!open || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onInteract?.();

      const startPos = event.clientX;
      const startSize = drawerWidth;
      // Which physical drag direction grows the panel depends on which edge the resize handle
      // sits on: left dock's handle is on the panel's right edge (drag right to grow, the
      // original/only behavior this used to be); right dock's handle is on the left edge (drag
      // left to grow). Left is the only one where screen-direction and "growing" point the same
      // way.
      const sign = dock === 'left' ? 1 : -1;
      setResizing(true);

      const handlePointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        const nextSize = startSize + sign * (moveEvent.clientX - startPos);
        onDrawerWidthChange?.(clampDrawerWidth(nextSize));
      };

      const stopResize = () => {
        setResizing(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [clampDrawerWidth, dock, drawerWidth, onDrawerWidthChange, onInteract, open],
  );

  const handleResizeKeyDown = useCallback(
    (event) => {
      if (!open) {
        return;
      }

      // Keyboard grow/shrink stays on a fixed pair of keys regardless of which edge the drawer is
      // actually docked to — unlike the drag handle (a direct-manipulation gesture where physical
      // direction has to match the cursor), a keyboard shortcut that flipped meaning depending on
      // dock side would be the opposite of predictable.
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
        return;
      }

      event.preventDefault();
      onInteract?.();
      const delta = event.key === 'ArrowRight' ? 24 : -24;
      onDrawerWidthChange?.((current) => clampDrawerWidth(current + delta));
    },
    [clampDrawerWidth, onDrawerWidthChange, onInteract, open],
  );

  // Drag-to-dock: grab the handle at the top of the rail (always present, open or closed —
  // re-docking isn't something you should have to open the drawer first to do) and drag toward
  // whichever screen edge it should snap to. Top is deliberately never a candidate edge.
  const handleDockDragPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      onInteract?.();

      const computeHoverEdge = (clientX) => {
        const distanceToEdge = {
          left: clientX,
          right: window.innerWidth - clientX,
        };
        let nearestEdge = null;
        let nearestDistance = DOCK_EDGE_HOVER_THRESHOLD_PX;
        for (const edge of Object.keys(distanceToEdge)) {
          const distance = distanceToEdge[edge];
          if (distance <= nearestDistance) {
            nearestEdge = edge;
            nearestDistance = distance;
          }
        }
        return nearestEdge;
      };

      const panelEl = panelRef.current;
      const startClientX = event.clientX;
      // A short rolling history of (time, x) samples, not just the last move — a single frame's
      // delta right before release is noisy (whatever the pointer happened to do in that last ~8ms
      // tick), while the last ~60ms gives a steadier read on how fast the hand was actually moving
      // when it let go.
      let recentSamples = [{ t: event.timeStamp, x: startClientX }];

      // Directly mutating style.transform every move (not React state) is the same reason the
      // codebase's other drag loops (rotation drag, resize) skip setState mid-gesture — a state
      // update per pointermove would re-render the whole drawer subtree 60+ times a second for a
      // transform that's purely visual until release.
      const applyDragOffset = (offsetPx) => {
        if (!panelEl) {
          return;
        }
        panelEl.style.transition = 'none';
        panelEl.style.transform = `translateX(${offsetPx}px)`;
      };

      const handlePointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        recentSamples.push({ t: moveEvent.timeStamp, x: moveEvent.clientX });
        if (recentSamples.length > 8) {
          recentSamples.shift();
        }
        // Rubber-band clamped — this is a preview of "which edge is about to grab it", not the
        // drawer actually relocating mid-drag, so the visible travel stays modest even if the
        // pointer keeps going past the clamp.
        const rawOffset = moveEvent.clientX - startClientX;
        applyDragOffset(clamp(rawOffset, -140, 140));
        onDockDragHoverEdgeChange?.(computeHoverEdge(moveEvent.clientX));
      };

      // velocity in px/ms, signed (direction matters for nothing here — only magnitude feeds the
      // snap duration below), measured across the retained sample window rather than just the
      // final two events.
      const releaseVelocityPxMs = () => {
        if (recentSamples.length < 2) {
          return 0;
        }
        const first = recentSamples[0];
        const last = recentSamples[recentSamples.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0) {
          return 0;
        }
        return Math.abs(last.x - first.x) / dt;
      };

      const settlePanel = (velocityPxMs) => {
        if (!panelEl) {
          return;
        }
        // Faster release -> shorter settle, so a deliberate flick doesn't visibly lag behind the
        // hand that threw it; a slow, deliberate drag gets the fuller, more readable ease-out.
        // This is a duration heuristic, not a real spring simulation — cubic-bezier below is what
        // actually supplies the "natural, not linear" feel demanded of it.
        const durationMs = clamp(
          DOCK_DRAG_SNAP_DURATION_MS - velocityPxMs * 250,
          DOCK_DRAG_SNAP_MIN_DURATION_MS,
          DOCK_DRAG_SNAP_DURATION_MS,
        );
        panelEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        panelEl.style.transform = 'translateX(0px)';
        window.setTimeout(() => {
          // Hand control back to the stylesheet's own dock/is-open-driven transform once the
          // release animation finishes — an inline style left behind here would silently outrank
          // every future CSS-driven open/close transition for this element.
          panelEl.style.transition = '';
          panelEl.style.transform = '';
        }, durationMs + 30);
      };

      const finishDrag = (finalEdge) => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        settlePanel(releaseVelocityPxMs());
        if (finalEdge && finalEdge !== dock) {
          onDockChange?.(finalEdge);
        }
        onDockDragHoverEdgeChange?.(null);
      };
      // pointerup commits whatever edge was last hovered (null if the cursor never got close
      // enough to any candidate edge — dragging and releasing in the middle of the screen is a
      // no-op, not an accidental dock change). pointercancel aborts without committing anything,
      // same as letting go of a drag that got interrupted should.
      const handlePointerUp = (upEvent) => finishDrag(computeHoverEdge(upEvent.clientX));
      const handlePointerCancel = () => finishDrag(null);

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    },
    [dock, onDockChange, onDockDragHoverEdgeChange, onInteract],
  );

  const hasAtomName = manualAccountName.trim().length > 0;
  const hasManualStockDraft = manualStockName.trim().length > 0 || manualTicker.trim().length > 0;
  const hasManualDraft = hasManualStockDraft && (Boolean(activePortfolio?.id) || hasAtomName);
  const makeManualDraftRow = useCallback(() => {
    if (!hasManualDraft) {
      return null;
    }

    return {
      accountName: activePortfolio?.id
        ? activePortfolio.fileName ||
          summarizePortfolioEntryAccounts(activePortfolio, language).accountText ||
          '직접 입력 포트폴리오'
        : manualAccountName.trim() || '직접 입력 포트폴리오',
      stockName:
        resolveMarketDisplayName(manualMarketData) || manualStockName.trim() || manualTicker.trim(),
      ticker: manualMarketData?.symbol || manualTicker.trim() || '',
      // The raw typed value, never pre-converted — see the comment on manualBuyPriceNativeCurrency
      // above for why. When the user left 매수가 empty and it's auto-filled from the live quote
      // instead, that fallback value is already in the security's own native currency, not
      // whatever the toggle happens to show (the toggle only applies to what was actually typed).
      buyPrice: manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
      purchaseCurrency: manualBuyPrice.trim()
        ? manualBuyPriceEntryCurrency
        : manualBuyPriceNativeCurrency,
      shares: manualShares.trim(),
      returnRate:
        manualReturnRate.trim() ||
        calculateManualReturnRate(
          manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
          manualBuyPrice.trim() ? manualBuyPriceEntryCurrency : manualBuyPriceNativeCurrency,
          manualMarketData?.latestPrice,
          manualBuyPriceNativeCurrency,
          fxRates,
        ),
      assetClass: manualAssetClass.trim() || '주식',
      sector: manualMarketData?.sector || '',
      marketName: resolveMarketDisplayName(manualMarketData) || '',
      marketPrice: Number.isFinite(manualMarketData?.latestPrice)
        ? formatMarketPrice(manualMarketData.latestPrice, manualMarketData.currency)
        : '',
      marketCurrency: manualMarketData?.currency || '',
      marketUpdatedAt: manualMarketData?.updatedAt
        ? formatMarketTime(manualMarketData.updatedAt, language)
        : '',
      recordedAt: formatDateKey(),
    };
  }, [
    activePortfolio,
    hasManualDraft,
    language,
    manualAccountName,
    manualAssetClass,
    manualBuyPrice,
    manualBuyPriceEntryCurrency,
    manualBuyPriceNativeCurrency,
    fxRates,
    manualMarketData,
    manualReturnRate,
    manualShares,
    manualStockName,
    manualTicker,
  ]);
  const clearManualStockFields = useCallback(() => {
    setManualStockName('');
    setManualTicker('');
    setManualBuyPrice('');
    setManualBuyPriceCurrencyOverride(null);
    setManualShares('');
    setManualReturnRate('');
    setManualAssetClass('주식');
    setManualSuggestionLocked(false);
    manualAssetClassTouchedRef.current = false;
  }, []);
  const handleCreateManualAtom = useCallback(() => {
    if (!hasAtomName || portfolioEntries.length >= MAX_PORTFOLIOS) {
      return;
    }

    onInteract?.();
    onCreateManualAtom?.({
      accountName: manualAccountName.trim(),
    });
    setManualRows([]);
    clearManualStockFields();
    setManualAccountName('');
    onSelectTool?.('manual');
  }, [
    clearManualStockFields,
    hasAtomName,
    manualAccountName,
    onCreateManualAtom,
    onInteract,
    onSelectTool,
    portfolioEntries.length,
  ]);
  const handleAddManualRow = useCallback(() => {
    if (editingHolding) {
      return;
    }

    const draft = makeManualDraftRow();

    if (!draft) {
      return;
    }

    onInteract?.();
    setManualRows((current) => [
      ...current,
      {
        ...draft,
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `manual-row-${Date.now()}-${current.length}`,
      },
    ]);
    clearManualStockFields();
  }, [clearManualStockFields, editingHolding, makeManualDraftRow, onInteract]);
  const handleSaveManualPortfolio = useCallback(() => {
    const draft = makeManualDraftRow();

    if (editingHolding) {
      if (!draft) {
        return;
      }

      onInteract?.();
      onUpdatePortfolioHolding?.({
        entryId: editingHolding.entryId,
        itemId: editingHolding.itemId,
        itemIndex: editingHolding.itemIndex,
        accountName: manualAccountName.trim() || resolveHoldingAccount(editingHolding.item),
        row: draft,
      });
      setEditingHolding(null);
      setManualRows([]);
      clearManualStockFields();
      setManualAccountName('');
      onSelectTool?.('accounts');
      return;
    }

    const rows = draft ? [...manualRows, draft] : manualRows;

    if (!rows.length || portfolioEntries.length >= MAX_PORTFOLIOS) {
      return;
    }

    onInteract?.();
    onCreateManualPortfolio?.({
      accountName: manualAccountName.trim() || '직접 입력 포트폴리오',
      rows,
    });
    setManualRows([]);
    setManualAccountName('');
    clearManualStockFields();
  }, [
    clearManualStockFields,
    editingHolding,
    makeManualDraftRow,
    manualAccountName,
    manualRows,
    onCreateManualPortfolio,
    onInteract,
    onSelectTool,
    onUpdatePortfolioHolding,
    portfolioEntries.length,
  ]);
  const handleAppendManualRows = useCallback(() => {
    const draft = makeManualDraftRow();
    const rows = draft ? [...manualRows, draft] : manualRows;

    if (!activePortfolio?.id || !rows.length) {
      return;
    }

    onInteract?.();
    onAppendManualHoldings?.({
      entryId: activePortfolio.id,
      accountName:
        activePortfolio.fileName ||
        summarizePortfolioEntryAccounts(activePortfolio, language).accountText ||
        '직접 입력 포트폴리오',
      rows,
    });
    setManualRows([]);
    clearManualStockFields();
    setManualAccountName('');
    onSelectTool?.('accounts');
  }, [
    activePortfolio,
    clearManualStockFields,
    language,
    makeManualDraftRow,
    manualRows,
    onAppendManualHoldings,
    onInteract,
    onSelectTool,
  ]);
  const removeManualRow = useCallback((rowId) => {
    setManualRows((current) => current.filter((row) => row.id !== rowId));
  }, []);
  const beginEditHolding = useCallback(
    (entry, item, itemIndex) => {
      if (!entry || !item) {
        return;
      }

      onInteract?.();
      setEditingHolding({
        entryId: entry.id,
        itemId: item.id ?? '',
        itemIndex,
        item,
      });
      setManualRows([]);
      setManualAccountName(resolveHoldingAccount(item));
      setManualStockName(resolveHoldingName(item));
      setManualTicker(resolveHoldingTicker(item));
      setManualSuggestionLocked(true);
      // Restores the toggle to whatever currency this holding's 매수가 was actually recorded in
      // (falls back to null — "follow the resolved native currency" — for older holdings saved
      // before this field existed, which is exactly what their buyPrice already assumed).
      setManualBuyPriceCurrencyOverride(
        normalizeCurrencyCode(item?.purchaseCurrency) ||
          normalizeCurrencyCode(resolveHoldingMetric(item, ['매수통화', 'purchaseCurrency'])) ||
          null,
      );
      setManualBuyPrice(resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']));
      setManualShares(resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']));
      setManualReturnRate(
        String(item?.detail ?? item?.return ?? '').trim() ||
          resolveHoldingMetric(item, ['수익률', 'return']),
      );
      setManualAssetClass(String(item?.assetClass ?? '').trim() || '주식');
      // Editing an existing holding shouldn't have its already-saved 자산군 silently swapped out
      // just because opening the editor re-triggers a live-quote lookup for its ticker — that
      // auto-fill is for *new* additions with nothing set yet, not a background "correction" of
      // whatever a CSV import or a previous manual choice already recorded. If the value really is
      // missing/blank, the fallback above already picked '주식'; treating that as "touched" too is
      // fine since re-typing the ticker (which does reset this) is what reopens auto-classification.
      manualAssetClassTouchedRef.current = true;
      onSelectTool?.('manual');
    },
    [onInteract, onSelectTool],
  );
  const cancelEditingHolding = useCallback(() => {
    setEditingHolding(null);
    setManualRows([]);
    setManualAccountName('');
    clearManualStockFields();
  }, [clearManualStockFields]);

  const activeAccountEntry =
    activePortfolio ??
    portfolioEntries.find((entry) => entry.id === activePortfolioId) ??
    portfolioEntries[0] ??
    null;
  const activeAccountSourceItems =
    (activeAccountEntry?.timelineItems?.length
      ? activeAccountEntry.timelineItems
      : activeAccountEntry?.items) ?? [];
  const activeAccountItems = useMemo(
    () => buildGroupedHoldingItems(activeAccountSourceItems),
    [activeAccountSourceItems],
  );
  const activeSelectedHolding =
    activeAccountEntry && selectedHolding?.entryId === activeAccountEntry.id
      ? selectedHolding
      : null;
  const analyticsTotals = analyticsSummary?.totals ?? null;
  const analyticsTopHolding = analyticsSummary?.concentration?.topHoldings?.[0] ?? null;
  const analyticsGap = analyticsSummary?.rebalanceGaps?.bucket?.[0] ?? null;
  const analyticsKpis = analyticsSummary
    ? [
        {
          key: 'market-value',
          label: language === 'en' ? 'Market value' : '평가금액',
          value: formatAnalyticsCompactValue(analyticsTotals?.totalMarketValue, language),
        },
        {
          key: 'profit',
          label: language === 'en' ? 'P/L' : '누적손익',
          value: formatAnalyticsSignedValue(analyticsTotals?.totalProfitAmount, language),
          tone: getSignedValueToneClass(analyticsTotals?.totalProfitAmount, 'positive', 'negative'),
        },
        {
          key: 'return',
          label: language === 'en' ? 'Return' : '수익률',
          value: formatAnalyticsPercentValue(analyticsTotals?.totalReturnRate),
          tone: getSignedValueToneClass(analyticsTotals?.totalReturnRate, 'positive', 'negative'),
        },
        {
          key: 'holdings',
          label: language === 'en' ? 'Holdings' : '종목수',
          value: formatAnalyticsCompactValue(analyticsTotals?.holdingsCount, language),
        },
      ]
    : [];
  const portfolioComparisonRows = useMemo(
    () =>
      portfolioEntries.map((entry) => {
        const entryItems = entry?.items ?? [];
        const entryTimelineItems = entry?.timelineItems?.length ? entry.timelineItems : entryItems;
        const entrySummary = createPortfolioAnalyticsSummary(entryItems, entryTimelineItems, {
          period: 'month',
          topN: 3,
          targetBucketWeights: DEFAULT_REBALANCE_TARGET_WEIGHTS,
          // This comparison table is built before the user's live baseCurrency/usdKrwRate state
          // exists in this component's render order, so it uses the same static default rate the
          // rest of the app falls back to (DEFAULT_DISPLAY_FX_RATES) — still correctly converts a
          // foreign holding into KRW before summing, just not live-rate-reactive like the main
          // portfolioAnalyticsSummary memo below.
          baseCurrency: 'KRW',
          fxRates: DEFAULT_DISPLAY_FX_RATES,
        });
        const entryScorecard = createPortfolioScorecard(entryItems, language, {
          weightPreset: scoreWeightPreset,
        });
        const accountSummary = summarizePortfolioEntryAccounts(entry, language);
        const topHolding = entrySummary.concentration?.topHoldings?.[0] ?? null;

        return {
          id: entry.id,
          fileName: entry.fileName,
          accountText: accountSummary.accountText,
          holdingsCount: entrySummary.totals?.holdingsCount ?? entryItems.length,
          totalReturnRate: entrySummary.totals?.totalReturnRate,
          totalMarketValue: entrySummary.totals?.totalMarketValue,
          concentrationLevel: entrySummary.concentration?.concentrationLevel,
          effectiveHoldings: entrySummary.concentration?.effectiveHoldings,
          topHolding,
          score: entryScorecard?.overall,
        };
      }),
    [language, portfolioEntries, scoreWeightPreset],
  );
  const latestMonthlyReport = analyticsSummary?.profitFlow?.at(-1) ?? null;

  useEffect(() => {
    if (!selectedHolding) {
      return;
    }

    const entry = portfolioEntries.find((candidate) => candidate.id === selectedHolding.entryId);
    const sourceItems = (entry?.timelineItems?.length ? entry.timelineItems : entry?.items) ?? [];
    const stillExists = buildGroupedHoldingItems(sourceItems).some((item, index) =>
      selectedHolding.holdingGroupKey
        ? item.holdingGroupKey === selectedHolding.holdingGroupKey
        : selectedHolding.itemId
          ? item.id === selectedHolding.itemId
          : index === selectedHolding.itemIndex,
    );

    if (!stillExists) {
      setSelectedHolding(null);
    }
  }, [portfolioEntries, selectedHolding]);

  const handleSelectMarketSuggestion = useCallback(
    (suggestion) => {
      if (!suggestion?.symbol) {
        return;
      }

      onInteract?.();
      setManualSuggestionLocked(true);
      setManualStockName(suggestion.displayName || suggestion.name || suggestion.symbol);
      setManualTicker(suggestion.symbol);
      // Picking a specific suggestion is a deliberate "this is the security I mean" action, same
      // as typing a fresh query — it should win over the touched-guard the same way, not be
      // silently blocked by whatever 자산군 happened to be left over from a previous lookup.
      manualAssetClassTouchedRef.current = false;
      if (suggestion.assetClass) {
        setManualAssetClass(suggestion.assetClass);
      }
      setManualMarketSuggestions([]);
      setManualSuggestionStatus('idle');
    },
    [onInteract],
  );
  const handleManualStockNameChange = useCallback((event) => {
    setManualSuggestionLocked(false);
    // Typing a new query reopens auto-classification for whatever this resolves to — see
    // manualAssetClassTouchedRef's own comment.
    manualAssetClassTouchedRef.current = false;
    setManualStockName(event.target.value);
  }, []);
  // Switching the toggle has to convert whatever's already typed, not just relabel it — leaving a
  // USD-auto-filled "301.77" in place and reinterpreting it as 원 the instant 원 is clicked turns a
  // real ~$300 price into an almost-zero 301.77원 cost basis (a +140,000%+ return). The number in
  // the field should represent one consistent real quantity throughout — only its currency changes
  // when the toggle is clicked, the amount it represents shouldn't.
  const handleManualBuyPriceCurrencyToggle = useCallback(
    (nextCurrency) => {
      if (nextCurrency === manualBuyPriceEntryCurrency) {
        return;
      }

      onInteract?.();
      setManualBuyPriceCurrencyOverride(nextCurrency);

      const typed = parseManualPriceValue(manualBuyPrice);
      if (Number.isFinite(typed) && manualBuyPrice.trim()) {
        const converted = convertCurrencyAmount(
          typed,
          manualBuyPriceEntryCurrency,
          nextCurrency,
          fxRates,
        );
        if (Number.isFinite(converted)) {
          setManualBuyPrice(
            nextCurrency === 'USD' ? converted.toFixed(2) : String(Math.round(converted)),
          );
        }
      }
    },
    [fxRates, manualBuyPrice, manualBuyPriceEntryCurrency, onInteract],
  );
  const handleManualBuyPriceChange = useCallback(
    (event) => {
      const nextBuyPrice = event.target.value;
      setManualBuyPrice(nextBuyPrice);

      const nextReturnRate = calculateManualReturnRate(
        nextBuyPrice,
        manualBuyPriceEntryCurrency,
        manualMarketData?.latestPrice,
        manualBuyPriceNativeCurrency,
        fxRates,
      );

      if (nextReturnRate || !nextBuyPrice.trim()) {
        setManualReturnRate(nextReturnRate);
      }
    },
    [fxRates, manualBuyPriceEntryCurrency, manualBuyPriceNativeCurrency, manualMarketData],
  );
  const shouldShowManualSuggestions =
    !manualSuggestionLocked &&
    (manualStockName.trim().length >= 2 || /[가-힣]/.test(manualStockName.trim())) &&
    (manualSuggestionStatus === 'loading' ||
      manualSuggestionStatus === 'ready' ||
      manualSuggestionStatus === 'error');
  const closeManualSuggestions = useCallback(() => {
    setManualSuggestionStatus('idle');
  }, []);

  useEffect(() => {
    if (!shouldShowManualSuggestions || typeof document === 'undefined') {
      return undefined;
    }

    const handleDocumentPointerDown = (event) => {
      if (manualSuggestionRef.current?.contains(event.target)) {
        return;
      }

      closeManualSuggestions();
    };
    const handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeManualSuggestions();
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [closeManualSuggestions, shouldShowManualSuggestions]);

  // The standalone "종목 조회" (stock lookup) tool/panel that used to live here was removed —
  // it was a second, separate search entry point alongside ⌘K's command palette (which also
  // searches by ticker/name and can add a holding directly), and having two ways to search for a
  // stock was exactly the kind of duplicate entry point this cleanup consolidated down to one.

  const applyMarketQuoteToDraft = useCallback(() => {
    if (!manualMarketData) {
      return;
    }

    onInteract?.();
    const marketName = resolveMarketDisplayName(manualMarketData);
    if (marketName) {
      setManualSuggestionLocked(true);
      setManualStockName(marketName);
    }
    if (!manualTicker.trim()) {
      setManualTicker(manualMarketData.symbol || '');
    }
    // Explicitly clicking "현재가 적용" is the same kind of deliberate sync-everything action as
    // picking a suggestion — see handleSelectMarketSuggestion's own comment on the touched-guard.
    manualAssetClassTouchedRef.current = false;
    if (manualMarketData.assetClass) {
      setManualAssetClass(manualMarketData.assetClass);
    }
    const nextBuyPrice = formatMarketInputPrice(manualMarketData.latestPrice);
    setManualBuyPrice(nextBuyPrice);
    const nextReturnRate = calculateReturnRateFromBuyPrice(
      nextBuyPrice,
      manualMarketData.latestPrice,
    );
    if (nextReturnRate) {
      setManualReturnRate(nextReturnRate);
    }
  }, [manualMarketData, manualTicker, onInteract]);
  const renderManualEntryPanel = () => (
    <section className="tool-drawer__manual-entry">
      {editingHolding ? (
        <div className="tool-drawer__manual-editing">
          <span>{language === 'en' ? 'Editing holding' : '종목 수정 중'}</span>
          <button type="button" onClick={cancelEditingHolding}>
            {language === 'en' ? 'Cancel' : '취소'}
          </button>
        </div>
      ) : null}

      <div className="tool-drawer__manual-grid">
        <div
          ref={manualSuggestionRef}
          className="tool-drawer__manual-field tool-drawer__manual-field--suggest"
        >
          <span id="manual-stock-name-label">{language === 'en' ? 'Stock' : '종목명'}</span>
          <input
            type="text"
            value={manualStockName}
            onChange={handleManualStockNameChange}
            placeholder={language === 'en' ? 'Apple, TIGER' : '예: 타이거, 애플'}
            autoComplete="off"
            aria-labelledby="manual-stock-name-label"
            aria-autocomplete="list"
            aria-expanded={shouldShowManualSuggestions}
          />
          {shouldShowManualSuggestions ? (
            <div
              className="tool-drawer__suggestions"
              role="listbox"
              aria-label={language === 'en' ? 'Stock suggestions' : '종목 검색 결과'}
            >
              {manualMarketSuggestions.length ? (
                manualMarketSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.symbol}
                    type="button"
                    className="tool-drawer__suggestion"
                    role="option"
                    aria-selected={manualTicker === suggestion.symbol}
                    onClick={() => handleSelectMarketSuggestion(suggestion)}
                  >
                    <span>
                      <strong>
                        {suggestion.displayName || suggestion.name || suggestion.symbol}
                      </strong>
                      <em>
                        {[suggestion.exchangeName, suggestion.typeDisp]
                          .filter(Boolean)
                          .join(' · ') || suggestion.source}
                      </em>
                    </span>
                    <small>{suggestion.symbol}</small>
                  </button>
                ))
              ) : (
                <p className="tool-drawer__suggestion-empty">
                  {manualSuggestionStatus === 'loading'
                    ? language === 'en'
                      ? 'Searching...'
                      : '검색 중...'
                    : manualSuggestionStatus === 'error'
                      ? language === 'en'
                        ? 'Could not load suggestions.'
                        : '검색 결과를 가져오지 못했습니다.'
                      : language === 'en'
                        ? 'No matching stocks.'
                        : '관련 종목이 없습니다.'}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Ticker' : '종목 티커'}</span>
          <input
            type="text"
            value={manualTicker}
            onChange={(event) => {
              // Same reasoning as handleManualStockNameChange — typing a new ticker directly
              // (bypassing the suggestion dropdown entirely) is just as much a "new query" as
              // typing a new name, and needs the same reopening of auto-classification.
              manualAssetClassTouchedRef.current = false;
              setManualTicker(event.target.value);
            }}
            placeholder={language === 'en' ? 'AAPL' : 'AAPL 또는 005930'}
          />
        </label>
        <label className="tool-drawer__manual-field">
          {/* Explicit, *switchable* unit — a static "USD" label alone wasn't enough: a Korean user
              buying a foreign stock very commonly thinks of (and wants to type) the price in 원
              terms regardless of what the field is labeled, so a bare read-only badge just let the
              same currency mismatch happen with extra steps (real case: 370,000 typed as a QQQM
              buy price against a ~$300 native quote read as -99.9% return, or as a
              -₩3.1 billion "loss" once profit itself started being FX-converted). For a foreign
              holding, this is a real toggle — whichever currency the user picks is stored as its
              own explicit purchaseCurrency field, right alongside the price exactly as typed
              (never pre-converted — see manualBuyPriceNativeCurrency's own comment above), and
              resolvePosition (portfolioAnalyticsSummary.js) does the currency-aware comparison at
              read time. A domestic (원-priced) holding has no such ambiguity, so it stays a plain
              label. */}
          <span className="tool-drawer__manual-field-label-row">
            <span>{language === 'en' ? 'Buy Price' : '매수가'}</span>
            {manualBuyPriceNativeCurrency === 'USD' ? (
              <span
                className="tool-drawer__manual-field-currency-toggle"
                role="group"
                aria-label={language === 'en' ? 'Buy price currency' : '매수가 입력 통화'}
              >
                <button
                  type="button"
                  className={manualBuyPriceEntryCurrency === 'KRW' ? 'is-active' : ''}
                  onClick={() => handleManualBuyPriceCurrencyToggle('KRW')}
                >
                  {language === 'en' ? 'KRW' : '원'}
                </button>
                <button
                  type="button"
                  className={manualBuyPriceEntryCurrency === 'USD' ? 'is-active' : ''}
                  onClick={() => handleManualBuyPriceCurrencyToggle('USD')}
                >
                  USD
                </button>
              </span>
            ) : (
              <em className="tool-drawer__manual-field-currency">
                {language === 'en' ? 'KRW' : '원'}
              </em>
            )}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={manualBuyPrice}
            onChange={handleManualBuyPriceChange}
            placeholder={manualBuyPriceEntryCurrency === 'USD' ? '0.00' : '0'}
          />
          {manualBuyPriceNativeCurrency === 'USD' &&
          manualBuyPriceEntryCurrency === 'KRW' &&
          manualBuyPrice.trim() ? (
            <small className="tool-drawer__manual-field-hint">
              {/* Display-only preview of what the 원 amount is worth today — the actual stored
                  value stays exactly as typed (370,000, not this converted figure); see
                  manualBuyPriceNativeCurrency's own comment for why that distinction matters. */}
              ≈{' '}
              {formatCurrencyAmount(
                convertCurrencyAmount(parseManualPriceValue(manualBuyPrice), 'KRW', 'USD', fxRates),
                'USD',
              )}{' '}
              {language === 'en' ? "(at today's rate)" : '(오늘 환율 기준)'}
            </small>
          ) : null}
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Shares' : '보유수량'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualShares}
            onChange={(event) => setManualShares(event.target.value)}
            placeholder="0"
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Return' : '수익률'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualReturnRate}
            onChange={(event) => setManualReturnRate(event.target.value)}
            placeholder={language === 'en' ? '3.5%' : '예: 3.5%'}
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Asset' : '자산군'}</span>
          <select
            value={manualAssetClass}
            onChange={(event) => {
              // The one place this ever gets set to true — an explicit manual pick here is what
              // the auto-fill sites above must never silently overwrite again for this query.
              manualAssetClassTouchedRef.current = true;
              setManualAssetClass(event.target.value);
            }}
          >
            <option value="주식">{language === 'en' ? 'Stock' : '주식'}</option>
            <option value="배당">{language === 'en' ? 'Dividend' : '배당'}</option>
            <option value="금/원자재 ETF">
              {language === 'en' ? 'Gold/Commodity' : '금/원자재'}
            </option>
            <option value="금/현금">{language === 'en' ? 'Gold/Cash' : '금/현금'}</option>
            <option value="리츠">{language === 'en' ? 'REITs' : '리츠'}</option>
            <option value="채권">{language === 'en' ? 'Bond' : '채권'}</option>
            <option value="기타">{language === 'en' ? 'Other' : '기타'}</option>
          </select>
        </label>
      </div>

      <div className="tool-drawer__manual-actions">
        <button
          type="button"
          className="tool-drawer__manual-button"
          disabled={!activePortfolio?.id || !hasManualStockDraft || Boolean(editingHolding)}
          onClick={handleAddManualRow}
        >
          {language === 'en' ? 'Add stock' : '종목 추가'}
        </button>
        {activePortfolio?.id && !editingHolding ? (
          <button
            type="button"
            className="tool-drawer__manual-button"
            disabled={!manualRows.length && !hasManualStockDraft}
            onClick={handleAppendManualRows}
          >
            {language === 'en' ? 'Add to current portfolio' : '현재 포트폴리오에 종목 추가'}
          </button>
        ) : null}
        {editingHolding ? (
          <button
            type="button"
            className="tool-drawer__manual-button tool-drawer__manual-button--primary"
            disabled={!hasManualDraft}
            onClick={handleSaveManualPortfolio}
          >
            {language === 'en' ? 'Save changes' : '변경 저장'}
          </button>
        ) : null}
      </div>

      {manualRows.length && !editingHolding ? (
        <div className="tool-drawer__manual-preview">
          {manualRows.map((row) => (
            <div key={row.id} className="tool-drawer__manual-row">
              <span>
                <strong>{compactLabel(row.stockName || row.ticker, 16)}</strong>
                <em>{compactLabel(row.ticker || row.assetClass, 12)}</em>
              </span>
              <button
                type="button"
                className="tool-drawer__manual-remove"
                onClick={() => removeManualRow(row.id)}
                aria-label={language === 'en' ? 'Remove stock' : '종목 제거'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <MarketLivePreview
        data={manualMarketData}
        status={manualMarketStatus}
        error={manualMarketError}
        language={language}
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onApplyQuote={applyMarketQuoteToDraft}
      />
    </section>
  );

  const renderComparePanel = () => (
    <div className="tool-drawer__compare-panel">
      <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
        <p>{language === 'en' ? 'Portfolio Comparison' : '포트폴리오 비교'}</p>
        <div className="tool-drawer__compare-table">
          {portfolioComparisonRows.map((row) => {
            const isActive = row.id === activePortfolioId;

            return (
              <button
                key={row.id}
                type="button"
                className={`tool-drawer__compare-row${isActive ? ' is-active' : ''}`}
                onClick={() => {
                  onInteract?.();
                  onSelectPortfolio?.(row.id);
                }}
              >
                <span>
                  <strong title={row.fileName}>{compactFileName(row.fileName, 24)}</strong>
                  <em>{row.accountText}</em>
                </span>
                <span>
                  <small>{language === 'en' ? 'Return' : '수익률'}</small>
                  <strong
                    className={getSignedValueToneClass(row.totalReturnRate, 'positive', 'negative')}
                  >
                    {formatAnalyticsPercentValue(row.totalReturnRate)}
                  </strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Score' : '점수'}</small>
                  <strong>{Number.isFinite(row.score) ? Math.round(row.score) : '-'}</strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Top' : '상위'}</small>
                  <strong>
                    {row.topHolding
                      ? `${compactLabel(row.topHolding.label, 12)} · ${formatAllocationPercent(row.topHolding.weight)}`
                      : '-'}
                  </strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Concentration' : '집중도'}</small>
                  <strong>
                    {concentrationLevelLabel(row.concentrationLevel, language)}
                    {' · '}
                    {formatAnalyticsCompactValue(row.effectiveHoldings, language)}
                  </strong>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderMonthlyReportPanel = () => (
    <div className="tool-drawer__report-panel">
      <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
        <p>{language === 'en' ? 'Monthly Report Draft' : '월간 리포트 초안'}</p>
        {latestMonthlyReport ? (
          <div className="tool-drawer__report-summary">
            <div className="tool-drawer__analytics-grid">
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Month' : '월'}</span>
                <strong>{latestMonthlyReport.periodKey}</strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Return' : '수익률'}</span>
                <strong
                  className={getSignedValueToneClass(
                    latestMonthlyReport.returnRate,
                    'positive',
                    'negative',
                  )}
                >
                  {formatAnalyticsPercentValue(latestMonthlyReport.returnRate)}
                </strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Rows' : '기록'}</span>
                <strong>
                  {formatAnalyticsCompactValue(latestMonthlyReport.entriesCount, language)}
                </strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'P/L' : '손익'}</span>
                <strong
                  className={getSignedValueToneClass(
                    latestMonthlyReport.profitAmount,
                    'positive',
                    'negative',
                  )}
                >
                  {formatAnalyticsSignedValue(latestMonthlyReport.profitAmount, language)}
                </strong>
              </div>
            </div>

            <div className="tool-drawer__report-lines">
              <p>
                {language === 'en'
                  ? 'This draft uses uploaded or manually entered values and existing portfolio calculations.'
                  : '이 초안은 업로드 또는 직접 입력한 값과 기존 포트폴리오 계산을 기준으로 합니다.'}
              </p>
              <ul>
                <li>
                  {language === 'en'
                    ? `Largest visible holding: ${
                        analyticsTopHolding
                          ? `${analyticsTopHolding.label} (${formatAllocationPercent(analyticsTopHolding.weight)})`
                          : '-'
                      }`
                    : `가장 큰 표시 비중: ${
                        analyticsTopHolding
                          ? `${analyticsTopHolding.label} (${formatAllocationPercent(analyticsTopHolding.weight)})`
                          : '-'
                      }`}
                </li>
                <li>
                  {language === 'en'
                    ? `Concentration: ${concentrationLevelLabel(
                        analyticsSummary?.concentration?.concentrationLevel,
                        language,
                      )}`
                    : `집중도: ${concentrationLevelLabel(
                        analyticsSummary?.concentration?.concentrationLevel,
                        language,
                      )}`}
                </li>
                <li>
                  {language === 'en'
                    ? 'Next check: confirm data freshness, missing prices, and large allocation gaps.'
                    : '다음 점검: 데이터 최신성, 누락 시세, 큰 비중 차이를 확인하세요.'}
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="tool-drawer__empty">
            {language === 'en'
              ? 'Monthly timeline data is not available yet.'
              : '월간 시계열 데이터가 아직 없습니다.'}
          </p>
        )}
      </section>
    </div>
  );

  const renderActivePanel = () => {
    if (!resolvedTool) {
      return null;
    }

    if (resolvedTool.key === 'accounts') {
      return (
        <div className="tool-drawer__accounts">
          <div className="tool-drawer__accounts-header">
            <span className="tool-drawer__accounts-count">
              {language === 'en'
                ? `${portfolioEntries.length} portfolios`
                : `${portfolioEntries.length}개 포트폴리오`}
            </span>
          </div>

          {/* Two equal-weight cards, not a button sharing a line with the count text (old layout)
              and a visually disconnected name+create row below it — reads as "pick one of two ways
              to get a portfolio in here" now, build-it-yourself vs. import-a-file, side by side. */}
          <div className="tool-drawer__account-onboard">
            <div className="tool-drawer__account-onboard-card tool-drawer__overview-card">
              <p>{language === 'en' ? 'Build manually' : '직접 만들기'}</p>
              <label className="tool-drawer__account-create-field">
                <input
                  type="text"
                  value={manualAccountName}
                  onChange={(event) => setManualAccountName(event.target.value)}
                  aria-label={language === 'en' ? 'Portfolio name' : '포트폴리오명'}
                  placeholder={language === 'en' ? 'New portfolio name' : '새 포트폴리오 이름'}
                />
              </label>
              <button
                type="button"
                className="tool-drawer__account-create-button"
                disabled={!hasAtomName || portfolioEntries.length >= MAX_PORTFOLIOS}
                onClick={handleCreateManualAtom}
              >
                {language === 'en' ? 'Create portfolio' : '포트폴리오 생성'}
              </button>
            </div>

            <div className="tool-drawer__account-onboard-card tool-drawer__overview-card">
              <p>{language === 'en' ? 'Import a file' : '파일 가져오기'}</p>
              <span className="tool-drawer__account-onboard-hint">
                {language === 'en' ? 'CSV or broker export' : 'CSV · 증권사 거래내역'}
              </span>
              <button
                type="button"
                className="tool-drawer__account-upload"
                disabled={portfolioEntries.length >= MAX_PORTFOLIOS}
                onClick={() => {
                  onInteract?.();
                  onOpenPortfolioPicker?.();
                }}
              >
                {language === 'en' ? 'Choose file' : '파일 선택'}
              </button>
            </div>
          </div>

          {portfolioEntries.length ? (
            <div className="tool-drawer__account-list">
              {portfolioEntries.map((entry) => {
                const entryReviewStatus = resolveEntryReviewStatus(entry);
                const entryReviewLabel = reviewStatusLabel(text, entryReviewStatus);
                const accountSummary = summarizePortfolioEntryAccounts(entry, language);
                const reviewPreview = buildUploadReviewPreview(entry);
                const isActive = entry.id === activePortfolioId;

                return (
                  <article
                    key={entry.id}
                    className={`tool-drawer__account-card${isActive ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="tool-drawer__account-main"
                      onClick={() => {
                        onInteract?.();
                        onSelectPortfolio?.(entry.id);
                      }}
                      aria-label={`${entry.fileName} · ${entryReviewLabel}`}
                    >
                      <span
                        className={`upload-file-chip__status upload-file-chip__status--${entryReviewStatus}`}
                        aria-hidden="true"
                      />
                      <span className="tool-drawer__account-copy">
                        <strong title={entry.fileName}>
                          {compactFileName(entry.fileName, 28)}
                        </strong>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="tool-drawer__account-clear"
                      onClick={() => {
                        onInteract?.();
                        onClearPortfolio?.(entry.id);
                      }}
                      aria-label={text.clearUploadAria}
                    >
                      ×
                    </button>
                    {reviewPreview ? (
                      <div className="tool-drawer__account-review">
                        <strong>{reviewPreview.summary || entryReviewLabel}</strong>
                        {reviewPreview.warnings.length ? (
                          <ul>
                            {reviewPreview.warnings.map((warning, warningIndex) => (
                              <li key={`${warning.code ?? warning.message}-${warningIndex}`}>
                                {warning.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {accountSummary.excludedItems.length ? (
                      <details className="tool-drawer__account-review">
                        <summary>
                          {language === 'en'
                            ? `${accountSummary.atomVisibleCount}/${accountSummary.securityCount} shown as atoms`
                            : `${accountSummary.securityCount}개 종목 중 ${accountSummary.atomVisibleCount}개만 원자로 표시됨`}
                        </summary>
                        <ul>
                          {accountSummary.excludedItems.map((excluded, excludedIndex) => (
                            <li key={`${excluded.label}-${excludedIndex}`}>
                              {excluded.label}
                              {' — '}
                              {excludedAtomReasonLabel(excluded.reason, language)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          {activeAccountEntry ? (
            <section className="tool-drawer__holdings">
              <div className="tool-drawer__holdings-head">
                <span>{language === 'en' ? 'Portfolio holdings' : '포트폴리오 종목 구성'}</span>
                <button
                  type="button"
                  onClick={() => {
                    onInteract?.();
                    onSelectTool?.('manual');
                  }}
                >
                  {language === 'en' ? 'Add stock' : '종목 추가'}
                </button>
              </div>

              {activeAccountItems.length ? (
                <div className="tool-drawer__holding-list">
                  {activeAccountItems.map((item, itemIndex) => {
                    const itemId = item.id ?? '';
                    const itemIds = Array.isArray(item.groupedSourceItemIds)
                      ? item.groupedSourceItemIds
                      : [];
                    const itemIndexes = Array.isArray(item.groupedSourceItemIndexes)
                      ? item.groupedSourceItemIndexes
                      : [];
                    const isSelected =
                      selectedHolding?.entryId === activeAccountEntry.id &&
                      (item.holdingGroupKey
                        ? selectedHolding.holdingGroupKey === item.holdingGroupKey
                        : itemId
                          ? selectedHolding.itemId === itemId
                          : selectedHolding.itemIndex === itemIndex);
                    // Same resolveHoldingPosition the totals in the 요약 panel are built from —
                    // this is where 평가금액/평가손익 actually get computed for the holdings list,
                    // not left as "-" the way this row used to render before it showed anything
                    // beyond the return percentage.
                    const position = resolveHoldingPosition(item, { baseCurrency, fxRates });
                    const isForeignHolding = position.nativeCurrency !== baseCurrency;
                    const profitToneClass = getSignedValueToneClass(
                      position.profitAmount,
                      'is-positive',
                      'is-negative',
                    );
                    const marketValueText =
                      position.marketValue != null
                        ? formatCurrencyAmount(position.marketValue, baseCurrency)
                        : '-';
                    const profitText =
                      position.profitAmount != null
                        ? `${position.profitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.profitAmount, baseCurrency)}`
                        : '-';
                    // Only meaningful for a same-currency purchase (bought and quoted in the same
                    // currency, see resolvePosition's own sameCurrencyPurchase comment) — a
                    // cross-currency one (e.g. a real 원 cost basis for a USD-quoted stock) has no
                    // FX-independent "native profit" to show here.
                    const nativeProfitText =
                      position.nativeProfitAmount != null
                        ? `${position.nativeProfitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.nativeProfitAmount, position.nativeCurrency)}`
                        : null;

                    return (
                      <article
                        key={
                          item.holdingGroupKey || itemId || `${activeAccountEntry.id}-${itemIndex}`
                        }
                        className={`tool-drawer__holding-row${isSelected ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="tool-drawer__holding-main"
                          onClick={() => {
                            onInteract?.();
                            if (isSelected) {
                              setSelectedHolding(null);
                              onClearHoldingFocus?.();
                              return;
                            }

                            setSelectedHolding({
                              entryId: activeAccountEntry.id,
                              itemId,
                              itemIds,
                              itemIndex,
                              itemIndexes,
                              holdingGroupKey: item.holdingGroupKey,
                              item,
                            });
                            onFocusHolding?.({
                              entryId: activeAccountEntry.id,
                              item,
                              itemIndex,
                            });
                          }}
                        >
                          <span className="tool-drawer__holding-main-row">
                            <span className="tool-drawer__holding-main-name">
                              <strong>{compactLabel(resolveHoldingName(item), 18)}</strong>
                              <em>{formatHoldingListMeta(item, language)}</em>
                            </span>
                            <small>{String(item.detail ?? item.return ?? '').trim() || '-'}</small>
                          </span>
                          <span className="tool-drawer__holding-main-row tool-drawer__holding-main-row--metrics">
                            <span className="tool-drawer__holding-main-metric">
                              {marketValueText}
                              {isForeignHolding && position.nativeMarketValue != null ? (
                                <em className="tool-drawer__holding-main-native">
                                  {formatCurrencyAmount(
                                    position.nativeMarketValue,
                                    position.nativeCurrency,
                                  )}
                                </em>
                              ) : null}
                            </span>
                            <span className="tool-drawer__holding-main-profit-group">
                              <strong
                                className={`tool-drawer__holding-main-profit${profitToneClass ? ` ${profitToneClass}` : ''}`}
                              >
                                {profitText}
                              </strong>
                              {isForeignHolding && nativeProfitText ? (
                                <em className="tool-drawer__holding-main-native">
                                  {nativeProfitText}
                                </em>
                              ) : null}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="tool-drawer__holding-edit"
                          onClick={() => beginEditHolding(activeAccountEntry, item, itemIndex)}
                        >
                          {language === 'en' ? 'Edit' : '수정'}
                        </button>
                        <button
                          type="button"
                          className="tool-drawer__holding-remove"
                          onClick={() => {
                            onInteract?.();
                            onRemovePortfolioHolding?.({
                              entryId: activeAccountEntry.id,
                              itemId,
                              itemIds,
                              itemIndex,
                              itemIndexes,
                            });
                          }}
                          aria-label={language === 'en' ? 'Remove holding' : '종목 삭제'}
                        >
                          ×
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="tool-drawer__empty">
                  {language === 'en'
                    ? 'No stocks in this portfolio.'
                    : '이 포트폴리오에 종목이 없습니다.'}
                </p>
              )}
            </section>
          ) : null}
        </div>
      );
    }

    if (resolvedTool.key === 'manual') {
      return <div className="tool-drawer__manual-panel">{renderManualEntryPanel()}</div>;
    }

    if (resolvedTool.key === 'overview') {
      return (
        <div className="tool-drawer__overview">
          {groupOptions.length ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide tool-drawer__overview-card--groups">
              <p>{language === 'en' ? 'Category Filter' : '카테고리 필터'}</p>
              <div className="tool-drawer__group-grid">
                {groupOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`group-dock__option tool-drawer__group-option${option.key === activeGroupKey ? ' is-active' : ''}`}
                    onClick={() => {
                      onInteract?.();
                      onGroupChange(option.key);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {analyticsSummary ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide tool-drawer__analytics-card">
              <p>{language === 'en' ? 'Service Analytics' : '서비스 분석'}</p>
              <div className="tool-drawer__analytics-grid">
                {analyticsKpis.map((metric) => (
                  <div
                    key={metric.key}
                    className={
                      'tool-drawer__analytics-metric' + (metric.tone ? ' is-' + metric.tone : '')
                    }
                  >
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
              <div className="tool-drawer__analytics-readout">
                <span>
                  <em>{language === 'en' ? 'Top' : '상위종목'}</em>
                  <strong>
                    {analyticsTopHolding
                      ? compactLabel(analyticsTopHolding.label, 14) +
                        ' · ' +
                        formatAllocationPercent(analyticsTopHolding.weight)
                      : '-'}
                  </strong>
                </span>
                <span>
                  <em>{language === 'en' ? 'Concentration' : '집중도'}</em>
                  <strong>
                    {concentrationLevelLabel(
                      analyticsSummary.concentration?.concentrationLevel,
                      language,
                    )}
                    {' · '}
                    {formatAnalyticsCompactValue(
                      analyticsSummary.concentration?.effectiveHoldings,
                      language,
                    )}
                  </strong>
                </span>
                <span>
                  <em>{language === 'en' ? 'Rebalance' : '리밸런싱'}</em>
                  <strong>
                    {analyticsGap
                      ? analyticsGap.label +
                        ' ' +
                        formatAnalyticsPercentValue(analyticsGap.gapWeightPercent)
                      : '-'}
                  </strong>
                </span>
              </div>
            </section>
          ) : null}

          {heatmap ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
              <p>{language === 'en' ? 'Daily P/L' : '날짜별 손익률'}</p>
              <HeatmapCardView
                heatmap={heatmap}
                language={language}
                className="heatmap-panel heatmap-panel--drawer"
              />
            </section>
          ) : null}

          <div className="tool-drawer__overview-grid">
            {scorecard || overallScorecard ? (
              <section className="tool-drawer__overview-card tool-drawer__overview-card--score">
                <div className="tool-drawer__overview-card-head">
                  <p>{language === 'en' ? 'Portfolio Scores' : '포트폴리오 점수'}</p>
                </div>

                <div
                  className="tool-drawer__score-mode-grid"
                  aria-label={language === 'en' ? 'Score weighting mode' : '점수 가중치 선택'}
                >
                  {[
                    {
                      key: 'balanced',
                      label: language === 'en' ? 'Balanced' : '균형형',
                    },
                    {
                      key: 'longTermReturnFocus',
                      label: language === 'en' ? 'Future' : '미래지향',
                    },
                    {
                      key: 'stabilityFocus',
                      label: language === 'en' ? 'Stable' : '안정형',
                    },
                    {
                      key: 'returnFocus',
                      label: language === 'en' ? 'Aggressive' : '공격형',
                    },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`tool-drawer__score-mode${scoreWeightPreset === option.key ? ' is-active' : ''}`}
                      onClick={() => {
                        onInteract?.();
                        onScoreWeightPresetChange?.(option.key);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="tool-drawer__score-chart-stack">
                  {scorecard ? (
                    <div className="tool-drawer__score-chart-block">
                      <span>
                        {language === 'en' ? 'Current portfolio score' : '현재 포트폴리오 점수'}
                      </span>
                      <PortfolioScoreCardView
                        scorecard={scorecard}
                        axes={scoreAxes}
                        language={language}
                        className="score-panel score-panel--drawer"
                      />
                    </div>
                  ) : null}

                  {overallScorecard ? (
                    <div className="tool-drawer__score-chart-block">
                      <span>
                        {language === 'en' ? 'Total portfolio score' : '전체 포트폴리오 점수'}
                      </span>
                      <PortfolioScoreCardView
                        scorecard={overallScorecard}
                        axes={scoreAxes}
                        language={language}
                        className="score-panel score-panel--drawer"
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {allocation ? (
              <section className="tool-drawer__overview-card">
                <p>{language === 'en' ? 'Portfolio Mix' : '포트폴리오 비중'}</p>
                <PortfolioAllocationCardView
                  allocation={allocation}
                  language={language}
                  className="allocation-panel allocation-panel--drawer"
                  onInteract={onInteract}
                />
              </section>
            ) : null}
          </div>

          {analyticsSummary?.profitFlow?.length ? renderMonthlyReportPanel() : null}
        </div>
      );
    }

    if (resolvedTool.key === 'compare') {
      return renderComparePanel();
    }

    if (resolvedTool.key === 'twin') {
      return (
        <DigitalTwinPanel
          items={items}
          timelineItems={timelineItems}
          className="twin-panel--drawer"
        />
      );
    }

    if (resolvedTool.key === 'news') {
      return <MarketNewsPanel items={items} language={language} dateBasis={dateBasis} />;
    }

    if (resolvedTool.key === 'settings') {
      return renderSettingsPanel?.();
    }

    return null;
  };

  return (
    <aside
      className={`tool-drawer${open ? ' is-open' : ''}${open && resolvedTool ? ' has-panel' : ''}${resizing ? ' is-resizing' : ''}`}
      data-dock={dock}
      style={{
        ...layerStyle,
        // Always the full expanded size now — open/closed no longer toggles this element's own
        // box size at all (that was the width-transition perf problem); see .tool-drawer's CSS
        // for how the closed state is conveyed instead (a clip-path). Both vars are always set
        // (not just the one the current dock uses) since dock can change while open/mid-drag —
        // no reason the unused axis' value should ever be stale.
        '--tool-drawer-width': `${drawerWidth}px`,
      }}
    >
      <div className="tool-drawer__window">
        <div className="tool-drawer__rail" aria-label={text.toolMenuAria}>
          <div
            className="tool-drawer__dock-handle"
            role="button"
            tabIndex={0}
            aria-label={
              language === 'en'
                ? 'Drag to move this panel to an edge'
                : '드래그해서 패널 위치를 옮기기'
            }
            title={language === 'en' ? 'Drag to dock left or right' : '드래그해서 좌/우에 도킹'}
            onPointerDown={handleDockDragPointerDown}
          />
          {tools
            .filter((tool) => !tool.hidden)
            .map((tool) => (
              <button
                key={tool.key}
                type="button"
                className={`tool-drawer__button tool-drawer__button--${tool.key}${open && tool.key === resolvedTool?.key ? ' is-active' : ''}`}
                aria-label={tool.label}
                title={tool.label}
                onClick={() => {
                  onInteract?.();
                  onSelectTool(tool.key);
                }}
              >
                <span className="tool-drawer__button-icon">{tool.icon}</span>
                {/* Short on-rail label — full `tool.label` still does the aria-label/title job above
                  (screen readers, hover tooltip); this is purely the at-a-glance text so each tool
                  reads without hovering first. */}
                <span className="tool-drawer__button-label">{tool.shortLabel}</span>
              </button>
            ))}
        </div>

        <section className="tool-drawer__panel" aria-live="polite" ref={panelRef}>
          {open && resolvedTool ? (
            <div className="tool-drawer__body">{renderActivePanel()}</div>
          ) : (
            <div className="tool-drawer__body">
              <p className="tool-drawer__empty">
                {language === 'en'
                  ? 'Choose a tool from the left rail.'
                  : '왼쪽 도구를 선택하면 이 창에서 열립니다.'}
              </p>
            </div>
          )}

          <div
            className="tool-drawer__resize-handle"
            role="separator"
            aria-label={language === 'en' ? 'Resize tool panel' : '도구 패널 너비 조절'}
            aria-orientation="vertical"
            tabIndex={open ? 0 : -1}
            onPointerDown={handleResizePointerDown}
            onKeyDown={handleResizeKeyDown}
          />

          {open &&
          resolvedTool?.key === 'accounts' &&
          activeAccountEntry &&
          activeSelectedHolding ? (
            <aside
              className="tool-drawer__detail-popout"
              aria-label={language === 'en' ? 'Stock details' : '종목 정보'}
            >
              <StockDetailCard
                item={activeSelectedHolding.item}
                language={language}
                baseCurrency={baseCurrency}
                fxRates={fxRates}
                onEdit={() =>
                  beginEditHolding(
                    activeAccountEntry,
                    activeSelectedHolding.item,
                    activeSelectedHolding.itemIndex,
                  )
                }
                onClose={() => {
                  onInteract?.();
                  setSelectedHolding(null);
                  onClearHoldingFocus?.();
                }}
              />
            </aside>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
