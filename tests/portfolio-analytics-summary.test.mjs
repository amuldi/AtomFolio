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

test('foreign (USD) holdings are converted to KRW before being summed into totals', () => {
  const domesticOnly = [
    {
      label: '삼성전자',
      code: '005930',
      currency: 'KRW',
      fields: [
        { label: '매입금액', value: '700000' },
        { label: '평가금액', value: '760000' },
      ],
    },
  ];

  // Same shares/buyPrice/currentPrice as a real US holding: buyAmount=25*170=4250 USD,
  // marketValue=25*185.4=4635 USD. Explicit currency: 'USD' matches what a resolved live quote
  // sets on the item (see App.jsx's applyLiveQuoteToPortfolioItem).
  const withForeignHolding = [
    ...domesticOnly,
    {
      label: 'Apple',
      code: 'AAPL',
      currency: 'USD',
      fields: [
        { label: '보유수량', value: '25' },
        { label: '매수가', value: '170' },
        { label: '현재가', value: '185.4' },
      ],
    },
  ];

  const usdKrwRate = 1400;
  const domesticSummary = createPortfolioAnalyticsSummary(domesticOnly, [], { usdKrwRate });
  const mixedSummary = createPortfolioAnalyticsSummary(withForeignHolding, [], { usdKrwRate });

  const applePosition = mixedSummary.positions.find((position) => position.code === 'AAPL');
  assert.equal(applePosition.nativeCurrency, 'USD');
  assert.equal(applePosition.nativeBuyAmount, 4250);
  assert.equal(applePosition.nativeMarketValue, 4635);
  // Converted (KRW) value must equal the USD figure times the FX rate, not the raw USD number.
  assert.equal(applePosition.buyAmount, 4250 * usdKrwRate);
  assert.equal(applePosition.marketValue, 4635 * usdKrwRate);

  // The KRW-denominated total must grow by the converted (not raw) foreign amount — this is the
  // exact bug: before the fix, totalMarketValue would only grow by 4635 (treating $4,635 as if it
  // were ₩4,635), not by 4635 * usdKrwRate.
  assert.equal(
    mixedSummary.totals.totalMarketValue,
    domesticSummary.totals.totalMarketValue + 4635 * usdKrwRate,
  );
  assert.equal(
    mixedSummary.totals.totalBuyAmount,
    domesticSummary.totals.totalBuyAmount + 4250 * usdKrwRate,
  );
  assert.equal(mixedSummary.totals.baseCurrency, 'KRW');
});

test('a holding with no explicit currency falls back to inferring USD from a letters-only ticker', () => {
  const items = [
    {
      label: 'Schwab US Dividend Equity ETF',
      code: 'SCHD',
      fields: [
        { label: '보유수량', value: '10' },
        { label: '매수가', value: '80' },
        { label: '현재가', value: '82' },
      ],
    },
  ];

  const usdKrwRate = 1300;
  const summary = createPortfolioAnalyticsSummary(items, [], { usdKrwRate });
  const position = summary.positions[0];

  assert.equal(position.nativeCurrency, 'USD');
  assert.equal(position.nativeMarketValue, 820);
  assert.equal(position.marketValue, 820 * usdKrwRate);
});

test('a holding with a 6-digit KRX-style code infers KRW even without an explicit currency field', () => {
  const items = [
    {
      label: '삼성전자',
      code: '005930',
      fields: [
        { label: '보유수량', value: '10' },
        { label: '매수가', value: '71000' },
        { label: '현재가', value: '73000' },
      ],
    },
  ];

  const summary = createPortfolioAnalyticsSummary(items, []);
  const position = summary.positions[0];

  assert.equal(position.nativeCurrency, 'KRW');
  // No conversion should happen for a KRW holding against the default KRW base currency.
  assert.equal(position.marketValue, position.nativeMarketValue);
  assert.equal(position.marketValue, 730000);
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
