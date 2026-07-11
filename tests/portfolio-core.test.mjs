import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  parsePortfolioTextDetailed,
  shouldFallbackToLocalTimeline,
} from '../src/lib/portfolioIngestionCore.js';
import { createPortfolioAllocation } from '../src/lib/portfolioAllocation.js';
import { createPortfolioHeatmap } from '../src/lib/portfolioHeatmap.js';
import { createPortfolioScorecard } from '../src/lib/portfolioScoring.js';
import { searchMarketSymbolSuggestions } from '../src/lib/liveMarketData.js';

const sampleExpectations = [
  ['samples/portfolio/portfolio_test0.csv', 5],
  ['samples/portfolio/portfolio_test1.csv', 1350],
  ['samples/portfolio/portfolio_test2.csv', 1080],
  ['samples/portfolio/portfolio_test3.csv', 1530],
  ['samples/portfolio/portfolio_test4.csv', 1980],
  ['samples/portfolio/portfolio_test5.csv', 15],
  ['samples/portfolio/portfolio_test6.csv', 40],
  ['samples/portfolio/portfolio_test7.csv', 40],
  ['samples/portfolio/portfolio_test8.csv', 40],
  ['samples/portfolio/portfolio_test9.csv', 40],
  ['samples/portfolio/portfolio_test10.csv', 40],
  ['samples/portfolio/portfolio_test11.csv', 40],
  ['samples/portfolio/portfolio_test12.csv', 40],
];

const fixtureItems = [
  {
    label: '삼성전자',
    code: '005930',
    detail: '+8.5%',
    region: '한국',
    sector: '반도체',
    style: '성장',
    risk: '중간',
    assetClass: '주식',
    fields: [
      { label: '매수일', value: '2026-01-02' },
      { label: '매수가', value: '70000' },
      { label: '보유수량', value: '10' },
      { label: '비중', value: '60%' },
    ],
  },
  {
    label: 'SCHD',
    code: 'SCHD',
    detail: '-2%',
    region: '미국',
    sector: '배당',
    style: '배당',
    risk: '낮음',
    assetClass: 'ETF',
    fields: [
      { label: '매수일', value: '2026-01-03' },
      { label: '매수가', value: '80' },
      { label: '보유수량', value: '20' },
      { label: '비중', value: '40%' },
    ],
  },
];

test('sample portfolio CSV files keep their parsed row counts', async () => {
  for (const [filePath, expectedCount] of sampleExpectations) {
    const text = await readFile(filePath, 'utf8');
    const result = parsePortfolioTextDetailed(text);

    assert.equal(result.items.length, expectedCount, filePath);
    assert.equal(result.diagnostics.parsedItemCount, expectedCount, filePath);
    assert.equal(result.diagnostics.bodyRowCount, expectedCount, filePath);
    assert.equal(result.diagnostics.reviewStatus, 'ok', filePath);
  }
});

test('parser diagnostics expose field roles without changing parsed item shape', () => {
  const csv = [
    '평가일,종목명,종목코드,매수가,보유수량,평가금액,수익률,실현손익,평가손익,통화',
    '2026-01-02,삼성전자,005930,70000,10,760000,8.5%,12000,48000,KRW',
    '2026-01-03,SCHD,SCHD,80,20,1560,-2%,0,-40,USD',
  ].join('\n');
  const result = parsePortfolioTextDetailed(csv);

  assert.equal(result.items.length, 2);
  assert.equal(result.diagnostics.fieldRoles.roles.snapshotDate.label, '평가일');
  assert.equal(result.diagnostics.fieldRoles.roles.securityName.label, '종목명');
  assert.equal(result.diagnostics.fieldRoles.roles.securityCode.index, 2);
  assert.equal(result.diagnostics.fieldRoles.roles.marketValue.label, '평가금액');
  assert.equal(result.diagnostics.fieldRoles.roles.realizedPnl.label, '실현손익');
  assert.equal(result.diagnostics.fieldRoles.roles.unrealizedPnl.label, '평가손익');
  assert.equal(result.diagnostics.fieldRoles.roles.currency.label, '통화');
  assert.equal(result.diagnostics.snapshotQuality.dateDistinctCount, 2);
  assert.equal(result.diagnostics.snapshotQuality.securityDistinctCount, 2);
});

