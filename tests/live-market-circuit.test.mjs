import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isProviderHealthFailure,
  resetLiveMarketDataProviderHealth,
} from '../src/lib/liveMarketData.js';

// Regression coverage for the outage where a few unknown tickers tripped every provider's
// circuit breaker and blocked quotes for *all* symbols (AAPL included) for 30s at a time.
test('an unknown ticker does not count against a provider', () => {
  resetLiveMarketDataProviderHealth();
  for (const message of [
    'quote-fetch-failed:404',
    'quote-empty',
    'naver-quote-empty',
    'stooq-empty',
    'stooq-fetch-failed:404',
    'No data found, symbol may be delisted',
  ]) {
    assert.equal(isProviderHealthFailure(new Error(message)), false, message);
  }
});

test('rate limits, server errors, timeouts and network failures do count', () => {
  for (const message of [
    'quote-fetch-failed:429',
    'stooq-fetch-failed:503',
    'json-fetch-failed:500',
    'request timed out',
    'fetch failed',
    'mirae-proxy-not-configured',
  ]) {
    assert.equal(isProviderHealthFailure(new Error(message)), true, message);
  }

  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  assert.equal(isProviderHealthFailure(aborted), true);
});
