import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collapsePortfolioItemsForDisplay } from '../src/lib/portfolioIngestionCore.js';
import {
  applyEnrichedRowsToEntry,
  selectChangedEntries,
  selectLatestRowPerHolding,
} from '../src/lib/portfolioSync.js';

const identityKey = (item) => String(item?.ticker ?? item?.label ?? '').toUpperCase();
const deps = { collapse: collapsePortfolioItemsForDisplay, identityKey };

function row(ticker, date, price, id) {
  return {
    id: id ?? `${ticker}-${date}`,
    label: ticker,
    ticker,
    code: ticker,
    fields: [
      { label: '종목명', value: ticker },
      { label: '종목 티커', value: ticker },
      { label: '날짜', value: date },
      { label: '보유수량', value: '1' },
      { label: '매수가', value: '100' },
      { label: '현재가', value: String(price) },
    ],
  };
}

// The shape that lost four holdings in production: 10 holdings, two daily snapshots plus one
// duplicated row, so the timeline (21 rows) is longer than the 20-row refresh seed.
const TICKERS = ['QQQ', 'NVDA', 'AAPL', 'AMZN', 'META', 'QQQI', 'BA', 'SAD', 'ASD', 'ADBE'];
function nasdaqLikeEntry() {
  // Same order as the production data: the duplicated QQQI row sits right after the first one.
  const firstDay = TICKERS.flatMap((ticker) =>
    ticker === 'QQQI'
      ? [row(ticker, '2026-11-12', 100), row(ticker, '2026-11-12', 100, 'QQQI-dup')]
      : [row(ticker, '2026-11-12', 100)],
  );
  const timelineItems = [...firstDay, ...TICKERS.map((ticker) => row(ticker, '2026-11-13', 101))];
  return {
    id: 'nasdaq',
    fileName: '나스닥',
    timelineItems,
    items: collapsePortfolioItemsForDisplay(timelineItems),
  };
}

const enrich = (rows) => rows.map((r) => ({ ...r, marketPrice: '$123.00', latestPrice: 123 }));
const holdingSet = (items) => new Set(items.map(identityKey));

test('a refresh seeded with part of a long timeline keeps every holding', () => {
  const entry = nasdaqLikeEntry();
  const before = holdingSet(entry.items);
  assert.equal(before.size, 10);

  const seed = entry.timelineItems.slice(0, 20);
  const next = applyEnrichedRowsToEntry(entry, seed, enrich(seed), deps);

  assert.deepEqual(holdingSet(next.items), before);
  assert.equal(next.timelineItems.length, entry.timelineItems.length);
  assert.equal(next.timelineItems[0].latestPrice, 123);
});

test('the old index-based merge loses holdings on the same input (proves the test can fail)', () => {
  const entry = nasdaqLikeEntry();
  const seed = entry.timelineItems.slice(0, 20);
  const enriched = enrich(seed);
  // What the app did before: write enriched rows over `items` by position.
  const indexMerged = entry.items.map((item, index) => enriched[index] ?? item);
  const after = holdingSet(collapsePortfolioItemsForDisplay(indexMerged));

  assert.ok(after.size < 10, `expected holdings to be lost, kept ${after.size}`);
});

test('a refresh that would remove a holding is rejected', () => {
  const entry = nasdaqLikeEntry();
  const seed = [entry.timelineItems[0]];
  // An enrichment result that renames QQQ into another ticker must not be applied.
  const bogus = [{ ...seed[0], ticker: 'NVDA', label: 'NVDA', code: 'NVDA' }];
  const next = applyEnrichedRowsToEntry(entry, seed, bogus, {
    ...deps,
    collapse: (rows) => rows.filter((r) => identityKey(r) !== 'QQQ'),
  });

  assert.equal(next, entry);
});

test('rows that changed while quotes were in flight are left alone', () => {
  const entry = nasdaqLikeEntry();
  const staleSeed = [row('QQQ', '2026-11-13', 101)]; // equal content, different object
  const next = applyEnrichedRowsToEntry(entry, staleSeed, enrich(staleSeed), deps);

  assert.equal(next, entry);
});

test('an items-only portfolio is refreshed through its items', () => {
  const items = TICKERS.slice(0, 3).map((ticker) => row(ticker, '2026-11-13', 100));
  const entry = { id: 'p', items, timelineItems: [] };
  const next = applyEnrichedRowsToEntry(entry, items, enrich(items), deps);

  assert.deepEqual(holdingSet(next.items), holdingSet(items));
  assert.ok(next.items.every((item) => item.latestPrice === 123));
});

test('refresh seeds use the latest row of each holding, not the oldest rows', () => {
  const entry = nasdaqLikeEntry();
  const seed = selectLatestRowPerHolding(entry.timelineItems, identityKey, 20);

  assert.equal(seed.length, 10);
  assert.ok(seed.every((r) => r.fields.find((f) => f.label === '날짜').value === '2026-11-13'));
  assert.equal(selectLatestRowPerHolding(entry.timelineItems, identityKey, 3).length, 3);
});

test('autosave only sends entries that differ from the last server copy', () => {
  const a = { id: 'a', items: [1] };
  const b = { id: 'b', items: [2] };
  const synced = new Map([['ws|a', JSON.stringify(a)]]);

  const changed = selectChangedEntries([a, b], synced, 'ws');
  assert.deepEqual(
    changed.map((c) => c.entry.id),
    ['b'],
  );
  assert.equal(selectChangedEntries([a], synced, 'other-ws').length, 1);
});
