import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isPortfolioAtomItem,
  filterPortfolioItemsForAtomScene,
  explainExcludedPortfolioAtomItem,
} from '../src/utils/portfolioItems.js';

// Regression coverage for "종목이 조용히 원자에서 빠지는 문제": an item with real holding data
// (buy price, quantity, return, ...) must be treated as a security even when its name doesn't
// match any of the hardcoded ETF/company keyword hints or ticker-code shape.
test('an item with a real buy price is kept even with an unrecognizable name', () => {
  const item = {
    label: '나만의 비상장 포지션',
    fields: [{ label: '매수가', value: '12,345' }],
  };

  assert.equal(isPortfolioAtomItem(item), true);
});

test('an item with real share quantity is kept even with an unrecognizable name', () => {
  const item = {
    label: 'XYZ 알수없는자산',
    shares: '10',
  };

  assert.equal(isPortfolioAtomItem(item), true);
});

test('an item with a real return rate is kept even with an unrecognizable name', () => {
  const item = {
    label: '뭔가 특이한 항목',
    return: '+3.2%',
  };

  assert.equal(isPortfolioAtomItem(item), true);
});

test('an item with a market value field is kept even with an unrecognizable name', () => {
  const item = {
    label: '이상한 이름',
    fields: [{ label: '평가금액', value: '1,000,000' }],
  };

  assert.equal(isPortfolioAtomItem(item), true);
});

test('recognizable ETF/company names are still kept as before (no regression)', () => {
  assert.equal(isPortfolioAtomItem({ label: 'TIGER 미국S&P500', code: '360750' }), true);
  assert.equal(isPortfolioAtomItem({ label: '삼성전자', code: '005930' }), true);
});

test('a row with neither a recognizable name/code nor any holding data is still excluded', () => {
  const item = { label: '개인연금' };

  assert.equal(isPortfolioAtomItem(item), false);
});

test('account-label and date rows are still excluded even though this filter got looser', () => {
  const accountRow = { label: 'ISA', fields: [{ label: '계좌', value: 'ISA' }] };
  const dateRow = { label: '2026-08-12', fields: [{ label: '날짜', value: '2026-08-12' }] };

  assert.equal(isPortfolioAtomItem(accountRow), false);
  assert.equal(isPortfolioAtomItem(dateRow), false);
});

// Regression coverage for "채권/리츠/금 자산군을 고르면 원자에서 사라지는 문제": asset class
// (주식/채권/리츠/금 등) must never gate atom visibility on its own — a bond, REIT, or gold
// position with real holding data still gets a node, same as a stock would.
test('a non-stock asset class is still kept when real holding data is present', () => {
  const bond = {
    label: '국고채 10년',
    assetClass: '채권',
    fields: [{ label: '매수가', value: '10,000' }],
  };

  assert.equal(isPortfolioAtomItem(bond), true);
});

test('a bare zero return (the manual-entry form\'s default for a blank field) does not count as substantive data on its own', () => {
  // Regression case found via manual verification: App.jsx's createManualPortfolioItem defaults an
  // unfilled 수익률 to exactly "0%" for every manually-created item, so "the return field is
  // non-empty" can't be trusted as evidence of real user-entered data — only a genuinely non-zero
  // value should count.
  const item = {
    label: '정체불명항목',
    fields: [{ label: '수익률', value: '0%' }],
  };

  assert.equal(isPortfolioAtomItem(item), false);
});

test('a totals/subtotal row with a real number in a holding-data field is still excluded', () => {
  // Regression case found via manual verification: a broker-export "합계" (totals) row can land a
  // real summed number in what looks like a 매수가 column, which would otherwise satisfy
  // hasSubstantiveHoldingData — isGenericNonSecurityValue on the row's own name is what actually
  // rules this out, same as it always has for the no-data path.
  const totalsRow = {
    label: '합계',
    fields: [
      { label: '종목명', value: '합계' },
      { label: '매수가', value: '1500000' },
    ],
  };

  assert.equal(isPortfolioAtomItem(totalsRow), false);
});

test('a bare numeric-looking or placeholder value in a holding-data field does not count', () => {
  // isGenericNonSecurityValue-style noise (e.g. a percent sign alone, or an account-type label
  // that happens to end up copied into a field position) shouldn't trick hasSubstantiveHoldingData.
  const item = { label: '이상한 이름', fields: [{ label: '매수가', value: '' }] };

  assert.equal(isPortfolioAtomItem(item), false);
});

test('filterPortfolioItemsForAtomScene keeps data-backed items and drops non-securities', () => {
  const items = [
    { label: 'Apple Inc.', code: 'AAPL' },
    { label: '알수없는이름', fields: [{ label: '보유수량', value: '5' }] },
    { label: '개인연금' },
    { label: '2026-08-12', fields: [{ label: '날짜', value: '2026-08-12' }] },
  ];

  const visible = filterPortfolioItemsForAtomScene(items);

  assert.equal(visible.length, 2);
  assert.deepEqual(
    visible.map((entry) => entry.label),
    ['Apple Inc.', '알수없는이름'],
  );
});

test('explainExcludedPortfolioAtomItem returns null for included items and a reason for excluded ones', () => {
  assert.equal(explainExcludedPortfolioAtomItem({ label: 'Apple Inc.', code: 'AAPL' }), null);
  assert.equal(explainExcludedPortfolioAtomItem({ label: '개인연금' }), 'no-recognizable-identity');
  assert.equal(explainExcludedPortfolioAtomItem(null), 'invalid-item');
});
