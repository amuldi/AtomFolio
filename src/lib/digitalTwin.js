function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const unitMultiplier =
    /억/.test(raw) ? 100000000 : /만/.test(raw) ? 10000 : /천/.test(raw) ? 1000 : 1;
  const cleaned = raw
    .replace(/[,%₩원$€¥￦\s]/g, '')
    .replace(/[^\d.+-]/g, '');
  const parsed = Number.parseFloat(cleaned);

  return Number.isFinite(parsed) ? parsed * unitMultiplier : null;
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
    if (normalizedCandidates.some((candidate) => label.includes(candidate))) {
      return field?.value;
    }
  }

  return '';
}

function itemText(item) {
  return [
    item?.label,
    item?.name,
    item?.code,
    item?.region,
    item?.sector,
    item?.assetClass,
    item?.style,
    item?.risk,
    item?.riskLevel,
    ...(item?.fields ?? []).flatMap((field) => [field.label, field.value]),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(' ');
}

function safeLabel(value, fallback = '미분류') {
  const label = String(value ?? '').trim();
  return label || fallback;
}

function parseExplicitWeight(item) {
  const rawValue = findFieldValue(item?.fields, [
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
  const parsed = parseNumber(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return rawValue.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function parseShares(item) {
  return parseNumber(
    findFieldValue(item?.fields, [
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

function parsePrice(item, candidates) {
  return parseNumber(findFieldValue(item?.fields, candidates));
}

function parsePositionValue(item) {
  const buyPrice = parsePrice(item, [
    'buyprice',
    'purchaseprice',
    'entryprice',
    'averageprice',
    'costbasis',
    '매수가',
    '매입가',
    '취득가',
    '평균단가',
  ]);
  const shares = parseShares(item);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(shares) || shares <= 0) {
    return null;
  }

  return buyPrice * shares;
}

function parseMarketValue(item) {
  return parseNumber(
    findFieldValue(item?.fields, [
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
    ]),
  );
}

function resolveValueBasis(items) {
  const marketValues = items.map(parseMarketValue);
  const marketTotal = marketValues.reduce((sum, value) => sum + (value ?? 0), 0);

  if (marketTotal > 0) {
    return {
      source: 'marketValue',
      totalValue: marketTotal,
      values: marketValues.map((value) => Math.max(0, value ?? 0)),
    };
  }

  const explicitWeights = items.map(parseExplicitWeight);
  const explicitTotal = explicitWeights.reduce((sum, value) => sum + (value ?? 0), 0);

  if (explicitTotal > 0.001) {
    const totalValue = 100;
    return {
      source: 'weight',
      totalValue,
      values: explicitWeights.map((value) => ((value ?? 0) / explicitTotal) * totalValue),
    };
  }

  const positionValues = items.map(parsePositionValue);
  const positionTotal = positionValues.reduce((sum, value) => sum + (value ?? 0), 0);

  if (positionTotal > 0) {
    return {
      source: 'position',
      totalValue: positionTotal,
      values: positionValues.map((value) => Math.max(0, value ?? 0)),
    };
  }

  return {
    source: 'equal',
    totalValue: items.length,
    values: items.map(() => (items.length ? 1 : 0)),
  };
}

function groupWeights(positions, key) {
  const groups = {};

  positions.forEach((position) => {
    const label = safeLabel(position[key]);
    groups[label] = (groups[label] ?? 0) + position.weight;
  });

  return Object.entries(groups)
    .map(([label, weight]) => ({ label, weight }))
    .sort((left, right) => right.weight - left.weight);
}

function isUsAsset(position) {
  const text = itemText(position.item);
  return /미국|us|usa|unitedstates|usd|nasdaq|nyse|qqq|spy|voo|vti|schd|soxx|aapl|msft/.test(text);
}

function isTechAsset(position) {
  const text = itemText(position.item);
  return /기술|테크|반도체|소프트웨어|ai|technology|tech|semiconductor|software|cloud|nasdaq|qqq|soxx|smh|aapl|msft|nvda/.test(text);
}

function isGoldCashAsset(position) {
  const text = itemText(position.item);
  return /금|현금|예수금|단기|원자재|gold|cash|money market|deposit|iau|gld|sgov|bil/.test(text);
}

function isReitAsset(position) {
  return /리츠|부동산|reit|real estate|property/.test(itemText(position.item));
}

function isDividendAsset(position) {
  return /배당|인컴|dividend|income|schd|dgro|vym/.test(itemText(position.item));
}

function isHighRiskAsset(position) {
  const text = itemText(position.item);
  return /고위험|공격|성장|기술|반도체|crypto|코인|leverage|2x|3x|growth|technology|semiconductor/.test(text);
}

function classifyRebalanceBucket(position) {
  if (isReitAsset(position)) {
    return 'reit';
  }

  if (isGoldCashAsset(position)) {
    return 'goldCash';
  }

  if (isDividendAsset(position)) {
    return 'dividend';
  }

  const text = itemText(position.item);
  if (/주식|stock|equity|etf|fund|qqq|spy|voo|vti|nasdaq|s&p/.test(text)) {
    return 'stock';
  }

  return 'other';
}

function calculateRiskScore(positions, totalValue) {
  if (!positions.length || totalValue <= 0) {
    return 0;
  }

  const topWeight = Math.max(...positions.map((position) => position.weight));
  const techWeight = positions.reduce((sum, position) => sum + (isTechAsset(position) ? position.weight : 0), 0);
  const usWeight = positions.reduce((sum, position) => sum + (isUsAsset(position) ? position.weight : 0), 0);
  const highRiskWeight = positions.reduce((sum, position) => sum + (isHighRiskAsset(position) ? position.weight : 0), 0);
  const defensiveWeight = positions.reduce(
    (sum, position) => sum + (isGoldCashAsset(position) || isDividendAsset(position) ? position.weight : 0),
    0,
  );

  return Math.round(
    clamp(
      22 + topWeight * 26 + techWeight * 22 + usWeight * 9 + highRiskWeight * 24 - defensiveWeight * 16,
      0,
      100,
    ),
  );
}

function normalizeTargetWeights(targetWeights = {}) {
  const raw = {
    stock: parsePercent(targetWeights.stock) ?? 0,
    dividend: parsePercent(targetWeights.dividend) ?? 0,
    goldCash: parsePercent(targetWeights.goldCash) ?? 0,
    reit: parsePercent(targetWeights.reit) ?? 0,
    other: parsePercent(targetWeights.other) ?? 0,
  };
  const total = Object.values(raw).reduce((sum, value) => sum + Math.max(0, value), 0);

  if (total <= 0) {
    return raw;
  }

  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Math.max(0, value) / total]),
  );
}

function formatPercent(value, digits = 1) {
  const percent = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(percent) >= 10 ? percent.toFixed(0) : percent.toFixed(digits);
  return `${percent > 0 ? '+' : ''}${fixed.replace(/\.0$/, '')}%`;
}

function formatWon(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Math.round(value).toLocaleString('ko-KR');
}

export function createPortfolioTwin(items = [], timelineItems = [], options = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const basis = resolveValueBasis(sourceItems);
  const totalValue = basis.totalValue || sourceItems.length || 0;
  const positions = sourceItems.map((item, index) => {
    const value = Math.max(0, basis.values[index] ?? 0);
    const weight = totalValue > 0 ? value / totalValue : sourceItems.length ? 1 / sourceItems.length : 0;

    return {
      id: item.id ?? item.code ?? item.label ?? `position-${index + 1}`,
      label: safeLabel(item.label ?? item.name ?? item.code, `종목 ${index + 1}`),
      code: safeLabel(item.code, ''),
      item,
      value,
      weight,
      region: safeLabel(item.region),
      sector: safeLabel(item.sector),
      assetClass: safeLabel(item.assetClass),
      style: safeLabel(item.style),
      riskLevel: safeLabel(item.risk ?? item.riskLevel),
      returnRate: parsePercent(item.detail),
      bucket: 'other',
    };
  });

  positions.forEach((position) => {
    position.bucket = classifyRebalanceBucket(position);
  });

  return {
    totalValue,
    valueSource: options.valueSource ?? basis.source,
    positionCount: positions.length,
    timelineCount: Array.isArray(timelineItems) ? timelineItems.length : 0,
    positions,
    weights: positions.map((position) => ({
      id: position.id,
      label: position.label,
      value: position.value,
      weight: position.weight,
    })),
    assetClassWeights: groupWeights(positions, 'assetClass'),
    regionWeights: groupWeights(positions, 'region'),
    sectorWeights: groupWeights(positions, 'sector'),
    rebalanceBuckets: groupWeights(positions, 'bucket'),
    riskScore: calculateRiskScore(positions, totalValue),
    createdAt: new Date().toISOString(),
  };
}

export function applyMarketScenario(twin, scenario = {}) {
  const globalShock =
    parsePercent(scenario.globalShock ?? scenario.marketShock ?? scenario.totalMarketShock) ?? 0;
  const usShock = parsePercent(scenario.usShock) ?? 0;
  const techShock = parsePercent(scenario.techShock) ?? 0;
  const goldCashShock = parsePercent(scenario.goldCashShock ?? scenario.goldShock) ?? 0;
  const reitShock = parsePercent(scenario.reitShock) ?? 0;
  const positions = (twin?.positions ?? []).map((position) => {
    let shock = globalShock;

    if (isUsAsset(position)) {
      shock += usShock;
    }

    if (isTechAsset(position)) {
      shock += techShock;
    }

    if (isGoldCashAsset(position)) {
      shock += goldCashShock;
    }

    if (isReitAsset(position)) {
      shock += reitShock;
    }

    shock = clamp(shock, -95, 200);

    const projectedValue = position.value * (1 + shock / 100);
    const changeValue = projectedValue - position.value;

    return {
      ...position,
      scenarioShock: shock,
      projectedValue,
      changeValue,
      contributionRate: twin.totalValue > 0 ? (changeValue / twin.totalValue) * 100 : 0,
    };
  });
  const projectedTotalValue = positions.reduce((sum, position) => sum + position.projectedValue, 0);
  const returnRate =
    twin?.totalValue > 0 ? ((projectedTotalValue - twin.totalValue) / twin.totalValue) * 100 : 0;
  const projectedTwin = createPortfolioTwin(
    positions.map((position) => ({
      ...position.item,
      fields: [
        { label: '평가금액', value: String(position.projectedValue) },
        ...(position.item.fields ?? []),
      ],
    })),
    [],
    { valueSource: 'scenario' },
  );
  const lossContributors = [...positions]
    .filter((position) => position.changeValue < 0)
    .sort((left, right) => left.changeValue - right.changeValue);
  const defensiveAssets = [...positions].sort((left, right) => right.changeValue - left.changeValue);

  return {
    type: 'marketScenario',
    scenario: { globalShock, usShock, techShock, goldCashShock, reitShock },
    totalValue: twin.totalValue,
    projectedTotalValue,
    changeValue: projectedTotalValue - twin.totalValue,
    returnRate,
    riskScoreBefore: twin.riskScore,
    riskScoreAfter: projectedTwin.riskScore,
    positions,
    assetClassWeightsAfter: projectedTwin.assetClassWeights,
    lossContributors,
    largestLossContributor: lossContributors[0] ?? null,
    defensiveAsset: defensiveAssets[0] ?? null,
    insights: [],
  };
}

export function simulateRebalance(twin, targetWeights = {}) {
  const normalizedTargets = normalizeTargetWeights(targetWeights);
  const current = {
    stock: 0,
    dividend: 0,
    goldCash: 0,
    reit: 0,
    other: 0,
  };

  for (const position of twin?.positions ?? []) {
    current[position.bucket] = (current[position.bucket] ?? 0) + position.weight;
  }

  const comparison = Object.keys(current).map((key) => {
    const target = normalizedTargets[key] ?? 0;
    const currentWeight = current[key] ?? 0;

    return {
      key,
      currentWeight,
      targetWeight: target,
      difference: target - currentWeight,
      tradeValue: (target - currentWeight) * (twin?.totalValue ?? 0),
    };
  });
  const warnings = comparison
    .filter((item) => item.currentWeight > 0.55 || item.targetWeight > 0.65)
    .map((item) => `${bucketLabel(item.key)} 비중이 과도하게 높습니다.`);

  return {
    type: 'rebalance',
    totalValue: twin?.totalValue ?? 0,
    current,
    target: normalizedTargets,
    comparison,
    warnings,
    positions: twin?.positions ?? [],
    riskScoreBefore: twin?.riskScore ?? 0,
    riskScoreAfter: Math.round(
      clamp(
        (twin?.riskScore ?? 0) -
          Math.max(0, (current.stock ?? 0) - (normalizedTargets.stock ?? 0)) * 18 +
          Math.max(0, (normalizedTargets.goldCash ?? 0) - (current.goldCash ?? 0)) * -10,
        0,
        100,
      ),
    ),
  };
}

function futureValueWithMonthlyContribution(principal, monthlyContribution, months, annualReturnRate) {
  const monthlyRate = (1 + annualReturnRate / 100) ** (1 / 12) - 1;
  let value = principal;

  for (let month = 0; month < months; month += 1) {
    value = value * (1 + monthlyRate) + monthlyContribution;
  }

  return value;
}

export function projectFutureInvestment(twin, monthlyContribution = 0, months = 12, annualReturnRate = 6) {
  const principal = Number(twin?.totalValue ?? 0);
  const monthly = Math.max(0, parseNumber(monthlyContribution) ?? 0);
  const duration = Math.max(1, Math.round(parseNumber(months) ?? 12));
  const baseRate = parsePercent(annualReturnRate) ?? 6;
  const scenarios = [
    { key: 'conservative', label: '보수', annualReturnRate: baseRate - 4 },
    { key: 'base', label: '기준', annualReturnRate: baseRate },
    { key: 'optimistic', label: '낙관', annualReturnRate: baseRate + 4 },
  ].map((scenario) => {
    const projectedValue = futureValueWithMonthlyContribution(
      principal,
      monthly,
      duration,
      scenario.annualReturnRate,
    );
    const contributions = monthly * duration;

    return {
      ...scenario,
      projectedValue,
      contributions,
      gain: projectedValue - principal - contributions,
      returnRate: principal + contributions > 0 ? ((projectedValue - principal - contributions) / (principal + contributions)) * 100 : 0,
    };
  });

  return {
    type: 'futureInvestment',
    principal,
    monthlyContribution: monthly,
    months: duration,
    annualReturnRate: baseRate,
    scenarios,
  };
}

const STRESS_TEST_PRESETS = {
  tech_crash: {
    label: '기술주 급락',
    scenario: { globalShock: -4, usShock: -4, techShock: -18, goldCashShock: 5, reitShock: -5 },
  },
  rate_hike: {
    label: '금리 상승',
    scenario: { globalShock: -3, usShock: -2, techShock: -8, goldCashShock: 2, reitShock: -9 },
  },
  usd_krw_up: {
    label: '환율 급등',
    scenario: { globalShock: -1, usShock: 6, techShock: 1, goldCashShock: 3, reitShock: -2 },
  },
  global_recession: {
    label: '글로벌 경기침체',
    scenario: { globalShock: -12, usShock: -4, techShock: -8, goldCashShock: 6, reitShock: -10 },
  },
  defensive_market: {
    label: '방어장세',
    scenario: { globalShock: -3, usShock: -2, techShock: -6, goldCashShock: 7, reitShock: 1 },
  },
};

export function runStressTest(twin, preset = 'tech_crash') {
  const definition = STRESS_TEST_PRESETS[preset] ?? STRESS_TEST_PRESETS.tech_crash;
  const result = applyMarketScenario(twin, definition.scenario);

  return {
    ...result,
    type: 'stressTest',
    preset,
    presetLabel: definition.label,
  };
}

function bucketLabel(key) {
  const labels = {
    stock: '주식',
    dividend: '배당',
    goldCash: '금/현금',
    reit: '리츠',
    other: '기타',
  };

  return labels[key] ?? key;
}

export const digitalTwinFormatters = {
  bucketLabel,
  formatPercent,
  formatWon,
};
