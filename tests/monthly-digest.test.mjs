import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMonthlyDigest } from '../src/lib/monthlyDigest.js';
import { createPortfolioAnalyticsSummary } from '../src/lib/portfolioAnalyticsSummary.js';
import { overallScoreFor, SCORE_WEIGHT_PRESETS } from '../src/lib/portfolioScoring.js';

const period = (periodKey, holdings, totals) => ({ periodKey, holdings, ...totals });

test('compares the latest month with the previous one, holding by holding', () => {
  const digest = buildMonthlyDigest({
    profitFlow: [
      period(
        '2026-09',
        [
          { key: 'A', label: 'Alpha', profitAmount: 100 },
          { key: 'B', label: 'Beta', profitAmount: 50 },
        ],
        { marketValue: 1000, profitAmount: 150, returnRate: 17.6 },
      ),
      period(
        '2026-10',
        [
          { key: 'A', label: 'Alpha', profitAmount: 160 },
          { key: 'B', label: 'Beta', profitAmount: 20 },
          { key: 'C', label: 'New', profitAmount: 500 },
        ],
        { marketValue: 1300, profitAmount: 680, returnRate: 20 },
      ),
    ],
  });

  assert.equal(digest.periodKey, '2026-10');
  assert.equal(digest.previousPeriodKey, '2026-09');
  assert.equal(digest.marketValueChange, 300);
  assert.equal(digest.profitChange, 530);
  assert.ok(Math.abs(digest.returnRateChange - 2.4) < 1e-9);
  assert.equal(digest.moversBasis, 'month');
  assert.deepEqual(digest.gainers.map((row) => [row.label, row.change]), [['Alpha', 60]]);
  assert.deepEqual(digest.losers.map((row) => [row.label, row.change]), [['Beta', -30]]);
  // "New" was bought this month: no baseline, so it is not reported as a +500 mover.
  assert.ok(![...digest.gainers, ...digest.losers].some((row) => row.key === 'C'));
});

test('a single recorded month falls back to cumulative P/L', () => {
  const digest = buildMonthlyDigest({
    profitFlow: [
      period('2026-10', [{ key: 'A', label: 'Alpha', profitAmount: -40 }], {
        marketValue: 900,
        profitAmount: -40,
        returnRate: -4.3,
      }),
    ],
  });
  assert.equal(digest.previousPeriodKey, null);
  assert.equal(digest.marketValueChange, null);
  assert.equal(digest.moversBasis, 'cumulative');
  assert.deepEqual(digest.losers.map((row) => row.change), [-40]);
});

test('no timeline means no digest', () => {
  assert.equal(buildMonthlyDigest({ profitFlow: [] }), null);
  assert.equal(buildMonthlyDigest(null), null);
});

test('the analytics summary carries per-holding snapshots into each month', () => {
  const row = (date, label, buy, current) => ({
    label,
    ticker: label,
    fields: [
      { label: '날짜', value: date },
      { label: '매수가', value: String(buy) },
      { label: '보유수량', value: '1' },
      { label: '현재가', value: `₩${current}` },
      { label: '통화', value: 'KRW' },
    ],
  });
  const timeline = [
    row('2026-09-30', 'AAA', 1000, 1100),
    row('2026-10-31', 'AAA', 1000, 1300),
  ];
  const summary = createPortfolioAnalyticsSummary(timeline, timeline, { baseCurrency: 'KRW' });
  const months = summary.profitFlow.map((period) => period.holdings.map((holding) => holding.key));
  assert.deepEqual(months, [['AAA'], ['AAA']]);
  const digest = buildMonthlyDigest(summary);
  assert.deepEqual(digest.gainers.map((holding) => holding.change), [200]);
});

test('every weighting style scores the same six axes, so all four can be shown at once', () => {
  const metrics = {
    profitability: 90,
    diversification: 40,
    riskManagement: 50,
    composition: 60,
    timing: 55,
    stability: 45,
  };
  const scores = Object.keys(SCORE_WEIGHT_PRESETS).map((preset) => overallScoreFor(metrics, preset));
  assert.equal(scores.length, 4);
  // A profit-heavy portfolio scores higher on the aggressive style than on the stable one.
  assert.ok(overallScoreFor(metrics, 'returnFocus') > overallScoreFor(metrics, 'stabilityFocus'));
});
