import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  REGION_LABELS,
  SECTOR_LABELS,
  buildGuruInsights,
  buildUserHoldings,
  compareWithGuru,
  concentrationOf,
  daysSince,
  normalizeTicker,
  resolveUserRegion,
  resolveUserSector,
  searchGuruDirectory,
} from '../src/lib/guruCompare.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const snapshot = readJson('../src/data/guruPortfolios.json');
const directory = readJson('../src/data/guruDirectory.json');
const photos = readJson('../src/data/guruPhotos.json');

const guru = {
  id: 'test',
  person: { ko: '워런 버핏', en: 'Warren Buffett' },
  effectiveHoldings: 7.8,
  holdings: [
    { ticker: 'AAPL', name: { ko: '애플', en: 'Apple' }, sector: 'tech', region: 'us', weight: 0.25 },
    { ticker: 'AXP', name: { ko: '아메리칸 익스프레스', en: 'American Express' }, sector: 'financials', region: 'us', weight: 0.15 },
    { ticker: 'KO', name: { ko: '코카콜라', en: 'Coca-Cola' }, sector: 'staples', region: 'us', weight: 0.1 },
  ],
};

test('normalizes broker ticker spellings onto one key', () => {
  assert.equal(normalizeTicker(' goog '), 'GOOGL');
  assert.equal(normalizeTicker('BRK-B'), 'BRK.B');
  assert.equal(normalizeTicker('BRK/B'), 'BRK.B');
  assert.equal(normalizeTicker('005930.KS'), '005930');
  assert.equal(normalizeTicker(null), '');
});

test('user holdings merge share classes and re-normalize weights', () => {
  const holdings = buildUserHoldings([
    { code: 'GOOG', label: 'Alphabet C', weight: 0.2, returnRate: 10 },
    { code: 'GOOGL', label: 'Alphabet A', weight: 0.2, returnRate: 12 },
    { code: 'AAPL', label: 'Apple', weight: 0.4, returnRate: 5 },
    { code: 'ZERO', label: 'No value', weight: 0 },
  ]);
  assert.deepEqual(
    holdings.map((holding) => [holding.ticker, Number(holding.weight.toFixed(3))]),
    [
      ['GOOGL', 0.5],
      ['AAPL', 0.5],
    ],
  );
});

test("maps the app's own sector and region labels onto the comparison vocabulary", () => {
  assert.equal(resolveUserSector({ code: 'XYZ123', sector: '반도체' }), 'tech');
  assert.equal(resolveUserSector({ code: 'ABC', sector: '인터넷 플랫폼' }), 'comm');
  assert.equal(resolveUserSector({ code: 'ABC', sector: '배당 ETF', assetClass: '주식 ETF' }), 'etf');
  assert.equal(resolveUserSector({ code: 'ABC', sector: '미분류', assetClass: '주식 ETF' }), 'etf');
  assert.equal(resolveUserSector({ code: 'KO', sector: '기타' }), 'staples'); // ticker table wins
  assert.equal(resolveUserRegion({ code: '123450', region: '미분류' }), 'kr');
  assert.equal(resolveUserRegion({ code: 'ABC', region: '홍콩' }), 'cn');
});

test('common share is the sum of the smaller weight on each shared holding', () => {
  const user = buildUserHoldings([
    { code: 'AAPL', label: 'Apple', weight: 0.1 },
    { code: 'KO', label: 'Coca-Cola', weight: 0.3 },
    { code: 'NVDA', label: 'NVIDIA', weight: 0.6 },
  ]);
  const result = compareWithGuru(user, guru);
  // min(0.1, 0.25) + min(0.3, 0.1)
  assert.equal(Number(result.commonShare.toFixed(6)), 0.2);
  assert.deepEqual(result.shared.map((holding) => holding.ticker), ['KO', 'AAPL']);
  assert.deepEqual(result.userOnly.map((holding) => holding.ticker), ['NVDA']);
  assert.deepEqual(result.guruOnly.map((holding) => holding.ticker), ['AXP']);
});

test('weight outside the bundled top holdings is its own bucket, not a sector', () => {
  const result = compareWithGuru(buildUserHoldings([{ code: 'AAPL', weight: 1 }]), guru);
  const rest = result.sectors.at(-1);
  assert.equal(rest.key, 'rest');
  assert.equal(Number(rest.guru.toFixed(6)), 0.5);
  assert.equal(Number(result.guruRegions.rest.toFixed(6)), 0.5);
});

