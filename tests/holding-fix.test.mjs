import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHoldingIssues, suggestHoldingFix } from '../src/lib/holdingIssues.js';
import {
  readRecordedReturnRate,
  resolveHoldingPosition,
  setHoldingField,
} from '../src/lib/portfolioAnalyticsSummary.js';
import { buildFxRates } from '../src/utils/currency.js';

const fxRates = buildFxRates(1400);
const position = (fields, extra = {}) =>
  resolveHoldingPosition({ label: 'X', fields, ...extra }, { baseCurrency: 'KRW', fxRates });

test('buy price far from the quote is rebuilt from the recorded return', () => {
  // QQQI saved with QQQ's buy price, while the recorded return was an ordinary +3.3%.
  const item = {
    label: 'QQQI',
    currency: 'USD',
    fields: [
      { label: '매수가', value: '690.38' },
      { label: '보유수량', value: '10' },
      { label: '현재가', value: '51.6' },
      { label: '수익률', value: '3.3%' },
    ],
  };
  const pos = resolveHoldingPosition(item, { baseCurrency: 'KRW', fxRates });
  const fix = suggestHoldingFix(pos, { recordedReturnRate: readRecordedReturnRate(item), usdKrwRate: 1400 });
  assert.equal(fix.code, 'price-ratio');
  assert.equal(fix.patch.buyPrice, 49.95); // 51.6 / 1.033

  const fixed = setHoldingField(item, 'buyPrice', fix.patch.buyPrice, '매수가');
  const after = resolveHoldingPosition(fixed, { baseCurrency: 'KRW', fxRates });
  assert.deepEqual(detectHoldingIssues(after), []);
  assert.ok(Math.abs(after.returnRate - 3.3) < 0.05);
});

test('buy price typed in KRW for a USD stock is converted', () => {
  const pos = position(
    [
      { label: '매수가', value: '280000' },
      { label: '보유수량', value: '5' },
      { label: '현재가', value: '210' },
    ],
    { currency: 'USD' },
  );
  const fix = suggestHoldingFix(pos, { usdKrwRate: 1400 });
  assert.equal(fix.patch.buyPrice, 200);
  assert.equal(fix.patch.purchaseCurrency, 'USD');
});

test('missing quantity is filled from market value ÷ current price', () => {
  const pos = position([
    { label: '매수가', value: '60000' },
    { label: '현재가', value: '75000' },
    { label: '평가금액', value: '1500000' },
  ]);
  const fix = suggestHoldingFix(pos);
  assert.equal(fix.code, 'no-shares');
  assert.equal(fix.patch.shares, 20);
});

test('no fix is offered when the right value cannot be inferred', () => {
  const pos = position(
    [
      { label: '매수가', value: '690' },
      { label: '보유수량', value: '10' },
      { label: '현재가', value: '51.6' },
      { label: '수익률', value: '-92%' },
    ],
    { currency: 'USD' },
  );
  assert.equal(suggestHoldingFix(pos, { recordedReturnRate: -92, usdKrwRate: 1400 }), null);
  assert.equal(suggestHoldingFix(position([{ label: '매수가', value: '100' }, { label: '보유수량', value: '1' }])), null);
});

test('setHoldingField replaces a matching field or appends one', () => {
  const item = { fields: [{ label: '매입가', value: '1' }] };
  assert.deepEqual(setHoldingField(item, 'buyPrice', 2, '매수가').fields, [{ label: '매입가', value: '2' }]);
  assert.deepEqual(setHoldingField(item, 'shares', 3, '보유수량').fields.at(-1), { label: '보유수량', value: '3' });
});

test('recorded return ignores the live daily change fields', () => {
  assert.equal(readRecordedReturnRate({ fields: [{ label: '등락률', value: '+1.2%' }] }), null);
  assert.equal(readRecordedReturnRate({ fields: [{ label: '수익률', value: '+3.3%' }] }), 3.3);
});
