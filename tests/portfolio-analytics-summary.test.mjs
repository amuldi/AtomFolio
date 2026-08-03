import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { createPortfolioAnalyticsSummary } from '../src/lib/portfolioAnalyticsSummary.js';

const fixtureItems = [
  {
    label: '삼성전자',
    code: '005930',
    assetClass: '주식',
    region: '한국',
    sector: '반도체',
    fields: [
      { label: '매입금액', value: '700000' },
      { label: '평가금액', value: '760000' },
      { label: '평가손익', value: '60000' },
    ],
  },
  {
    label: 'SCHD',
    code: 'SCHD',
    assetClass: 'ETF',
    region: '미국',
    sector: '배당',
    fields: [
      { label: '매입금액', value: '1600' },
      { label: '평가금액', value: '1560' },
      { label: '평가손익', value: '-40' },
    ],
  },
  {
    label: 'TIGER 미국S&P500',
    code: '360750',
    assetClass: 'ETF',
    region: '미국',
    sector: '광범위 시장',
    fields: [
      { label: '매입금액', value: '1000000' },
      { label: '평가금액', value: '1085000' },
      { label: '평가손익', value: '85000' },
    ],
  },
];

const timelineItems = [
  {
    label: '삼성전자',
    fields: [
      { label: '날짜', value: '2026-01-02' },
      { label: '평가손익', value: '20000' },
    ],
  },
  {
    label: 'SCHD',
    fields: [
      { label: '날짜', value: '2026-01-02' },
      { label: '평가손익', value: '-10000' },
    ],
  },
  {
    label: '삼성전자',
    fields: [
      { label: '날짜', value: '2026-02-05' },
      { label: '평가손익', value: '40000' },
    ],
  },
];

function stripNonDeterministicFields(summary) {
  const { metadata, ...rest } = summary;
  const { createdAt, ...stableMetadata } = metadata;
  return { ...rest, metadata: stableMetadata };
}

test('portfolio analytics summary matches snapshot for gain/loss, weights, and profit flow', async () => {
  const summary = createPortfolioAnalyticsSummary(fixtureItems, timelineItems, {
    period: 'month',
    topN: 3,
  });

  const snapshotPath = new URL('./fixtures/portfolio-analytics-summary-snapshot.json', import.meta.url);
  const expected = JSON.parse(await readFile(snapshotPath, 'utf8'));

  assert.deepEqual(stripNonDeterministicFields(summary), expected);
});

test('portfolio analytics summary totals reconcile with individual position profit/loss', () => {
  const summary = createPortfolioAnalyticsSummary(fixtureItems, timelineItems);
  const summedProfit = summary.positions.reduce((sum, position) => sum + position.profitAmount, 0);

  assert.equal(summary.totals.holdingsCount, 3);
  assert.equal(Number(summary.totals.totalProfitAmount.toFixed(2)), Number(summedProfit.toFixed(2)));
  assert.equal(
    Number(summary.totals.totalReturnRate.toFixed(4)),
    Number(((summary.totals.totalProfitAmount / summary.totals.totalBuyAmount) * 100).toFixed(4)),
  );
});
