// Pure helpers for the 유명인 tab's "live" layer. A 13F is a quarter-end snapshot published up to
// 45 days later, so the holdings can't be real time; these functions put live prices on top of
// the snapshot (how it has moved since, and today) and describe what was bought and sold.

const isRealTicker = (ticker) => Boolean(ticker) && !String(ticker).startsWith('CUSIP:');

// Every ticker on screen for this person (holdings, last quarter's trades, insider stakes).
export function quoteTickers(fund, insider) {
  const tickers = new Set();
  for (const holding of fund?.holdings ?? [])
    if (isRealTicker(holding.ticker)) tickers.add(holding.ticker);
  for (const change of fund?.changes ?? [])
    if (isRealTicker(change.ticker)) tickers.add(change.ticker);
  for (const issuer of insider?.issuers ?? [])
    if (isRealTicker(issuer.ticker)) tickers.add(issuer.ticker);
  return [...tickers];
}

const round = (value, digits = 2) => Number(value.toFixed(digits));

// How the whole (top-holdings) portfolio has moved: weighted by what the filing says it held, so
// the figure answers "if they still held this, how would it have done since the snapshot?".
// Today's move is weighted by each holding's current size (weight × growth since the snapshot).
export function portfolioDrift(holdings = [], quotes = {}) {
  let weightSum = 0;
  let sinceSum = 0;
  let daySum = 0;
  let dayWeight = 0;
  let covered = 0;
  for (const holding of holdings) {
    const quote = quotes[holding.ticker];
    if (!quote || !(holding.weight > 0)) continue;
    covered += holding.weight;
    if (Number.isFinite(quote.sincePct)) {
      weightSum += holding.weight;
      sinceSum += holding.weight * quote.sincePct;
    }
    if (Number.isFinite(quote.dayPct)) {
      const current =
        holding.weight * (1 + (Number.isFinite(quote.sincePct) ? quote.sincePct / 100 : 0));
      dayWeight += current;
      daySum += current * quote.dayPct;
    }
  }
  const total = holdings.reduce(
    (sum, holding) => sum + (holding.weight > 0 ? holding.weight : 0),
    0,
  );
  return {
    sincePct: weightSum > 0 ? round(sinceSum / weightSum) : null,
    dayPct: dayWeight > 0 ? round(daySum / dayWeight) : null,
    coverage: total > 0 ? round(covered / total, 3) : 0,
  };
}

// 13F deadline for the quarter after `period`: 45 days past that quarter's end.
export function nextFilingDeadline(period) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(period ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  // Quarter ends are Mar 31, Jun 30, Sep 30, Dec 31; the next one is three months on.
  const end = new Date(Date.UTC(year, month - 1 + 4, 0));
  const deadline = new Date(end.getTime() + 45 * 86_400_000);
  return deadline.toISOString().slice(0, 10);
}

// One short phrase for a quarter-over-quarter change: "신규 편입", "추가 +23%", "축소 −18%".
export function describeChange(change, language = 'ko') {
  if (!change) return '';
  const en = language === 'en';
  const delta =
    change.sharesBefore > 0
      ? Math.round((change.sharesAfter / change.sharesBefore - 1) * 100)
      : null;
  const signed =
    delta == null ? '' : ` ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`;
  switch (change.kind) {
    case 'new':
      return en ? 'New' : '신규 편입';
    case 'added':
      return `${en ? 'Added' : '추가'}${signed}`;
    case 'trimmed':
      return `${en ? 'Trimmed' : '축소'}${signed}`;
    case 'soldOut':
      return en ? 'Sold out' : '전량 매도';
    default:
      return '';
  }
}

export const isBuyKind = (kind) => kind === 'new' || kind === 'added';
export const isSellKind = (kind) => kind === 'trimmed' || kind === 'soldOut';

// What was bought and what was sold between the two filings, biggest first, with the totals.
export function summarizeTrades(changes = []) {
  const buys = changes
    .filter((change) => isBuyKind(change.kind))
    .sort((a, b) => b.tradeValueUsd - a.tradeValueUsd);
  const sells = changes
    .filter((change) => isSellKind(change.kind))
    .sort((a, b) => b.tradeValueUsd - a.tradeValueUsd);
  const boughtUsd = buys.reduce((sum, change) => sum + Math.abs(change.tradeValueUsd), 0);
  const soldUsd = sells.reduce((sum, change) => sum + Math.abs(change.tradeValueUsd), 0);
  return { buys, sells, boughtUsd, soldUsd, netUsd: boughtUsd - soldUsd };
}
