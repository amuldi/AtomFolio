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