test('insights describe differences and flag Korea-heavy portfolios, without advice', () => {
  const korean = buildUserHoldings([
    { code: '005930', label: '삼성전자', weight: 0.7 },
    { code: '105560', label: 'KB금융', weight: 0.3 },
  ]);
  const lines = buildGuruInsights(compareWithGuru(korean, guru), guru, 'ko');
  assert.match(lines[0], /공통 종목이 없습니다/);
  assert.ok(lines.some((line) => /한국 주식이 100\.0%/.test(line)));
  assert.ok(lines.some((line) => /워런 버핏은/.test(line)));
  assert.ok(lines.every((line) => !/(매수|매도|사세요|파세요)/.test(line)));
  const english = buildGuruInsights(compareWithGuru(korean, guru), guru, 'en');
  assert.match(english[0], /none of Warren Buffett's top 3/);
});

test('concentration and date helpers', () => {
  const concentration = concentrationOf([1, 1, 2]);
  assert.equal(concentration.holdings, 3);
  assert.equal(Number(concentration.effectiveHoldings.toFixed(3)), 2.667);
  assert.equal(concentration.top1, 0.5);
  assert.equal(daysSince('2026-09-30', new Date('2026-11-20T12:00:00Z')), 51);
  assert.equal(daysSince('not a date'), null);
});

test('bundled snapshot covers the whole directory and is well formed', () => {
  for (const entry of directory.people) {
    if (entry.kind === 'fund' || entry.kind === 'insider') assert.match(entry.cik, /^\d+$/, entry.id);
    if (entry.kind === 'etf') assert.match(entry.symbol, /^[A-Z]{2,6}$/, entry.id);
    if (entry.kind === 'buzz') assert.ok(entry.filter, entry.id);
    assert.ok(entry.person.ko && entry.person.en, entry.id);
    assert.ok(['investor', 'community', 'institution', 'executive'].includes(entry.category), entry.id);
    if (entry.kind !== 'insider') {
      const fund = snapshot.funds[entry.id];
      assert.ok(fund, `${entry.id} missing from snapshot.funds`);
      assert.match(fund.period, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(fund.holdings.length > 0 && fund.holdings.length <= snapshot.topN, entry.id);
      const total = fund.holdings.reduce((sum, holding) => sum + holding.weight, 0);
      assert.ok(total > 0 && total <= 1.0001, `${entry.id} weights sum to ${total}`);
      for (const holding of [...fund.holdings, ...fund.changes]) {
        assert.ok(holding.ticker, `${entry.id} has a holding without a ticker`);
        assert.ok(SECTOR_LABELS[holding.sector], `${entry.id} ${holding.ticker}: sector ${holding.sector}`);
        assert.ok(REGION_LABELS[holding.region], `${entry.id} ${holding.ticker}: region ${holding.region}`);
      }
    } else {
      const insider = snapshot.insiders[entry.id];
      assert.ok(insider?.trades?.length, `${entry.id} missing Form 4 trades`);
    }
  }
});

test('every avatar is a free-licensed photo or the organisation logo, with a credit and a file', () => {
  for (const [id, image] of Object.entries(photos)) {
    assert.ok(directory.people.some((entry) => entry.id === id), `${id} not in directory`);
    assert.ok(['photo', 'logo'].includes(image.kind), id);
    if (image.kind === 'photo') {
      assert.match(image.license, /^(cc[ -]?by|cc0|public domain|pd|ogl)/i, id);
    }
    assert.ok(image.author && image.sourceUrl, id);
    assert.ok(existsSync(new URL(`../public${image.src}`, import.meta.url)), `${id}: ${image.src} missing`);
  }
  // Almost everyone has a face or a logo; the few without a free photo or a usable logo
  // (Druckenmiller, Li Lu, Tom Russo, Michael Burry) get a monogram.
  const missing = directory.people.filter((entry) => !photos[entry.id]);
  assert.ok(missing.length <= 5, `missing avatars: ${missing.map((entry) => entry.id).join(', ')}`);
});

test('directory search matches names in either language, funds, and holdings', () => {
  const ids = (query) => searchGuruDirectory(directory.people, snapshot, query).map(({ entry }) => entry.id);
  assert.equal(ids('').length, directory.people.length);
  assert.deepEqual(ids('버핏'), ['berkshire']);
  assert.deepEqual(ids('buffett'), ['berkshire']);
  assert.deepEqual(ids('Bridgewater'), ['bridgewater']);
  // "애플" is nobody's name: it finds who holds Apple, biggest position first.
  const apple = searchGuruDirectory(directory.people, snapshot, '애플');
  assert.ok(apple.length > 1);
  assert.equal(apple[0].entry.id, 'berkshire');
  assert.equal(apple[0].holding.ticker, 'AAPL');
  // Form 4 issuers count too.
  assert.ok(ids('NVDA').includes('huang'));
  // Aliases: nobody is named "펠로시", but the congressional-trades ETF answers to it.
  assert.equal(ids('펠로시')[0], 'nanc');
});
