// Reuses the web app's own analytics math (zero-dependency pure module) instead of
// reimplementing "total value / today's P/L" — keeps the menu bar number identical to what the
// dashboard would show for the same data.
import { createPortfolioAnalyticsSummary } from '../../../src/lib/portfolioAnalyticsSummary.js';

export function summarizeWorkspacePortfolios(portfolios = []) {
  const allItems = portfolios.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : []));
  const summary = createPortfolioAnalyticsSummary(allItems, allItems);

  return {
    totalMarketValue: summary.totals.totalMarketValue,
    totalProfitAmount: summary.totals.totalProfitAmount,
    totalReturnRate: summary.totals.totalReturnRate,
    holdingsCount: summary.totals.holdingsCount,
  };
}

// Per-holding detail for the popover's atom view — the biggest positions by weight, largest
// first. Capped at 6, not more: each node carries a persistent name+return label (see
// popover.js's renderAtomStage), and beyond ~6 in a ~300px-wide stage the labels start
// overlapping each other.
export function summarizeWorkspaceHoldings(portfolios = [], limit = 6) {
  const allItems = portfolios.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : []));
  const summary = createPortfolioAnalyticsSummary(allItems, allItems);

  return [...summary.positions]
    .filter((position) => Number.isFinite(position.marketValue) && position.marketValue > 0)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, limit)
    .map((position) => ({
      id: position.id,
      label: position.label,
      code: position.code,
      marketValue: position.marketValue,
      profitAmount: position.profitAmount,
      returnRate: position.returnRate,
      weightPercent: position.weightPercent,
    }));
}

// Same fallback the web dashboard uses for an unlabeled import (see src/App.jsx's
// `activePortfolio.fileName?.replace(...)` display-name logic) — strips the .csv/.manual.csv
// suffix so "portfolio_test1.csv" reads as "portfolio_test1" in the picker.
export function portfolioDisplayName(entry) {
  const raw = String(entry?.metadata?.accountName ?? entry?.fileName ?? '').trim();
  const stripped = raw.replace(/\.(manual\.)?csv$/i, '').trim();
  return stripped || entry?.id || '포트폴리오';
}

// The picker's option list — every portfolio in the workspace, not just the selected one.
export function listWorkspacePortfolios(portfolios = []) {
  return portfolios.map((entry) => ({
    id: entry.id,
    name: portfolioDisplayName(entry),
    holdingsCount: Array.isArray(entry.items) ? entry.items.length : 0,
  }));
}

export function collectWorkspaceTickers(portfolios = [], limit = 5) {
  const tickers = [];
  const seen = new Set();

  for (const entry of portfolios) {
    for (const item of Array.isArray(entry.items) ? entry.items : []) {
      const ticker = String(item?.ticker || item?.stockCode || '').trim();

      if (ticker && !seen.has(ticker)) {
        seen.add(ticker);
        tickers.push(ticker);
      }

      if (tickers.length >= limit) {
        return tickers;
      }
    }
  }

  return tickers;
}
