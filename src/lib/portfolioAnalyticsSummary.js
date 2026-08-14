import { buildFxRates, convertCurrencyAmount, inferHoldingCurrency } from '../utils/currency.js';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function parseNumber(value) {
  const raw = String(value ?? '').trim().replace(/[−–—]/g, '-');
  if (!raw) {
    return null;
  }

  const unitMultiplier =
    /억/.test(raw) ? 100000000 : /만/.test(raw) ? 10000 : /천/.test(raw) ? 1000 : 1;
  const numeric = Number.parseFloat(
    raw
      .replace(/[,%₩원$€¥￦\s]/g, '')
      .replace(/[^0-9.+-]/g, ''),
  );
  const shouldNegate = /^\(.*\)$/.test(raw) || /(?:손실|loss|▼|↓)/i.test(raw);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return (shouldNegate && numeric > 0 ? -numeric : numeric) * unitMultiplier;
}

function parsePercent(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const parsed = parseNumber(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return raw.includes('%') || Math.abs(parsed) > 1 ? parsed : parsed * 100;
}

function findFieldValue(fields = [], candidates = []) {
  const normalizedCandidates = candidates.map(normalizeText);

  for (const field of fields) {
    const label = normalizeText(field?.label);
    if (normalizedCandidates.some((candidate) => label === candidate)) {
      return field?.value;
    }
  }

  for (const field of fields) {
    const label = normalizeText(field?.label);
    if (normalizedCandidates.some((candidate) => label.includes(candidate))) {
      return field?.value;
    }
  }

  return '';
}

function findFieldValueExcept(fields = [], candidates = [], excludedCandidates = []) {
  const normalizedExcluded = excludedCandidates.map(normalizeText);
  const filteredFields = fields.filter((field) => {
    const label = normalizeText(field?.label);
    return !normalizedExcluded.some((candidate) => label.includes(candidate));
  });

  return findFieldValue(filteredFields, candidates);
}

function parseDateValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const localMatch = raw.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  const compact = raw.replace(/[.\-/]/g, '');
  const match =
    localMatch ??
    (/^\d{8}$/.test(compact)
      ? // eslint-disable-next-line no-sparse-arrays -- mimics a regex match array (index 0 is the unused full match)
        [, compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8)]
      : raw.replace(/[./]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/));

  if (match) {
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime())
    ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    : null;
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function periodKey(date, period) {
  if (period === 'day') {
    return dateKey(date);
  }

  if (period === 'year') {
    return String(date.getFullYear());
  }

  if (period === 'week') {
    const start = new Date(date);
    const delta = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - delta);
    return dateKey(start);
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const FIELD_CANDIDATES = {
  buyAmount: [
    'purchaseamount',
    'costbasis',
    'bookvalue',
    'investedamount',
    'principal',
    '매입금액',
    '매수금액',
    '투자원금',
    '취득금액',
    '원금',
  ],
  buyPrice: ['buyprice', 'purchaseprice', 'entryprice', 'averageprice', '매수가', '매입가', '평균단가'],
  currentPrice: ['currentprice', 'marketprice', 'lastprice', 'price', '현재가', '평가가', '가격'],
  marketValue: [
    'marketvalue',
    'currentvalue',
    'evaluationamount',
    'valuation',
    'value',
    'amount',
    '평가금액',
    '평가액',
    '현재가치',
    '보유금액',
    '금액',
  ],
  profitAmount: [
    'profitloss',
    'gainloss',
    'pnl',
    'profit',
    'gain',
    'unrealizedpnl',
    'realizedpnl',
    '손익',
    '수익',
    '수익금',
    '손익금',
    '평가손익',
    '실현손익',
    '손익금액',
  ],
  returnRate: [
    'return',
    'returns',
    'returnrate',
    'rateofreturn',
    'profitrate',
    'performance',
    'change',
    'yield',
    'totalreturn',
    'returnpct',
    '수익률',
    '수익율',
    '손익률',
    '손익율',
    '평가손익률',
  ],
  shares: ['shares', 'quantity', 'holding', 'holdings', 'units', '보유수량', '수량', '잔고수량'],
  date: [
    'date',
    'day',
    'tradedate',
    'tradingdate',
    'valuationdate',
    'snapshotdate',
    'asofdate',
    'buydate',
    'purchasedate',
    'entrydate',
    'acquisitiondate',
    '날짜',
    '일자',
    '기준일',
    '거래일',
    '평가일',
    '조회일',
    '매수일',
    '매입일',
    '취득일',
  ],
  weight: ['weight', 'allocation', 'ratio', 'portion', 'portfolio', '비중', '편입비', '구성비', '보유비중'],
  assetClass: ['assetclass', 'assettype', 'assetcategory', '자산구분', '자산군', '자산유형'],
  region: ['region', 'country', 'market', '지역', '국가', '시장'],
};

function readWeight(item) {
  const raw = findFieldValue(item?.fields, FIELD_CANDIDATES.weight);
  const parsed = parseNumber(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return raw.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function readReturnRate(item) {
  const detailReturn = parsePercent(item?.detail);
  if (Number.isFinite(detailReturn)) {
    return detailReturn;
  }

  return parsePercent(findFieldValue(item?.fields, FIELD_CANDIDATES.returnRate));
}

function readLabel(item, index) {
  const fieldLabel = findFieldValue(item?.fields, [
    'stockname',
    'securityname',
    'assetname',
    'productname',
    'companyname',
    '종목명',
    '자산명',
    '상품명',
  ]);

  return (
    String(item?.label ?? item?.name ?? fieldLabel ?? item?.code ?? '').trim() ||
    `종목 ${index + 1}`
  );
}

function readGroupLabel(item, key, candidates, fallback = '미분류') {
  return String(item?.[key] ?? findFieldValue(item?.fields, candidates) ?? '').trim() || fallback;
}

function classifyRebalanceBucket(item) {
  const text = [
    item?.label,
    item?.name,
    item?.code,
    item?.region,
    item?.sector,
    item?.assetClass,
    item?.style,
    ...(item?.fields ?? []).flatMap((field) => [field.label, field.value]),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(' ');

  if (/리츠|부동산|reit|real estate|property/.test(text)) {
    return 'reit';
  }

  if (/금(?!액|융)|현금|예수금|단기|원자재|gold|cash|money market|deposit|iau|gld|sgov|bil/.test(text)) {
    return 'goldCash';
  }

  if (/배당|인컴|dividend|income|schd|dgro|vym/.test(text)) {
    return 'dividend';
  }

  if (/주식|stock|equity|etf|fund|qqq|spy|voo|vti|nasdaq|s&p/.test(text)) {
    return 'stock';
  }

  return 'other';
}

// Exported (not just used internally for the aggregate summary) so a single-holding UI — the
// portfolio holdings list row, the holding-detail card — can compute the exact same
// buyAmount/marketValue/profitAmount/returnRate/currency figures the totals are built from,
// instead of a second, potentially-drifting implementation of the same math living in App.jsx.
export function resolveHoldingPosition(item, options) {
  return resolvePosition(item, 0, options);
}

function resolvePosition(item, index, { fxRates, baseCurrency } = {}) {
  const shares = parseNumber(findFieldValue(item?.fields, FIELD_CANDIDATES.shares));
  const buyPrice = parseNumber(findFieldValue(item?.fields, FIELD_CANDIDATES.buyPrice));
  const currentPrice = parseNumber(findFieldValue(item?.fields, FIELD_CANDIDATES.currentPrice));
  const explicitBuyAmount = parseNumber(findFieldValue(item?.fields, FIELD_CANDIDATES.buyAmount));
  const explicitMarketValue = parseNumber(
    findFieldValueExcept(item?.fields, FIELD_CANDIDATES.marketValue, [
      'buy',
      'purchase',
      'entry',
      'costbasis',
      'invested',
      'principal',
      '매입',
      '매수',
      '취득',
      '투자원금',
      '원금',
    ]),
  );
  // findFieldValueExcept, not the plain findFieldValue — profitAmount's own candidate list
  // includes bare '손익'/'수익', and Korean return-rate labels ('수익률', '손익률', '평가손익률')
  // all literally contain one of those as a substring, so the fuzzy second pass in findFieldValue
  // was matching a *rate* field (e.g. "+15.04%") as if it were the *amount* field. That string
  // parsed to a small number (15.04) which used to just look like a wrong-but-small figure — but
  // once resolvePosition started converting profitAmount by the live FX rate (to fix the
  // currency-mixing bug), the same mismatch multiplied that number by ~1,000+ into a wildly wrong,
  // very-visible one. Reproduced directly: a QQQM holding's 수익률 field ("+15.04%") was being read
  // as its 평가손익, then FX-converted, instead of the real profit ever being computed from
  // marketValue - buyAmount at all.
  const explicitProfitAmount = parseNumber(
    findFieldValueExcept(item?.fields, FIELD_CANDIDATES.profitAmount, FIELD_CANDIDATES.returnRate),
  );
  const returnRate = readReturnRate(item);

  const buyAmount =
    explicitBuyAmount ??
    (Number.isFinite(buyPrice) && buyPrice > 0 && Number.isFinite(shares) && shares > 0
      ? buyPrice * shares
      : null);
  const marketValue =
    explicitMarketValue ??
    (Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(shares) && shares > 0
      ? currentPrice * shares
      : null) ??
    (Number.isFinite(buyAmount) && buyAmount > 0 && Number.isFinite(returnRate)
      ? buyAmount * (1 + returnRate / 100)
      : null);
  const profitAmount =
    explicitProfitAmount ??
    (Number.isFinite(marketValue) && Number.isFinite(buyAmount) ? marketValue - buyAmount : null);
  const computedReturnRate =
    Number.isFinite(returnRate)
      ? returnRate
      : Number.isFinite(profitAmount) && Number.isFinite(buyAmount) && buyAmount > 0
        ? (profitAmount / buyAmount) * 100
        : null;

  // buyAmount/marketValue/profitAmount above are in whatever currency this holding's own
  // buyPrice/currentPrice/explicit fields were denominated in (nativeCurrency) — a foreign
  // holding's numbers are still in USD at this point. Everything that gets summed *across*
  // positions (totals, weights, group-by-currency-blind buckets) has to be converted to one
  // common baseCurrency first, or a $1,600 USD position silently adds to a ₩700,000 KRW position
  // as if both were the same unit. The native (unconverted) figures are kept alongside the
  // converted ones so a holding-level UI can still show "USD 평가금액" as secondary detail.
  const nativeCurrency = inferHoldingCurrency({ ...item, currency: item?.currency, marketCurrency: item?.marketCurrency });
  const resolvedBaseCurrency = baseCurrency || 'KRW';
  const resolvedFxRates = fxRates || buildFxRates();
  const convert = (value) =>
    Number.isFinite(value)
      ? convertCurrencyAmount(value, nativeCurrency, resolvedBaseCurrency, resolvedFxRates)
      : null;

  return {
    id: item?.id ?? item?.code ?? item?.label ?? `position-${index + 1}`,
    label: readLabel(item, index),
    code: String(item?.code ?? '').trim(),
    item,
    currency: resolvedBaseCurrency,
    nativeCurrency,
    nativeBuyAmount: buyAmount,
    nativeMarketValue: marketValue,
    nativeProfitAmount: profitAmount,
    buyAmount: convert(buyAmount),
    marketValue: convert(marketValue),
    profitAmount: convert(profitAmount),
    returnRate: computedReturnRate,
    explicitWeight: readWeight(item),
    assetClass: readGroupLabel(item, 'assetClass', FIELD_CANDIDATES.assetClass),
    region: readGroupLabel(item, 'region', FIELD_CANDIDATES.region),
    sector: String(item?.sector ?? '').trim() || '미분류',
    bucket: classifyRebalanceBucket(item),
  };
}

function assignPositionWeights(positions) {
  const marketTotal = positions.reduce((sum, position) => sum + Math.max(0, position.marketValue ?? 0), 0);
  const buyTotal = positions.reduce((sum, position) => sum + Math.max(0, position.buyAmount ?? 0), 0);
  const explicitTotal = positions.reduce((sum, position) => sum + Math.max(0, position.explicitWeight ?? 0), 0);
  const fallbackTotal = marketTotal || buyTotal || (explicitTotal > 0 ? 100 : positions.length);

  return positions.map((position) => {
    let basisValue = 0;
    let weightSource = 'equal';

    if (marketTotal > 0) {
      basisValue = Math.max(0, position.marketValue ?? 0);
      weightSource = 'marketValue';
    } else if (buyTotal > 0) {
      basisValue = Math.max(0, position.buyAmount ?? 0);
      weightSource = 'buyAmount';
    } else if (explicitTotal > 0) {
      basisValue = (Math.max(0, position.explicitWeight ?? 0) / explicitTotal) * fallbackTotal;
      weightSource = 'weight';
    } else {
      basisValue = positions.length ? 1 : 0;
    }

    return {
      ...position,
      basisValue,
      weight: fallbackTotal > 0 ? basisValue / fallbackTotal : 0,
      weightSource,
    };
  });
}

function groupByWeight(positions, key) {
  const groups = new Map();

  for (const position of positions) {
    const label = String(position[key] ?? '').trim() || '미분류';
    const previous = groups.get(label) ?? {
      label,
      weight: 0,
      value: 0,
      count: 0,
      profitAmount: 0,
      weightedReturnTotal: 0,
      returnWeight: 0,
    };

    previous.weight += position.weight;
    previous.value += position.basisValue;
    previous.count += 1;
    previous.profitAmount += Number.isFinite(position.profitAmount) ? position.profitAmount : 0;
    if (Number.isFinite(position.returnRate)) {
      previous.weightedReturnTotal += position.returnRate * position.weight;
      previous.returnWeight += position.weight;
    }
    groups.set(label, previous);
  }

  return [...groups.values()]
    .map((group) => ({
      label: group.label,
      weight: group.weight,
      weightPercent: group.weight * 100,
      value: group.value,
      count: group.count,
      profitAmount: group.profitAmount,
      returnRate: group.returnWeight > 0 ? group.weightedReturnTotal / group.returnWeight : null,
    }))
    .sort((left, right) => right.weight - left.weight);
}

function normalizeTargetWeights(targetWeights = {}, fallbackLabels = []) {
  const rawEntries = Object.entries(targetWeights)
    .map(([label, value]) => [label, parsePercent(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0);

  if (!rawEntries.length && fallbackLabels.length) {
    const equal = 1 / fallbackLabels.length;
    return Object.fromEntries(fallbackLabels.map((label) => [label, equal]));
  }

  const total = rawEntries.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(rawEntries.map(([label, value]) => [label, total > 0 ? value / total : 0]));
}

function createRebalanceGaps(currentGroups, targetWeights = {}) {
  const targets = normalizeTargetWeights(
    targetWeights,
    Object.keys(targetWeights).length ? [] : currentGroups.map((group) => group.label),
  );
  const labels = [...new Set([...currentGroups.map((group) => group.label), ...Object.keys(targets)])];
  const currentByLabel = new Map(currentGroups.map((group) => [group.label, group]));

  return labels
    .map((label) => {
      const current = currentByLabel.get(label);
      const currentWeight = current?.weight ?? 0;
      const targetWeight = targets[label] ?? 0;

      return {
        label,
        currentWeight,
        currentWeightPercent: currentWeight * 100,
        targetWeight,
        targetWeightPercent: targetWeight * 100,
        gapWeight: targetWeight - currentWeight,
        gapWeightPercent: (targetWeight - currentWeight) * 100,
        tradeValue: (targetWeight - currentWeight) * currentGroups.reduce((sum, group) => sum + group.value, 0),
      };
    })
    .sort((left, right) => Math.abs(right.gapWeight) - Math.abs(left.gapWeight));
}

function extractTimelinePoint(item, currencyOptions) {
  const date = parseDateValue(findFieldValue(item?.fields, FIELD_CANDIDATES.date));
  if (!date) {
    return null;
  }

  // Same reasoning as createPortfolioAnalyticsSummary's own positions: a timeline can interleave
  // rows from several different holdings (see portfolio_test1.csv-style daily-value exports), so
  // each point needs converting to one common currency before profitFlow sums them by period —
  // otherwise a single foreign-holding day in the series would spike/crater that period's total.
  const position = resolvePosition(item, 0, currencyOptions);
  const returnRate = position.returnRate;
  const profitAmount = position.profitAmount;

  if (!Number.isFinite(returnRate) && !Number.isFinite(profitAmount)) {
    return null;
  }

  return {
    date,
    returnRate,
    profitAmount,
    marketValue: position.marketValue,
    buyAmount: position.buyAmount,
  };
}

function createProfitFlow(timelineItems, period = 'month', currencyOptions) {
  const points = (Array.isArray(timelineItems) ? timelineItems : [])
    .map((item) => extractTimelinePoint(item, currencyOptions))
    .filter(Boolean);
  const groups = new Map();

  points.forEach((point) => {
    const key = periodKey(point.date, period);
    const previous = groups.get(key) ?? {
      periodKey: key,
      startDate: point.date,
      endDate: point.date,
      profitAmount: 0,
      marketValue: 0,
      buyAmount: 0,
      returnTotal: 0,
      returnCount: 0,
      entriesCount: 0,
    };

    previous.startDate = point.date < previous.startDate ? point.date : previous.startDate;
    previous.endDate = point.date > previous.endDate ? point.date : previous.endDate;
    previous.profitAmount += Number.isFinite(point.profitAmount) ? point.profitAmount : 0;
    previous.marketValue += Number.isFinite(point.marketValue) ? point.marketValue : 0;
    previous.buyAmount += Number.isFinite(point.buyAmount) ? point.buyAmount : 0;
    if (Number.isFinite(point.returnRate)) {
      previous.returnTotal += point.returnRate;
      previous.returnCount += 1;
    }
    previous.entriesCount += 1;
    groups.set(key, previous);
  });

  return [...groups.values()]
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
    .map((group) => ({
      periodKey: group.periodKey,
      startDate: dateKey(group.startDate),
      endDate: dateKey(group.endDate),
      profitAmount: group.profitAmount,
      returnRate:
        group.buyAmount > 0
          ? (group.profitAmount / group.buyAmount) * 100
          : group.returnCount
            ? group.returnTotal / group.returnCount
            : null,
      marketValue: group.marketValue || null,
      buyAmount: group.buyAmount || null,
      entriesCount: group.entriesCount,
    }));
}

function createConcentration(positions, topN) {
  const sorted = [...positions].sort((left, right) => right.weight - left.weight);
  const hhi = positions.reduce((sum, position) => sum + position.weight ** 2, 0);
  const topHoldings = sorted.slice(0, topN).map((position) => ({
    id: position.id,
    label: position.label,
    code: position.code,
    weight: position.weight,
    weightPercent: position.weight * 100,
    value: position.basisValue,
    returnRate: position.returnRate,
  }));

  return {
    topHoldings,
    topWeight: sorted[0]?.weight ?? 0,
    topWeightPercent: (sorted[0]?.weight ?? 0) * 100,
    topNWeight: topHoldings.reduce((sum, position) => sum + position.weight, 0),
    topNWeightPercent: topHoldings.reduce((sum, position) => sum + position.weight, 0) * 100,
    hhi,
    hhiPercent: hhi * 100,
    effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
    concentrationLevel: hhi >= 0.25 ? 'high' : hhi >= 0.12 ? 'medium' : 'low',
  };
}

export function createPortfolioAnalyticsSummary(items = [], timelineItems = [], options = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const period = options.period ?? 'month';
  const topN = Math.max(1, Math.round(parseNumber(options.topN) ?? 5));
  const baseCurrency = options.baseCurrency || 'KRW';
  const fxRates = options.fxRates || buildFxRates(options.usdKrwRate);
  const positions = assignPositionWeights(
    sourceItems.map((item, index) => resolvePosition(item, index, { fxRates, baseCurrency })),
  );
  const totalMarketValue = positions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  const totalBuyAmount = positions.reduce((sum, position) => sum + (position.buyAmount ?? 0), 0);
  const totalProfitAmount =
    positions.reduce((sum, position) => sum + (position.profitAmount ?? 0), 0) ||
    (totalMarketValue && totalBuyAmount ? totalMarketValue - totalBuyAmount : 0);
  const returnWeight = positions.reduce(
    (sum, position) => sum + (Number.isFinite(position.returnRate) ? position.weight : 0),
    0,
  );
  const weightedReturnRate = positions.reduce(
    (sum, position) =>
      sum + (Number.isFinite(position.returnRate) ? position.returnRate * position.weight : 0),
    0,
  );
  const assetClassWeights = groupByWeight(positions, 'assetClass');
  const regionWeights = groupByWeight(positions, 'region');
  const bucketWeights = groupByWeight(positions, 'bucket');

  return {
    totals: {
      holdingsCount: positions.length,
      evaluatedPositionsCount: positions.filter((position) => Number.isFinite(position.marketValue)).length,
      totalMarketValue: totalMarketValue || null,
      totalBuyAmount: totalBuyAmount || null,
      totalProfitAmount,
      totalReturnRate:
        totalBuyAmount > 0
          ? (totalProfitAmount / totalBuyAmount) * 100
          : returnWeight > 0
            ? weightedReturnRate / returnWeight
            : null,
      valueSource: positions[0]?.weightSource ?? 'none',
      // Every total above is converted to this one currency before summing (see resolvePosition) —
      // callers no longer need to guess whether totalMarketValue etc. is "mixed units".
      baseCurrency,
    },
    positions: positions.map((position) => ({
      id: position.id,
      label: position.label,
      code: position.code,
      buyAmount: position.buyAmount,
      marketValue: position.marketValue,
      profitAmount: position.profitAmount,
      currency: position.currency,
      nativeCurrency: position.nativeCurrency,
      nativeBuyAmount: position.nativeBuyAmount,
      nativeMarketValue: position.nativeMarketValue,
      nativeProfitAmount: position.nativeProfitAmount,
      returnRate: position.returnRate,
      weight: position.weight,
      weightPercent: position.weight * 100,
      assetClass: position.assetClass,
      region: position.region,
      sector: position.sector,
      bucket: position.bucket,
    })),
    profitFlow: createProfitFlow(timelineItems?.length ? timelineItems : sourceItems, period, {
      fxRates,
      baseCurrency,
    }),
    concentration: createConcentration(positions, topN),
    assetClassWeights,
    regionWeights,
    rebalanceGaps: {
      assetClass: createRebalanceGaps(assetClassWeights, options.targetAssetClassWeights),
      region: createRebalanceGaps(regionWeights, options.targetRegionWeights),
      bucket: createRebalanceGaps(bucketWeights, options.targetBucketWeights),
    },
    metadata: {
      period,
      topN,
      timelineCount: Array.isArray(timelineItems) ? timelineItems.length : 0,
      createdAt: new Date().toISOString(),
    },
  };
}
