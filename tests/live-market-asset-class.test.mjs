import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inferAssetClassFromMarketInfo } from '../src/lib/liveMarketData.js';

// Regression coverage for "종목추가 할 때 자산군은 주식정보에서 알아서 찾아서 연동되게 해줘" —
// before this, every live-quote/suggestion provider (Yahoo search, Yahoo chart, Naver, Mirae,
// Stooq) only ever returned a non-empty assetClass for the ~80 tickers hand-curated in
// LOCAL_SECURITY_UNIVERSE; everything else came back as assetClass: '', so the manual "종목 추가"
// form's 자산군 dropdown silently stayed on whatever it last was (usually the '주식' default) no
// matter what was actually being added. inferAssetClassFromMarketInfo is the fallback that now
// backs every one of those providers — these tests exercise it directly rather than mocking each
// provider's own network call.

test('inferAssetClassFromMarketInfo recognizes REIT ETFs/companies in both languages', () => {
  assert.equal(
    inferAssetClassFromMarketInfo({ name: 'TIGER 리츠부동산인프라', quoteType: 'ETF' }),
    '리츠',
  );
  assert.equal(
    inferAssetClassFromMarketInfo({ name: 'Vanguard Real Estate Index Fund ETF', quoteType: 'ETF' }),
    '리츠',
  );
  assert.equal(inferAssetClassFromMarketInfo({ name: 'American Tower REIT' }), '리츠');
});

test('inferAssetClassFromMarketInfo recognizes bond funds', () => {
  assert.equal(inferAssetClassFromMarketInfo({ name: 'iShares Core U.S. Aggregate Bond ETF' }), '채권');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'KODEX 국고채3년' }), '채권');
});

test('inferAssetClassFromMarketInfo recognizes gold/commodity products', () => {
  assert.equal(inferAssetClassFromMarketInfo({ name: 'SPDR Gold Shares' }), '금/원자재 ETF');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'ACE KRX금현물' }), '금/원자재 ETF');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'United States Oil Fund' }), '금/원자재 ETF');
});

test('inferAssetClassFromMarketInfo recognizes cash/money-market products', () => {
  assert.equal(inferAssetClassFromMarketInfo({ name: 'iShares 0-3 Month Treasury Bond ETF', sector: 'money market' }), '채권');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'KODEX 머니마켓액티브' }), '금/현금');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'TIGER 파킹통장액티브' }), '금/현금');
});

test('inferAssetClassFromMarketInfo recognizes dividend funds ahead of the generic ETF bucket', () => {
  assert.equal(inferAssetClassFromMarketInfo({ name: 'Schwab U.S. Dividend Equity ETF', quoteType: 'ETF' }), '배당');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'TIGER 미국배당다우존스' }), '배당');
});

test('inferAssetClassFromMarketInfo falls back to 주식 for plain equities and index ETFs', () => {
  assert.equal(inferAssetClassFromMarketInfo({ name: 'Apple Inc.', quoteType: 'EQUITY' }), '주식');
  assert.equal(inferAssetClassFromMarketInfo({ name: 'TIGER 미국S&P500', quoteType: 'ETF' }), '주식');
  assert.equal(inferAssetClassFromMarketInfo({ name: '삼성전자', quoteType: 'EQUITY' }), '주식');
  // A Korean ETF brand name rarely spells out "ETF"/펀드/인덱스 itself, but LOCAL_SECURITY_
  // UNIVERSE's own entries always carry an English rawName that does ("Mirae Asset TIGER US
  // S&P500 ETF") — the actual shape localSecurityToSuggestion passes in, and enough on its own
  // even without quoteType.
  assert.equal(
    inferAssetClassFromMarketInfo({ name: 'TIGER 미국S&P500', rawName: 'Mirae Asset TIGER US S&P500 ETF' }),
    '주식',
  );
});

test('inferAssetClassFromMarketInfo returns empty string when there is truly no signal (name and quoteType both blank)', () => {
  // This is the one real gap: a provider (KIS's own quote response has no name/quoteType at all,
  // see liveQuoteRouter.mjs) with a bare Korean brand name that doesn't spell out any recognizable
  // keyword. Falling back to '' rather than guessing '주식' matches how every other empty-string
  // assetClass in this file already behaves — the caller (App.jsx's manualAssetClass state) already
  // has its own '주식' default for exactly this case, so this isn't a regression, just an honest
  // "no opinion" rather than a false one.
  assert.equal(inferAssetClassFromMarketInfo({}), '');
  assert.equal(inferAssetClassFromMarketInfo(), '');
});
