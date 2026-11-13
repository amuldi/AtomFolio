// What changed this month, as opposed to where the portfolio stands (which the summary card
// already shows). The old "monthly report draft" repeated the summary's return, P/L, top holding
// and concentration; this compares the latest period with the one before it instead.
//
// Input: an analytics summary (createPortfolioAnalyticsSummary) whose profitFlow periods carry
// per-holding snapshots. Returns null when there is no timeline at all.

const finite = (value) => (Number.isFinite(value) ? value : null);
const difference = (current, previous) =>
  Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;

function rankMovers(rows, limit) {
  const usable = rows.filter((row) => Number.isFinite(row.change) && row.change !== 0);
  const gainers = usable
    .filter((row) => row.change > 0)
    .sort((left, right) => right.change - left.change)
    .slice(0, limit);
  const losers = usable
    .filter((row) => row.change < 0)
    .sort((left, right) => left.change - right.change)
    .slice(0, limit);
  return { gainers, losers };
}

export function buildMonthlyDigest(summary, { moversLimit = 2, historyLength = 6 } = {}) {
  const flow = Array.isArray(summary?.profitFlow) ? summary.profitFlow : [];
  const latest = flow.at(-1);
  if (!latest) {
    return null;
  }
  const previous = flow.length > 1 ? flow.at(-2) : null;

  // Holding-level change: the same holding's P/L at the end of this period minus at the end of
  // the previous one. Holdings that only appear this month have no baseline and are left out
  // rather than counted as if their whole P/L happened this month.
  let moverRows;
  let moversBasis;
  if (previous) {
    const before = new Map((previous.holdings ?? []).map((holding) => [holding.key, holding]));
    moverRows = (latest.holdings ?? [])
      .filter((holding) => before.has(holding.key))
      .map((holding) => ({
        key: holding.key,
        label: holding.label,
        change: difference(holding.profitAmount, before.get(holding.key).profitAmount),
      }));
    moversBasis = 'month';
  } else {
    // Only one period recorded: fall back to cumulative P/L and say so.
    moverRows = (latest.holdings ?? []).map((holding) => ({
      key: holding.key,
      label: holding.label,
      change: finite(holding.profitAmount),
    }));
    moversBasis = 'cumulative';
  }

  return {
    periodKey: latest.periodKey,
    previousPeriodKey: previous?.periodKey ?? null,
    marketValueChange: previous ? difference(latest.marketValue, previous.marketValue) : null,
    profitChange: previous ? difference(latest.profitAmount, previous.profitAmount) : null,
    // Percentage points, not percent: 12% → 14% is "+2%p".
    returnRateChange: previous ? difference(latest.returnRate, previous.returnRate) : null,
    moversBasis,
    ...rankMovers(moverRows, moversLimit),
    history: flow.slice(-historyLength).map((period) => ({
      periodKey: period.periodKey,
      returnRate: finite(period.returnRate),
    })),
  };
}
