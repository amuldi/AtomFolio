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

function average(values, fallback = 0) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  const fixed = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return `${value > 0 ? '+' : ''}${trimmed}%`;
}

function standardDeviation(values) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function balanceScore(values) {
  if (values.length <= 1) {
    return values.length ? 0.45 : 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) {
    return 0;
  }

  const entropy = values.reduce((sum, value) => {
    if (!value) {
      return sum;
    }

    const ratio = value / total;
    return sum - ratio * Math.log(ratio);
  }, 0);

  return entropy / Math.log(values.length);
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

function parseNumericValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
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

function parseWeight(item) {
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

function extractWeights(items) {
  const explicitWeights = items.map(parseWeight);
  const explicitTotal = explicitWeights.reduce((sum, value) => sum + (value ?? 0), 0);

  if (explicitTotal > 0.001) {
    return explicitWeights.map((value) => (value ?? 0) / explicitTotal);
  }

  const equalWeight = items.length ? 1 / items.length : 0;
  return items.map(() => equalWeight);
}

function parseBuyDate(item) {
  const rawValue = findFieldValue(item.fields, [
    'buydate',
    'purchasedate',
    'acquisitiondate',
    'entrydate',
    '매수일',
    '매입일',
    '취득일',
  ]);
  const date = rawValue ? new Date(rawValue) : null;

  return date && Number.isFinite(date.getTime()) ? date : null;
}

function buildWeightedGroups(items, weights, key) {
  const groups = new Map();

  items.forEach((item, index) => {
    const label = typeof item[key] === 'string' ? item[key].trim() : '';
    if (!label) {
      return;
    }

    groups.set(label, (groups.get(label) ?? 0) + (weights[index] ?? 0));
  });

  return groups;
}

function riskBucketWeight(items, weights, keywords) {
  return items.reduce((sum, item, index) => {
    const normalized = normalizeText(item.risk);
    return keywords.some((keyword) => normalized.includes(keyword)) ? sum + weights[index] : sum;
  }, 0);
}

function defensiveShare(items, weights) {
  return items.reduce((sum, item, index) => {
    const assetClass = normalizeText(item.assetClass);
    const style = normalizeText(item.style);
    const sector = normalizeText(item.sector);

    if (
      assetClass.includes('채권') ||
      assetClass.includes('원자재') ||
      style.includes('배당') ||
      style.includes('방어') ||
      style.includes('가치') ||
      sector.includes('금') ||
      sector.includes('필수소비재')
    ) {
      return sum + weights[index];
    }

    return sum;
  }, 0);
}

function groupedTimingScore(dates) {
  if (!dates.length) {
    return 0.55;
  }

  if (dates.length === 1) {
    return 0.5;
  }

  const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
  const uniqueMonths = new Set(
    sorted.map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`),
  ).size;
  const uniqueDays = new Set(sorted.map((date) => date.toISOString().slice(0, 10))).size;
  const spanDays = (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / 86400000;
  const monthSpread = clamp(uniqueMonths / Math.min(sorted.length, 6), 0, 1);
  const daySpread = clamp(uniqueDays / sorted.length, 0, 1);
  const timeSpanScore = clamp(spanDays / 180, 0, 1);

  return average([monthSpread, daySpread, timeSpanScore], 0.55);
}

const SCORECARD_COPY = {
  ko: {
    profitability: (avgReturn, positiveRatio, returnVolatility) =>
      `평균 수익률 ${formatPercent(avgReturn)}, 플러스 수익 종목 ${Math.round(
        positiveRatio * 100,
      )}%, 수익률 변동성 ${returnVolatility.toFixed(1)} 기준입니다.`,
    diversification: (effectiveHoldings, sectorGroups, regionGroups, assetGroups) =>
      `실질 보유 종목 ${effectiveHoldings.toFixed(1)}개, 분야 ${sectorGroups.size}개, 지역 ${regionGroups.size}개, 자산군 ${assetGroups.size}개로 분산도를 계산했습니다.`,
    riskManagement: (highRiskShare, lowRiskShare, defensiveWeight, concentrationPenalty) =>
      `고위험 비중 ${Math.round(highRiskShare * 100)}%, 저위험 비중 ${Math.round(
        lowRiskShare * 100,
      )}%, 방어형 비중 ${Math.round(defensiveWeight * 100)}%, 집중위험 ${Math.round(
        concentrationPenalty * 100,
      )}%를 반영했습니다.`,
    composition: (metadataCoverage, assetBalance, sectorBalance) =>
      `메타데이터 충실도 ${Math.round(metadataCoverage)}%, 자산군 균형 ${Math.round(
        assetBalance * 100,
      )}점, 분야 균형 ${Math.round(sectorBalance * 100)}점 기준입니다.`,
    timing: (buyDates, timingDiscipline) =>
      buyDates.length
        ? `매수일 ${buyDates.length}건을 기준으로 시점 분산도 ${Math.round(
            timingDiscipline * 100,
          )}점을 반영했습니다. 한 시점에 몰릴수록 점수가 내려갑니다.`
        : '매수일 데이터가 없어 타이밍 점수는 중립 기준으로 계산했습니다.',
    stability: (returnVolatility, negativeRatio, defensiveWeight) =>
      `수익률 변동성 ${returnVolatility.toFixed(1)}, 손실 종목 ${Math.round(
        negativeRatio * 100,
      )}%, 방어형 비중 ${Math.round(defensiveWeight * 100)}%를 기준으로 안정성을 계산했습니다.`,
  },
  en: {
    profitability: (avgReturn, positiveRatio, returnVolatility) =>
      `Average return ${formatPercent(avgReturn)}, winners ${Math.round(
        positiveRatio * 100,
      )}%, return volatility ${returnVolatility.toFixed(1)}.`,
    diversification: (effectiveHoldings, sectorGroups, regionGroups, assetGroups) =>
      `Effective holdings ${effectiveHoldings.toFixed(1)}, fields ${sectorGroups.size}, regions ${regionGroups.size}, asset classes ${assetGroups.size}.`,
    riskManagement: (highRiskShare, lowRiskShare, defensiveWeight, concentrationPenalty) =>
      `High-risk share ${Math.round(highRiskShare * 100)}%, low-risk share ${Math.round(
        lowRiskShare * 100,
      )}%, defensive share ${Math.round(defensiveWeight * 100)}%, concentration risk ${Math.round(
        concentrationPenalty * 100,
      )}%.`,
    composition: (metadataCoverage, assetBalance, sectorBalance) =>
      `Metadata coverage ${Math.round(metadataCoverage)}%, asset-class balance ${Math.round(
        assetBalance * 100,
      )} pts, field balance ${Math.round(sectorBalance * 100)} pts.`,
    timing: (buyDates, timingDiscipline) =>
      buyDates.length
        ? `Based on ${buyDates.length} buy dates, timing spread scored ${Math.round(
            timingDiscipline * 100,
          )} pts. The more purchases cluster in one period, the lower the score.`
        : 'No buy-date data was found, so timing was scored with a neutral baseline.',
    stability: (returnVolatility, negativeRatio, defensiveWeight) =>
      `Return volatility ${returnVolatility.toFixed(1)}, losing positions ${Math.round(
        negativeRatio * 100,
      )}%, defensive share ${Math.round(defensiveWeight * 100)}%.`,
  },
};

export const SCORE_WEIGHT_PRESETS = {
  balanced: {
    profitability: 0.2,
    diversification: 0.22,
    riskManagement: 0.2,
    composition: 0.16,
    timing: 0.08,
    stability: 0.14,
  },
  returnFocus: {
    profitability: 0.28,
    diversification: 0.24,
    riskManagement: 0.16,
    composition: 0.12,
    timing: 0.08,
    stability: 0.12,
  },
  longTermReturnFocus: {
    profitability: 0.24,
    diversification: 0.22,
    riskManagement: 0.12,
    composition: 0.12,
    timing: 0.04,
    stability: 0.26,
  },
  stabilityFocus: {
    profitability: 0.12,
    diversification: 0.18,
    riskManagement: 0.24,
    composition: 0.18,
    timing: 0.08,
    stability: 0.2,
  },
};

// One overall number per weighting style. The six axis scores never change with the style — only
// how they are added up does — so the drawer shows all four results side by side instead of
// making the user click through buttons that redraw an identical radar.
export function overallScoreFor(metrics, preset = 'balanced') {
  const weights = SCORE_WEIGHT_PRESETS[preset] ?? SCORE_WEIGHT_PRESETS.balanced;
  return Math.round(
    Object.entries(weights).reduce((sum, [key, weight]) => sum + (Number(metrics?.[key]) || 0) * weight, 0),
  );
}

export function createPortfolioScorecard(items, language = 'ko', options = {}) {
  const { weightPreset = 'balanced' } = options;
  const count = Math.max(items.length, 1);
  const weights = extractWeights(items);
  const returns = items
    .map((item) => parseReturnValue(item.detail))
    .filter((value) => Number.isFinite(value));
  const avgReturn = average(returns, 0);
  const returnVolatility = standardDeviation(returns);
  const downsideVolatility = standardDeviation(returns.filter((value) => value < 0));
  const positiveRatio = returns.length
    ? returns.filter((value) => value >= 0).length / returns.length
    : 0.5;
  const negativeRatio = returns.length
    ? returns.filter((value) => value < 0).length / returns.length
    : 0.5;
  const sectorGroups = buildWeightedGroups(items, weights, 'sector');
  const regionGroups = buildWeightedGroups(items, weights, 'region');
  const styleGroups = buildWeightedGroups(items, weights, 'style');
  const assetGroups = buildWeightedGroups(items, weights, 'assetClass');
  const metadataCoverage =
    average(
      items.map((item) => {
        const filled = [item.region, item.sector, item.style, item.risk, item.assetClass].filter(Boolean).length;
        return filled / 5;
      }),
      0.4,
    ) * 100;
  const sectorBalance = balanceScore([...sectorGroups.values()]);
  const regionBalance = balanceScore([...regionGroups.values()]);
  const styleBalance = balanceScore([...styleGroups.values()]);
  const assetBalance = balanceScore([...assetGroups.values()]);
  const effectiveHoldings = weights.length
    ? 1 / weights.reduce((sum, value) => sum + value * value, 0)
    : 1;
  const holdingSpread = clamp((effectiveHoldings - 1) / 11, 0, 1);
  const concentrationPenalty = 1 - clamp((effectiveHoldings - 1) / Math.max(count - 1, 1), 0, 1);
  const sectorSpread = clamp(sectorGroups.size / 6, 0, 1);
  const regionSpread = clamp(regionGroups.size / 4, 0, 1);
  const styleSpread = clamp(styleGroups.size / 4, 0, 1);
  const assetSpread = clamp(assetGroups.size / 3, 0, 1);
  const highRiskShare = riskBucketWeight(items, weights, ['고위험', 'highrisk', 'aggressive', 'speculative']);
  const lowRiskShare = riskBucketWeight(items, weights, ['저위험', 'lowrisk', 'conservative']);
  const mediumRiskShare = riskBucketWeight(items, weights, ['중위험', 'mediumrisk', 'moderate', 'balanced']);
  const defensiveWeight = defensiveShare(items, weights);
  const buyDates = items.map(parseBuyDate).filter(Boolean);
  const timingDiscipline = groupedTimingScore(buyDates);

  const profitability = clamp(
    (returns.length ? 40 + avgReturn * 4.6 + positiveRatio * 24 : 54) -
      Math.max(0, returnVolatility - 8) * 1.4 -
      downsideVolatility * 0.6,
    18,
    98,
  );
  const diversification = clamp(
    18 +
      holdingSpread * 24 +
      assetSpread * 18 +
      sectorSpread * 16 +
      regionSpread * 12 +
      styleSpread * 8 +
      average([sectorBalance, regionBalance, styleBalance, assetBalance], 0.3) * 18 -
      concentrationPenalty * 8,
    18,
    98,
  );
  const riskManagement = clamp(
    24 +
      diversification * 0.26 +
      lowRiskShare * 18 +
      mediumRiskShare * 8 +
      defensiveWeight * 16 -
      highRiskShare * 14 -
      concentrationPenalty * 16,
    18,
    98,
  );
  const composition = clamp(
    22 +
      metadataCoverage * 0.2 +
      assetSpread * 20 +
      assetBalance * 14 +
      sectorBalance * 12 +
      regionBalance * 10 +
      holdingSpread * 10,
    20,
    98,
  );
  const timing = clamp(
    buyDates.length
      ? 28 + timingDiscipline * 42 + holdingSpread * 8 + defensiveWeight * 6
      : 54 + holdingSpread * 6,
    22,
    96,
  );
  const stability = clamp(
    (returns.length ? 70 - returnVolatility * 4 + positiveRatio * 10 : 58) +
      defensiveWeight * 16 +
      lowRiskShare * 10 +
      assetSpread * 8 -
      highRiskShare * 8 -
      concentrationPenalty * 10 -
      negativeRatio * 8,
    16,
    98,
  );

  const metrics = {
    profitability: Math.round(profitability),
    diversification: Math.round(diversification),
    riskManagement: Math.round(riskManagement),
    composition: Math.round(composition),
    timing: Math.round(timing),
    stability: Math.round(stability),
  };
  const overall = overallScoreFor(metrics, weightPreset);

  const copy = SCORECARD_COPY[language] ?? SCORECARD_COPY.ko;
  const explanations = {
    profitability: copy.profitability(avgReturn, positiveRatio, returnVolatility),
    diversification: copy.diversification(
      effectiveHoldings,
      sectorGroups,
      regionGroups,
      assetGroups,
    ),
    riskManagement: copy.riskManagement(
      highRiskShare,
      lowRiskShare,
      defensiveWeight,
      concentrationPenalty,
    ),
    composition: copy.composition(metadataCoverage, assetBalance, sectorBalance),
    timing: copy.timing(buyDates, timingDiscipline),
    stability: copy.stability(returnVolatility, negativeRatio, defensiveWeight),
  };

  return {
    metrics,
    overall,
    explanations,
  };
}
