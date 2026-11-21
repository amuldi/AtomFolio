import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeChange,
  nextFilingDeadline,
  portfolioDrift,
  quoteTickers,
  summarizeTrades,
} from '../src/lib/guruLive.js';
import { normalizeSince, summarizeChart, toYahooSymbol } from '../server/guruQuotes.mjs';

test('quote tickers skip unresolved CUSIPs and duplicates', () => {
  const tickers = quoteTickers(
    {
      holdings: [{ ticker: 'AAPL' }, { ticker: 'CUSIP:123' }],
      changes: [{ ticker: 'AAPL' }, { ticker: 'BAC' }],
    },
    { issuers: [{ ticker: 'TSLA' }, { ticker: '' }] },
  );
  assert.deepEqual(tickers, ['AAPL', 'BAC', 'TSLA']);
});

test('portfolio drift weights each holding by its filed weight', () => {
  const drift = portfolioDrift(
    [
      { ticker: 'A', weight: 0.6 },
      { ticker: 'B', weight: 0.2 },
      { ticker: 'C', weight: 0.2 },
    ],
    { A: { sincePct: 10, dayPct: 1 }, B: { sincePct: -10, dayPct: -1 } },
  );
  assert.equal(drift.sincePct, 5); // (0.6*10 + 0.2*-10) / 0.8
  assert.equal(drift.coverage, 0.8);
  assert.ok(drift.dayPct > 0 && drift.dayPct < 1);
  assert.equal(portfolioDrift([{ ticker: 'A', weight: 1 }], {}).sincePct, null);
});

test('next 13F deadline is 45 days after the following quarter end', () => {
  assert.equal(nextFilingDeadline('2026-09-30'), '2027-02-14');
  assert.equal(nextFilingDeadline('2026-06-30'), '2026-11-14');
  assert.equal(nextFilingDeadline('2026-12-31'), '2027-05-15');
  assert.equal(nextFilingDeadline('nope'), null);
});

test('change phrases read naturally', () => {
  assert.equal(describeChange({ kind: 'new' }), '신규 편입');
  assert.equal(describeChange({ kind: 'added', sharesBefore: 100, sharesAfter: 123 }), '추가 +23%');
  assert.equal(describeChange({ kind: 'trimmed', sharesBefore: 100, sharesAfter: 82 }), '축소 −18%');
  assert.equal(describeChange({ kind: 'soldOut' }, 'en'), 'Sold out');
});

test('trade summary separates buys from sells and totals them', () => {
  const summary = summarizeTrades([
    { kind: 'trimmed', tradeValueUsd: 300 },
    { kind: 'new', tradeValueUsd: 100 },
    { kind: 'added', tradeValueUsd: 250 },
    { kind: 'soldOut', tradeValueUsd: 50 },
  ]);
  assert.deepEqual(summary.buys.map((change) => change.tradeValueUsd), [250, 100]);
  assert.equal(summary.boughtUsd, 350);
  assert.equal(summary.soldUsd, 350);
  assert.equal(summary.netUsd, 0);
});

test('quote server helpers: symbols, dates and chart summary', () => {
  assert.equal(toYahooSymbol('BRK.B'), 'BRK-B');
  assert.equal(toYahooSymbol('CUSIP:123'), null);
  assert.equal(toYahooSymbol('005930'), null);
  assert.equal(normalizeSince('2026-09-30'), '2026-09-30');
  assert.equal(normalizeSince('yesterday'), null);
  const day = 86_400;
  const base = Date.parse('2026-09-28T20:00:00Z') / 1000;
  const summary = summarizeChart(
    {
      meta: { regularMarketPrice: 110, currency: 'USD', regularMarketTime: base + 5 * day },
      timestamp: [base, base + 2 * day, base + 3 * day, base + 5 * day],
      indicators: { quote: [{ close: [90, 100, 105, 110] }] },
    },
    '2026-09-30',
  );
  assert.equal(summary.price, 110);
  assert.equal(summary.periodClose, 100); // last close on or before the period end
  assert.equal(summary.sincePct, 10);
  assert.equal(summary.dayPct, 4.76); // vs the previous bar (105)
  assert.equal(summarizeChart({ meta: {}, timestamp: [], indicators: { quote: [{ close: [] }] } }, null), null);
});
