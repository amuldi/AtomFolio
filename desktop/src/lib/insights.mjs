// Proactive insight evaluation — stop-loss/take-profit thresholds and allocation drift, both
// computed via the web app's own analytics (createPortfolioAnalyticsSummary), not reimplemented.
// News-based insights are handled separately in main.js (they're already part of the existing
// news poll, no separate evaluation needed here).
import { createPortfolioAnalyticsSummary } from '../../../src/lib/portfolioAnalyticsSummary.js';

export const INSIGHT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const BUCKET_LABELS_KO = {
  stock: '주식',
  dividend: '배당',
  goldCash: '금/현금',
  reit: '리츠',
  other: '기타',
};

function formatPercent(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

// Every insight currently true for this portfolio, most severe first — independent of cooldown
// (cooldown only rate-limits the *notification*, not whether the popover highlights the atom).
export function evaluateInsights({ items, config }) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const summary = createPortfolioAnalyticsSummary(items, items, {
    targetBucketWeights: config.targetBucketWeights,
  });
  const insights = [];

  for (const position of summary.positions) {
    if (!Number.isFinite(position.returnRate) || !position.code) {
      continue;
    }

    if (Number.isFinite(config.stopLossPercent) && position.returnRate <= config.stopLossPercent) {
      insights.push({
        type: 'stop-loss',
        key: `stop-loss:${position.code}`,
        code: position.code,
        label: position.label,
        message: `${position.label} ${formatPercent(position.returnRate)} · 손절선 도달`,
        severity: 3,
      });
    } else if (
      Number.isFinite(config.takeProfitPercent) &&
      position.returnRate >= config.takeProfitPercent
    ) {
      insights.push({
        type: 'take-profit',
        key: `take-profit:${position.code}`,
        code: position.code,
        label: position.label,
        message: `${position.label} ${formatPercent(position.returnRate)} · 익절선 도달`,
        severity: 2,
      });
    }
  }

  const biggestGap = summary.rebalanceGaps?.bucket?.[0];
  if (
    biggestGap &&
    Number.isFinite(config.allocationDriftPercent) &&
    Math.abs(biggestGap.gapWeightPercent) >= config.allocationDriftPercent
  ) {
    const label = BUCKET_LABELS_KO[biggestGap.label] ?? biggestGap.label;
    const direction = biggestGap.gapWeightPercent > 0 ? '부족' : '초과';
    insights.push({
      type: 'allocation-drift',
      key: `allocation-drift:${biggestGap.label}`,
      code: null,
      label,
      message: `${label} 비중 목표 대비 ${direction} ${Math.abs(biggestGap.gapWeightPercent).toFixed(1)}%p`,
      severity: 1,
    });
  }

  return insights.sort((a, b) => b.severity - a.severity);
}

// Which of the (already-true) insights are still allowed to fire a fresh notification, per the
// cooldown map. Doesn't mutate cooldowns — the caller updates it after actually notifying.
export function filterByCooldown(insights, cooldowns, now = Date.now()) {
  return insights.filter((insight) => {
    const lastFiredAt = cooldowns[insight.key];
    return !lastFiredAt || now - lastFiredAt >= INSIGHT_COOLDOWN_MS;
  });
}
