function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function parseNumericValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseReturnValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[,%\s]/g, ''));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return trimmed.includes('%') || Math.abs(numeric) > 1 ? numeric : numeric * 100;
}

function findFieldValue(fields, candidates) {
  const normalizedCandidates = candidates.map(normalizeText);

  for (const field of fields ?? []) {
    const label = normalizeText(field.label);
    if (normalizedCandidates.some((candidate) => label.includes(candidate))) {
      return field.value;
    }
  }

  return '';
}

function resolveAssetClass(item) {
  const direct =
    typeof item.assetClass === 'string'
      ? item.assetClass.trim()
      : '';

  if (direct) {
    return direct;
  }

  return findFieldValue(item.fields, [
    'assetclass',
    'assettype',
    'assetcategory',
    '자산구분',
    '자산군',
    '자산유형',
  ]).trim();
}

function normalizeJoinedText(item) {
  return [
    item.label,
    item.name,
    item.assetClass,
    item.sector,
    item.style,
    item.region,
    ...(item.fields ?? []).flatMap((field) => [field.label, field.value]),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(' ');
}

function classifyAllocationLabel(item, mode = 'auto') {
  const directAssetClass = resolveAssetClass(item);
  if (mode === 'preferOriginal' && directAssetClass) {
    return directAssetClass;
  }

  const assetClass = normalizeText(directAssetClass);
  const sector = normalizeText(item.sector);
  const style = normalizeText(item.style);
  const region = normalizeText(item.region);
  const joined = normalizeJoinedText(item);

  const isCashLike = /cash|cma|mmf|money market|deposit|savings|usd|krw|예수금|현금|현금성|단기자금|단기채|파킹/.test(
    joined,
  );
  if (isCashLike) {
    return '현금성 자산';
  }

  const isDigitalAsset = /bitcoin|btc|ethereum|eth|crypto|digital asset|가상자산|암호화폐|코인/.test(
    joined,
  );
  if (isDigitalAsset) {
    return '디지털 자산';
  }

  const isReitLike = /reit|real estate|property|부동산|리츠/.test(joined);
  if (isReitLike) {
    return '리츠/부동산';
  }

  const isBondLike = /bond|treasury|fixed income|credit|채권|국채|회사채/.test(joined) || assetClass.includes('채권');
  if (isBondLike) {
    return '채권 ETF';
  }

  const isCommodityLike =
    /gold|silver|commodity|oil|copper|원자재|귀금속|원유|은|구리/.test(joined) ||
    assetClass.includes('원자재') ||
    sector === '금';
  if (isCommodityLike) {
    return '금/원자재 ETF';
  }

  const isDividendLike = /dividend|income|배당/.test(joined) || style.includes('배당');
  const isEtfLike =
    /etf|fund|index|trust|tracker|상장지수|인덱스|펀드/.test(joined) ||
    assetClass.includes('etf') ||
    assetClass.includes('fund');

  const isKorean =
    region.includes('한국') ||
    region.includes('korea') ||
    /^\d{6}$/.test(String(item.code ?? '').trim());
  const isUS =
    region.includes('미국') ||
    region.includes('us') ||
    region.includes('unitedstates');
  const isGlobal =
    /global|world|international|해외|글로벌|전세계|세계|선진국|신흥국|유럽|일본|중국|홍콩|캐나다/.test(
      `${region} ${joined}`,
    );

  if (isEtfLike) {
    if (isDividendLike) {
      return '배당 ETF';
    }

    if (isKorean) {
      return '국내 주식 ETF';
    }

    if (isUS) {
      return '미국 주식 ETF';
    }

    if (isGlobal) {
      return '글로벌 주식 ETF';
    }

    return '글로벌 주식 ETF';
  }

  const isEquityLike =
    /stock|equity|share|common|ordinary|주식|보통주/.test(joined) ||
    assetClass.includes('주식') ||
    assetClass.includes('stock') ||
    assetClass.includes('equity') ||
    Boolean(item.code || item.label);

  if (isEquityLike) {
    if (isKorean) {
      return '국내 주식';
    }

    if (isUS) {
      return '미국 주식';
    }

    if (isGlobal) {
      return '해외 주식';
    }

    return '해외 주식';
  }

  if (/alternative|private|infrastructure|hedge|대체|인프라|원자재|사모/.test(joined)) {
    return '대체자산';
  }

  return '기타 자산';
}

function parseExplicitWeight(item) {
  const rawValue = findFieldValue(item.fields, [
    'weight',
    'allocation',
    'ratio',
    'portion',
    'portfolio',
    '비중',
    '편입비',
    '구성비',
    '보유비중',
  ]);
  const parsed = parseNumericValue(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return rawValue.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function parseBuyPrice(item) {
  return parseNumericValue(
    findFieldValue(item.fields, [
      'buyprice',
      'purchaseprice',
      'entryprice',
      'averageprice',
      'costbasis',
      '매수가',
      '매입가',
      '취득가',
      '평균단가',
    ]),
  );
}

function parseShares(item) {
  return parseNumericValue(
    findFieldValue(item.fields, [
      'shares',
      'quantity',
      'holding',
      'holdings',
      'units',
      '보유수량',
      '수량',
      '보유주식수',
      '잔고수량',
    ]),
  );
}

function parseQuantityValue(item) {
  const shares = parseShares(item);
  return Number.isFinite(shares) && shares > 0 ? shares : null;
}

function parsePositionValue(item) {
  const buyPrice = parseBuyPrice(item);
  const shares = parseShares(item);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(shares) || shares <= 0) {
    return null;
  }

  return buyPrice * shares;
}

function parseItemReturn(item) {
  const detailReturn = parseReturnValue(item.detail);

  if (Number.isFinite(detailReturn)) {
    return detailReturn;
  }

  return parseReturnValue(
    findFieldValue(item.fields, [
      'return',
      'returns',
      'returnrate',
      'rateofreturn',
      'profitrate',
      'performance',
      'change',
      'yield',
      'gain',
      'totalreturn',
      'returnpct',
      '수익률',
      '등락률',
      '변동률',
      '손익률',
    ]),
  );
}

function normalizeWeights(values, source) {
  const validValues = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = validValues.reduce((sum, value) => sum + value, 0);

  if (total <= 0.001) {
    return null;
  }

  return {
    weights: validValues.map((value) => value / total),
    source,
  };
}

function extractAutoWeights(items, marketValues = null) {
  const explicitWeights = items.map(parseExplicitWeight);
  const positionValues = items.map(parsePositionValue);
  const equalWeight = items.length ? 1 / items.length : 0;
  const equalWeights = items.map(() => equalWeight);
  // Market values already converted to one currency (same figures as the 요약 totals). Cost basis
  // (buyPrice x shares) stays only as a fallback: using it first made the donut disagree with
  // 요약's 상위종목, and a stale buy price could make a small holding look like the largest one.
  const marketWeights =
    Array.isArray(marketValues) && marketValues.length === items.length
      ? normalizeWeights(marketValues, 'marketValue')
      : null;

  return (
    normalizeWeights(explicitWeights, 'explicit') ??
    marketWeights ??
    normalizeWeights(positionValues, 'position') ??
    normalizeWeights(equalWeights, 'equal')
  );
}

function extractWeights(items, mode = 'auto', marketValues = null) {
  if (mode === 'stockQuantity') {
    const quantityValues = items.map(parseQuantityValue);
    return normalizeWeights(quantityValues, 'shares') ?? extractAutoWeights(items, marketValues);
  }

  return extractAutoWeights(items, marketValues);
}

function resolveSecurityLabel(item) {
  const directName =
    typeof item.name === 'string'
      ? item.name.trim()
      : '';

  if (directName) {
    return directName;
  }

  const fieldName = findFieldValue(item.fields, [
    'stockname',
    'securityname',
    'assetname',
    'productname',
    'companyname',
    '종목명',
    '자산명',
    '상품명',
  ]).trim();
  if (fieldName) {
    return fieldName;
  }

  const code = String(item.code ?? item.ticker ?? '').trim();
  if (code) {
    return code;
  }

  return String(item.label ?? '').trim();
}

function resolveAccountLabel(item) {
  const accountType = findFieldValue(item.fields, [
    'accounttype',
    'accountkind',
    'accountclass',
    '계좌유형',
    '계좌종류',
    '계좌구분',
  ]).trim();

  if (accountType) {
    return accountType;
  }

  return findFieldValue(item.fields, [
    'accountid',
    'accountnumber',
    'accountcode',
    'acctid',
    '계좌id',
    '계좌번호',
    '계좌코드',
  ]).trim();
}

function buildGroupingKey(label, fallbackPrefix, index) {
  const normalized = normalizeText(label);
  return normalized || `${fallbackPrefix}-${index}`;
}

function countDistinctLabels(items, resolver) {
  const distinct = new Set();

  items.forEach((item) => {
    const label = resolver(item);
    const normalized = normalizeText(label);
    if (normalized) {
      distinct.add(normalized);
    }
  });

  return distinct.size;
}

function resolveGroupingMode(items, mode, classificationMode) {
  if (mode === 'stockQuantity') {
    return 'stock';
  }

  if (mode === 'stock' || mode === 'assetClass') {
    return mode;
  }

  if (mode === 'account') {
    return countDistinctLabels(items, resolveAccountLabel) > 0 ? 'account' : 'stock';
  }

  const assetClassCount = countDistinctLabels(items, (item) =>
    classifyAllocationLabel(item, classificationMode),
  );
  if (assetClassCount >= 2) {
    return 'assetClass';
  }

  const accountCount = countDistinctLabels(items, resolveAccountLabel);
  if (accountCount >= 2) {
    return 'account';
  }

  return 'stock';
}

function resolveGroupDescriptor(item, mode, classificationMode, index) {
  if (mode === 'assetClass') {
    const label = classifyAllocationLabel(item, classificationMode);
    return {
      key: buildGroupingKey(label, 'asset', index),
      label,
      isUnknown: !label,
    };
  }

  if (mode === 'account') {
    const label = resolveAccountLabel(item);
    return {
      key: buildGroupingKey(label, 'account', index),
      label,
      isUnknown: !label,
    };
  }

  const label = resolveSecurityLabel(item);
  return {
    key: buildGroupingKey(label, 'security', index),
    label,
    isUnknown: !label,
  };
}

export function createPortfolioAllocation(items, options = {}) {
  if (!items.length) {
    return null;
  }

  const { classificationMode = 'auto', weightMode = 'auto', marketValues = null } = options;
  const { weights, source } = extractWeights(items, weightMode, marketValues);
  const groupingMode = resolveGroupingMode(items, weightMode, classificationMode);
  const grouped = new Map();

  items.forEach((item, index) => {
    const descriptor = resolveGroupDescriptor(item, groupingMode, classificationMode, index);
    const key = descriptor.key || '__unknown__';
    const previous = grouped.get(key) ?? {
      key,
      label: descriptor.label,
      isUnknown: descriptor.isUnknown,
      weight: 0,
      count: 0,
    };

    previous.weight += weights[index] ?? 0;
    previous.count += 1;
    grouped.set(key, previous);
  });

  const segments = [...grouped.values()]
    .filter((segment) => segment.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((segment, index) => ({
      ...segment,
      id: `${segment.key}-${index}`,
    }));

  let returnWeight = 0;
  let returnTotal = 0;

  items.forEach((item, index) => {
    const parsedReturn = parseItemReturn(item);
    const weight = weights[index] ?? 0;

    if (!Number.isFinite(parsedReturn) || weight <= 0) {
      return;
    }

    returnWeight += weight;
    returnTotal += parsedReturn * weight;
  });

  return {
    holdingsCount: items.length,
    assetClassCount: segments.length,
    segments,
    totalReturn: returnWeight > 0 ? returnTotal / returnWeight : null,
    hasReturnData: returnWeight > 0,
    weightSource: source,
    groupSource: groupingMode,
  };
}