test('parser handles broker exports with preamble rows and semicolon delimiters', () => {
  const csv = [
    '메모,증권사 다운로드',
    '',
    '계좌명;종목명;종목코드;보유수량;매입단가;평가금액;수익률;통화',
    'ISA;삼성전자;005930;10;70,000;760,000;+8.5%;KRW',
    '연금;TIGER 미국S&P500;360750;3;15,000;48,000;6.7%;KRW',
  ].join('\n');
  const result = parsePortfolioTextDetailed(csv);

  assert.equal(result.items.length, 2);
  assert.equal(result.diagnostics.delimiter, ';');
  assert.equal(result.diagnostics.hasDetectedHeader, true);
  assert.equal(result.diagnostics.skippedPreambleRowCount, 1);
  assert.equal(result.diagnostics.reviewStatus, 'ok');
  assert.deepEqual(
    result.items.map((item) => item.code),
    ['005930', '360750'],
  );
});

test('timeline fallback only triggers when API timeline loses local date coverage', () => {
  const localItems = Array.from({ length: 8 }, (_, index) => ({
    label: `Holding ${index + 1}`,
    detail: '1%',
    fields: [{ label: '날짜', value: `2026-01-${String(index + 1).padStart(2, '0')}` }],
  }));
  const apiPayload = {
    timelineItems: [
      {
        label: 'Holding 1',
        detail: '1%',
        fields: [{ label: '날짜', value: '2026-01-01' }],
      },
    ],
  };

  assert.equal(shouldFallbackToLocalTimeline(apiPayload, localItems), true);
  assert.equal(shouldFallbackToLocalTimeline({ timelineItems: localItems }, localItems), false);
});

test('allocation respects explicit weights and computes weighted return', () => {
  const allocation = createPortfolioAllocation(fixtureItems, {
    classificationMode: 'preferOriginal',
    weightMode: 'auto',
  });

  assert.equal(allocation.holdingsCount, 2);
  assert.equal(allocation.weightSource, 'explicit');
  assert.equal(allocation.hasReturnData, true);
  assert.equal(Number(allocation.totalReturn.toFixed(2)), 4.3);
  assert.equal(
    Number(allocation.segments.reduce((sum, segment) => sum + segment.weight, 0).toFixed(6)),
    1,
  );
});

test('heatmap aggregates dated return values into stable cells', () => {
  const heatmap = createPortfolioHeatmap(fixtureItems, {
    weeks: 2,
    today: new Date('2026-01-10T00:00:00+09:00'),
  });
  const positiveCell = heatmap.cells.find((cell) => cell.key === '2026-01-02');
  const negativeCell = heatmap.cells.find((cell) => cell.key === '2026-01-03');

  assert.equal(heatmap.cells.length, 14);
  assert.equal(heatmap.entriesCount, 2);
  assert.equal(positiveCell?.positive, true);
  assert.equal(negativeCell?.negative, true);
});

test('heatmap warns when percent returns and absolute pnl values are mixed', () => {
  const heatmap = createPortfolioHeatmap(
    [
      {
        label: 'A',
        fields: [
          { label: '날짜', value: '2026-01-02' },
          { label: '일일수익률', value: '2%' },
        ],
      },
      {
        label: 'B',
        fields: [
          { label: '날짜', value: '2026-01-02' },
          { label: '평가손익', value: '10000' },
        ],
      },
    ],
    { weeks: 2, today: new Date('2026-01-10T00:00:00+09:00') },
  );

  assert.ok(
    heatmap.warnings.some((warning) => warning.code === 'mixed-return-and-pnl-values'),
  );
});

test('scorecard returns bounded axis scores and matching explanations', () => {
  const scorecard = createPortfolioScorecard(fixtureItems, 'ko', {
    weightPreset: 'balanced',
  });
  const metricEntries = Object.entries(scorecard.metrics);

  assert.equal(metricEntries.length, 6);
  assert.ok(scorecard.overall >= 0 && scorecard.overall <= 100);
  for (const [key, value] of metricEntries) {
    assert.ok(value >= 0 && value <= 100, key);
    assert.equal(typeof scorecard.explanations[key], 'string');
    assert.ok(scorecard.explanations[key].length > 0);
  }
});

test('market symbol search falls back to local Korean security aliases', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network-disabled');
  };

  try {
    const suggestions = await searchMarketSymbolSuggestions('삼전', { limit: 3 });
    const preferredSuggestions = await searchMarketSymbolSuggestions('삼전우', { limit: 3 });
    const hynixSuggestions = await searchMarketSymbolSuggestions('하이닉스', { limit: 3 });

    assert.ok(suggestions.some((suggestion) => suggestion.symbol === '005930.KS'));
    assert.ok(preferredSuggestions.some((suggestion) => suggestion.symbol === '005935.KS'));
    assert.ok(hynixSuggestions.some((suggestion) => suggestion.symbol === '000660.KS'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
