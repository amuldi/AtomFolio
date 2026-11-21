import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyBucketFromText, matches, searchableText } from '../src/lib/assetKeywords.js';
import { applyMarketScenario, createPortfolioTwin, runStressTest, simulateRebalance } from '../src/lib/digitalTwin.js';

// Every holding in the app carries these field names; none of them says anything about the asset.
const holding = (label, values = {}) => ({
  id: label,
  label,
  detail: '+10%',
  fields: [
    { label: '평가금액', value: '4200' },
    { label: '매수가', value: '100' },
    { label: '보유수량', value: '10' },
    { label: '자산군', value: values.assetClass ?? '주식' },
    { label: '통화', value: values.currency ?? 'KRW' },
    { label: '상장 시장', value: values.market ?? 'KRX' },
  ],
});

test('field names are never searched, only values', () => {
  const text = searchableText(holding('삼성전자'));
  assert.ok(!text.includes('평가금액'));
  assert.equal(classifyBucketFromText(text), 'stock');
});

test('금 only counts as its own word', () => {
  assert.ok(matches('goldCash', '금 etf'));
  assert.ok(matches('goldCash', 'kodex 골드선물'));
  assert.ok(matches('goldCash', '현금성 자산'));
  for (const text of ['금융', '평가금액', '자금', '삼성금융']) assert.ok(!matches('goldCash', text), text);
});

test('short latin tokens must be whole words', () => {
  assert.ok(!matches('us', 'business services inc'));
  assert.ok(!matches('tech', 'hair care'));
  assert.ok(!matches('goldCash', 'billing corp'));
  assert.ok(matches('us', 'aapl'));
  assert.ok(matches('us', '미국'));
  assert.ok(matches('tech', 'ai software'));
});

test('buckets follow the same order everywhere', () => {
  assert.equal(classifyBucketFromText('reit 배당'), 'reit');
  assert.equal(classifyBucketFromText('gold 배당'), 'goldCash');
  assert.equal(classifyBucketFromText('schd'), 'dividend');
  assert.equal(classifyBucketFromText('s&p500 etf'), 'stock');
  assert.equal(classifyBucketFromText('???'), 'other');
});

test('a stock portfolio is not treated as cash in the simulation', () => {
  const twin = createPortfolioTwin(
    [holding('삼성전자'), holding('Coca-Cola', { market: 'NYSE' }), holding('KODEX 200', { assetClass: 'ETF' })],
    [],
    { positionValues: [4000, 3000, 3000] },
  );
  assert.deepEqual(twin.rebalanceBuckets.map((bucket) => bucket.label), ['stock']);
  // Nothing here is defensive, so a recession hits every holding by the same -12 plus its own extras.
  const recession = runStressTest(twin, 'global_recession');
  assert.equal(recession.defensiveAsset, null);
  assert.ok(recession.positions.every((position) => position.scenarioShock <= -6));
  const rebalance = simulateRebalance(twin, { stock: '50', dividend: '20', goldCash: '15', reit: '5', other: '10' });
  assert.equal(rebalance.current.goldCash, 0);
  assert.equal(rebalance.current.stock, 1);
});

test('gold really is defensive', () => {
  const twin = createPortfolioTwin(
    [holding('삼성전자'), holding('KODEX 골드선물', { assetClass: '원자재' })],
    [],
    { positionValues: [5000, 5000] },
  );
  const result = applyMarketScenario(twin, { globalShock: -10, goldCashShock: 10 });
  const gold = result.positions.find((position) => position.label.includes('골드'));
  assert.equal(gold.scenarioShock, 0);
  assert.equal(result.defensiveAsset?.label, 'KODEX 골드선물');
});

test('heatmap averages percentages across holdings instead of adding them', async () => {
  const { createPortfolioHeatmap } = await import('../src/lib/portfolioHeatmap.js');
  const row = (detail, date) => ({ id: detail, label: detail, detail, fields: [{ label: '날짜', value: date }] });
  const heatmap = createPortfolioHeatmap(
    [row('+5%', '2026-11-20'), row('+5%', '2026-11-20'), row('+5%', '2026-11-20'), row('-2%', '2026-11-19')],
    { today: new Date(2026, 10, 21) },
  );
  const byKey = Object.fromEntries(heatmap.cells.filter((cell) => cell.hasData).map((cell) => [cell.key, cell.value]));
  assert.equal(byKey['2026-11-20'], 5);
  assert.equal(byKey['2026-11-19'], -2);
});
