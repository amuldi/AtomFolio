import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  isKisConfigured,
  fetchKisDomesticQuote,
  resetKisTokenState,
} from '../server/marketData/kisProvider.mjs';
import { fetchLiveQuoteWithKisRouting } from '../server/marketData/liveQuoteRouter.mjs';

const ORIGINAL_APP_KEY = process.env.KIS_APP_KEY;
const ORIGINAL_APP_SECRET = process.env.KIS_APP_SECRET;

function setKisCredentials(appKey, appSecret) {
  if (appKey) {
    process.env.KIS_APP_KEY = appKey;
  } else {
    delete process.env.KIS_APP_KEY;
  }
  if (appSecret) {
    process.env.KIS_APP_SECRET = appSecret;
  } else {
    delete process.env.KIS_APP_SECRET;
  }
}

function mockTokenResponse(accessToken = 'test-token') {
  return new Response(JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 86400 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockQuoteResponse({ price = '71900', change = '1200', changePercent = '1.70' } = {}) {
  return new Response(
    JSON.stringify({
      rt_cd: '0',
      msg1: '정상처리 되었습니다.',
      output: { stck_prpr: price, prdy_vrss: change, prdy_ctrt: changePercent },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

// A plain, always-succeeding Stooq CSV row — used as the guaranteed last-resort stop in
// fetchLiveMarketDataFromProviders's own chain so "KIS fails, falls back" tests have something
// deterministic to land on regardless of which earlier providers (Naver, Yahoo) also get hit.
function mockStooqCsv() {
  return new Response('Symbol,Date,Time,Open,High,Low,Close,Volume\n005930.KR,2026-08-12,05:00:00,71000,72000,70500,71900,1000000\n', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

beforeEach(() => {
  resetKisTokenState();
  setKisCredentials('test-app-key', 'test-app-secret');
});

afterEach(() => {
  setKisCredentials(ORIGINAL_APP_KEY, ORIGINAL_APP_SECRET);
  resetKisTokenState();
});

test('isKisConfigured reflects whether both env vars are set', () => {
  setKisCredentials('key', 'secret');
  assert.equal(isKisConfigured(), true);

  setKisCredentials('key', '');
  assert.equal(isKisConfigured(), false);

  setKisCredentials('', 'secret');
  assert.equal(isKisConfigured(), false);

  setKisCredentials('', '');
  assert.equal(isKisConfigured(), false);
});

test('fetchKisDomesticQuote parses a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes('/oauth2/tokenP')) {
      return mockTokenResponse();
    }
    if (String(url).includes('/inquire-price')) {
      return mockQuoteResponse({ price: '71900', change: '1200', changePercent: '1.70' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const quote = await fetchKisDomesticQuote('005930.KS');

    assert.equal(quote.symbol, '005930');
    assert.equal(quote.latestPrice, 71900);
    assert.equal(quote.change, 1200);
    assert.equal(quote.changePercent, 1.7);
    assert.equal(quote.previousClose, 71900 - 1200);
    assert.equal(quote.currency, 'KRW');
    assert.equal(quote.source, '한국투자증권');
    assert.ok(calledUrls.some((url) => url.includes('/oauth2/tokenP')));
    assert.ok(calledUrls.some((url) => url.includes('FID_INPUT_ISCD=005930')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchKisDomesticQuote reuses a cached token across calls instead of re-issuing it', async () => {
  const originalFetch = globalThis.fetch;
  let tokenRequests = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/tokenP')) {
      tokenRequests += 1;
      return mockTokenResponse();
    }
    return mockQuoteResponse();
  };

  try {
    await fetchKisDomesticQuote('005930.KS');
    await fetchKisDomesticQuote('000660.KS');
    assert.equal(tokenRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchKisDomesticQuote re-issues a token once the cached one is reset (expiry path)', async () => {
  const originalFetch = globalThis.fetch;
  let tokenRequests = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/tokenP')) {
      tokenRequests += 1;
      return mockTokenResponse(`token-${tokenRequests}`);
    }
    return mockQuoteResponse();
  };

  try {
    await fetchKisDomesticQuote('005930.KS');
    assert.equal(tokenRequests, 1);

    // Simulates the cached token having aged past its refresh margin — resetKisTokenState is the
    // same hook a real expiry would produce (getAccessToken sees no usable cached token and calls
    // issueAccessToken again), without needing to fake the passage of 23+ hours of wall-clock time.
    resetKisTokenState();
    await fetchKisDomesticQuote('005930.KS');
    assert.equal(tokenRequests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchKisDomesticQuote rejects a non-domestic symbol without making a network call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('should not be called');
  };

  try {
    await assert.rejects(fetchKisDomesticQuote('AAPL'), /kis-symbol-not-domestic/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLiveQuoteWithKisRouting falls back silently when KIS itself fails', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('koreainvestment.com')) {
      throw new Error('kis-network-down');
    }
    if (href.includes('stooq.com')) {
      return mockStooqCsv();
    }
    // Naver / Yahoo / Mirae Asset proxy attempts all fail before Stooq's own turn — matches the
    // existing chain's already-established "try the next one" behavior, just exercised here to
    // reach a deterministic final stop.
    throw new Error('upstream-unavailable');
  };

  try {
    const quote = await fetchLiveQuoteWithKisRouting({ ticker: '005930.KS', name: '삼성전자' });
    assert.equal(quote.source, 'Stooq');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLiveQuoteWithKisRouting skips KIS entirely with no credentials configured', async () => {
  setKisCredentials('', '');
  const originalFetch = globalThis.fetch;
  let kisCalled = false;

  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('koreainvestment.com')) {
      kisCalled = true;
      throw new Error('should not be reached');
    }
    if (href.includes('stooq.com')) {
      return mockStooqCsv();
    }
    throw new Error('upstream-unavailable');
  };

  try {
    const quote = await fetchLiveQuoteWithKisRouting({ ticker: '005930.KS', name: '삼성전자' });
    assert.equal(kisCalled, false);
    assert.equal(quote.source, 'Stooq');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLiveQuoteWithKisRouting resolves a Korean company name to a KIS quote when no ticker is given', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes('/oauth2/tokenP')) {
      return mockTokenResponse();
    }
    if (String(url).includes('/inquire-price')) {
      return mockQuoteResponse({ price: '81500', change: '-500', changePercent: '-0.61' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    // No ticker at all — only a Korean company name, the shape a lot of real CSV imports arrive
    // in (see README's CSV-inference section). This should still resolve to 005930 via the
    // offline local alias table and hit KIS, not fall straight through to Naver/Yahoo/Stooq.
    const quote = await fetchLiveQuoteWithKisRouting({ name: '삼성전자' });

    assert.equal(quote.source, '한국투자증권');
    assert.equal(quote.symbol, '005930');
    assert.equal(quote.latestPrice, 81500);
    assert.ok(calledUrls.some((url) => url.includes('FID_INPUT_ISCD=005930')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLiveQuoteWithKisRouting uses the KIS quote when it succeeds', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/oauth2/tokenP')) {
      return mockTokenResponse();
    }
    if (href.includes('/inquire-price')) {
      return mockQuoteResponse({ price: '81500', change: '-500', changePercent: '-0.61' });
    }
    throw new Error(`unexpected fetch during a should-succeed KIS path: ${href}`);
  };

  try {
    const quote = await fetchLiveQuoteWithKisRouting({ ticker: '005930.KS', name: '삼성전자' });
    assert.equal(quote.source, '한국투자증권');
    assert.equal(quote.latestPrice, 81500);
    assert.equal(quote.name, '삼성전자');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
