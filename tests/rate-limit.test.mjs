import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  checkRateLimit,
  resetRateLimitState,
  resolveClientKey,
} from '../server/rateLimit.mjs';
import {
  getLiveMarketDataWithCache,
  resetMarketDataCache,
} from '../server/marketDataCache.mjs';

beforeEach(() => {
  resetRateLimitState();
  resetMarketDataCache();
});

test('checkRateLimit allows requests under the limit and blocks the excess', () => {
  const base = 1_000_000;

  for (let index = 0; index < 5; index += 1) {
    const result = checkRateLimit({
      bucket: 'test',
      clientKey: '1.2.3.4',
      limit: 5,
      now: base + index * 1000,
    });
    assert.equal(result.ok, true);
  }

  const blocked = checkRateLimit({
    bucket: 'test',
    clientKey: '1.2.3.4',
    limit: 5,
    now: base + 5000,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test('checkRateLimit frees capacity once the sliding window passes', () => {
  const base = 2_000_000;
  const windowMs = 60_000;

  for (let index = 0; index < 3; index += 1) {
    checkRateLimit({ bucket: 'window', clientKey: 'ip', limit: 3, windowMs, now: base });
  }

  assert.equal(
    checkRateLimit({ bucket: 'window', clientKey: 'ip', limit: 3, windowMs, now: base + 1000 }).ok,
    false,
  );
  assert.equal(
    checkRateLimit({ bucket: 'window', clientKey: 'ip', limit: 3, windowMs, now: base + windowMs + 1 }).ok,
    true,
  );
});

test('checkRateLimit reports retryAfterSeconds until the oldest request expires', () => {
  const base = 3_000_000;
  const windowMs = 60_000;

  checkRateLimit({ bucket: 'retry', clientKey: 'ip', limit: 1, windowMs, now: base });
  const blocked = checkRateLimit({
    bucket: 'retry',
    clientKey: 'ip',
    limit: 1,
    windowMs,
    now: base + 10_000,
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 50);
});

test('checkRateLimit isolates buckets and client keys', () => {
  const now = 4_000_000;

  assert.equal(checkRateLimit({ bucket: 'a', clientKey: 'ip-1', limit: 1, now }).ok, true);
  assert.equal(checkRateLimit({ bucket: 'a', clientKey: 'ip-1', limit: 1, now }).ok, false);
  assert.equal(checkRateLimit({ bucket: 'b', clientKey: 'ip-1', limit: 1, now }).ok, true);
  assert.equal(checkRateLimit({ bucket: 'a', clientKey: 'ip-2', limit: 1, now }).ok, true);
});

test('resolveClientKey prefers x-forwarded-for over socket address', () => {
  assert.equal(
    resolveClientKey({
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    }),
    '9.9.9.9',
  );
  assert.equal(
    resolveClientKey({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }),
    '127.0.0.1',
  );
  assert.equal(resolveClientKey({}), 'unknown');
});

test('getLiveMarketDataWithCache serves cached payloads within the TTL', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { latestPrice: 100 + calls };
  };
  const base = 5_000_000;

  const first = await getLiveMarketDataWithCache(
    { ticker: 'AAPL' },
    { fetcher, now: base },
  );
  const second = await getLiveMarketDataWithCache(
    { ticker: 'AAPL' },
    { fetcher, now: base + 60_000 },
  );

  assert.equal(calls, 1);
  assert.equal(first.latestPrice, 101);
  assert.equal(second.latestPrice, 101);
  assert.equal(second.stale, false);
  assert.equal(second.cache.hit, true);
});

test('getLiveMarketDataWithCache refetches after the TTL expires', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { latestPrice: calls };
  };
  const base = 6_000_000;

  await getLiveMarketDataWithCache({ ticker: 'MSFT' }, { fetcher, now: base });
  const refreshed = await getLiveMarketDataWithCache(
    { ticker: 'MSFT' },
    { fetcher, now: base + 3 * 60_000 + 1 },
  );

  assert.equal(calls, 2);
  assert.equal(refreshed.latestPrice, 2);
});

test('getLiveMarketDataWithCache falls back to the last success with stale flag', async () => {
  let shouldFail = false;
  const fetcher = async () => {
    if (shouldFail) {
      throw new Error('provider down');
    }
    return { latestPrice: 250 };
  };
  const base = 7_000_000;

  await getLiveMarketDataWithCache({ ticker: '005930.KS' }, { fetcher, now: base });

  shouldFail = true;
  const fallback = await getLiveMarketDataWithCache(
    { ticker: '005930.KS' },
    { fetcher, now: base + 10 * 60_000 },
  );

  assert.equal(fallback.latestPrice, 250);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.cache.staleReason, 'provider down');
});

test('getLiveMarketDataWithCache rethrows when there is no cached fallback', async () => {
  const fetcher = async () => {
    throw new Error('provider down');
  };

  await assert.rejects(
    getLiveMarketDataWithCache({ ticker: 'NEW' }, { fetcher, now: 8_000_000 }),
    /provider down/,
  );
});
