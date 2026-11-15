import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPortfolioItem } from '../src/lib/securityKnowledge.js';

const codeField = (item) => item.fields?.find((field) => /티커|종목코드/.test(field.label))?.value ?? item.code;

test('a name containing another ETF alias does not override an explicit ticker', () => {
  const item = enrichPortfolioItem({
    label: 'NEOS Nasdaq-100 High Income ETF',
    name: 'NEOS Nasdaq-100 High Income ETF',
    code: 'QQQI',
    ticker: 'QQQI',
    fields: [{ label: '종목코드', value: 'QQQI' }],
  });
  assert.notEqual(item.companyName, 'Invesco NASDAQ 100 ETF');
  assert.notEqual(codeField(item), 'QQQM');
  assert.notEqual(item.label, 'QQQM');
});

test('the dictionary still applies when the ticker matches the entry', () => {
  const item = enrichPortfolioItem({ label: 'QQQM', name: 'QQQM', code: 'QQQM', ticker: 'QQQM', fields: [] });
  assert.equal(item.assetClass, '주식 ETF');
});

test('name-only holdings (no ticker) still resolve through the dictionary', () => {
  const item = enrichPortfolioItem({ label: 'Invesco QQQ', name: 'Invesco QQQ', fields: [] });
  assert.equal(item.assetClass, '주식 ETF');
});
