import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectHoldingIssues } from '../src/lib/holdingIssues.js';
import { resolveHoldingPosition } from '../src/lib/portfolioAnalyticsSummary.js';
import { buildFxRates } from '../src/utils/currency.js';

const fx = buildFxRates(1460, { INR: 14 });
const field = (label, value) => ({ label, value });
const holding = (fields, extra = {}) => ({ label: 'X', ...extra, fields });
const codes = (item) =>
  detectHoldingIssues(resolveHoldingPosition(item, { baseCurrency: 'KRW', fxRates: fx })).map(
    (issue) => issue.code,
  );

test('QQQI saved with QQQ buy price is flagged as a price mismatch', () => {
  const qqqi = holding(
    [field('매수가', '690.38'), field('매수통화', 'USD'), field('보유수량', '10'), field('현재가', '$51.64'), field('통화', 'USD')],
    { ticker: 'QQQI' },
  );
  assert.deepEqual(codes(qqqi), ['price-ratio']);
});

test('a holding with no quantity is flagged', () => {
  const apple = holding([field('매수가', '355.63'), field('현재가', '$354.88'), field('통화', 'USD')], {
    ticker: 'AAPL',
  });
  assert.deepEqual(codes(apple), ['no-shares']);
});

test('a normal holding is not flagged', () => {
  const tiger = holding(
    [field('매수가', '25135'), field('매수통화', 'KRW'), field('보유수량', '10'), field('현재가', '₩25,120'), field('통화', 'KRW')],
    { ticker: '360750' },
  );
  assert.deepEqual(codes(tiger), []);
});

test('a won buy price for a dollar stock is compared after currency conversion', () => {
  // 370,000원 ≈ $253 against a $300 quote: plausible, not a mismatch.
  const qqqm = holding(
    [field('매수가', '370000'), field('매수통화', 'KRW'), field('보유수량', '1'), field('현재가', '$300'), field('통화', 'USD')],
    { ticker: 'QQQM' },
  );
  assert.deepEqual(codes(qqqm), []);
});

test('labels are localized', () => {
  const position = { shares: null, buyPrice: null, currentPrice: null, returnRate: null };
  assert.equal(detectHoldingIssues(position)[0].label, '수량 없음');
  assert.equal(detectHoldingIssues(position, { language: 'en' })[0].label, 'No quantity');
});
