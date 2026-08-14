import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFxRates,
  convertCurrencyAmount,
  formatCurrencyAmount,
  inferHoldingCurrency,
  normalizeCurrencyCode,
} from '../src/utils/currency.js';

test('normalizeCurrencyCode only accepts KRW/USD, case-insensitively', () => {
  assert.equal(normalizeCurrencyCode('usd'), 'USD');
  assert.equal(normalizeCurrencyCode('KRW'), 'KRW');
  assert.equal(normalizeCurrencyCode('eur'), '');
  assert.equal(normalizeCurrencyCode(''), '');
  assert.equal(normalizeCurrencyCode(undefined), '');
});

test('buildFxRates is internally consistent (USD->KRW and KRW->USD are inverses)', () => {
  const fxRates = buildFxRates(1300);
  assert.equal(fxRates.USD.KRW, 1300);
  assert.equal(fxRates.KRW.USD, 1 / 1300);
});

test('buildFxRates falls back to the default rate for invalid input', () => {
  const fxRates = buildFxRates(-5);
  assert.equal(fxRates.USD.KRW, 1365);
});

test('convertCurrencyAmount converts USD to KRW using the given rate', () => {
  const fxRates = buildFxRates(1400);
  assert.equal(convertCurrencyAmount(100, 'USD', 'KRW', fxRates), 140000);
  assert.equal(convertCurrencyAmount(140000, 'KRW', 'USD', fxRates), 100);
});

test('convertCurrencyAmount is a no-op for same-currency conversion', () => {
  assert.equal(convertCurrencyAmount(500, 'KRW', 'KRW'), 500);
});

test('convertCurrencyAmount returns null for a non-numeric value', () => {
  assert.equal(convertCurrencyAmount('not-a-number', 'USD', 'KRW'), null);
});

test('inferHoldingCurrency prefers an explicit currency field over ticker shape', () => {
  assert.equal(inferHoldingCurrency({ code: 'AAPL', currency: 'KRW' }), 'KRW');
  assert.equal(inferHoldingCurrency({ code: '005930', marketCurrency: 'USD' }), 'USD');
});

test('inferHoldingCurrency falls back to ticker shape when no explicit currency is present', () => {
  assert.equal(inferHoldingCurrency({ code: 'AAPL' }), 'USD');
  assert.equal(inferHoldingCurrency({ ticker: 'MSFT' }), 'USD');
  assert.equal(inferHoldingCurrency({ code: '005930' }), 'KRW');
  assert.equal(inferHoldingCurrency({ code: '005930.KS' }), 'KRW');
});

test('inferHoldingCurrency defaults to KRW when nothing is recognizable', () => {
  assert.equal(inferHoldingCurrency({}), 'KRW');
  assert.equal(inferHoldingCurrency({ code: '' }), 'KRW');
});

test('formatCurrencyAmount formats KRW as a whole-won amount and USD with cents', () => {
  assert.equal(formatCurrencyAmount(1234000, 'KRW'), '₩1,234,000');
  assert.equal(formatCurrencyAmount(1234.5, 'USD'), '$1,234.50');
  assert.equal(formatCurrencyAmount(-500, 'KRW'), '-₩500');
});

test('formatCurrencyAmount returns a placeholder for non-numeric input', () => {
  assert.equal(formatCurrencyAmount(undefined, 'KRW'), '-');
  assert.equal(formatCurrencyAmount(NaN, 'USD'), '-');
});
