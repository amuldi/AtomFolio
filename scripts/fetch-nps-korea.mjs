#!/usr/bin/env node
// Korea's National Pension Service (국민연금) domestic holdings, assembled from OpenDART.
//
//   npm run data:nps-kr
//
// DART has no "NPS portfolio" endpoint, but NPS must file a 대량보유상황보고 whenever it holds
// 5%+ of a listed company. This scans every listed company's blockholder reports, keeps NPS's
// newest report per company, and writes the ones still at 5%+ into the bundled snapshot
// (src/data/guruPortfolios.json → funds.nps_kr). Holdings under 5% are not disclosed this way,
// so this is the large-stake part of NPS's Korean book, weighted by stake size.
// Needs DART_API_KEY (environment or .env.local). ~4,000 requests, about 15 minutes.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
if (!process.env.DART_API_KEY) {
  const line = (await readFile(new URL('.env.local', root), 'utf8').catch(() => '')).split('\n').find((l) => l.startsWith('DART_API_KEY='));
  if (line) process.env.DART_API_KEY = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim();
}
if (!process.env.DART_API_KEY) throw new Error('Set DART_API_KEY (https://opendart.fss.or.kr).');

const corps = JSON.parse(await readFile(new URL('src/data/dartCorps.json', root), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => Number(String(v ?? '').replace(/,/g, ''));
const found = [];
let done = 0;
let failed = 0;

async function scan(corp) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://opendart.fss.or.kr/api/majorstock.json?crtfc_key=${process.env.DART_API_KEY}&corp_code=${corp.c}`, { signal: AbortSignal.timeout(20_000) });
      const data = await res.json();
      if (data.status === '020') { await sleep(30_000); continue; } // rate limit: wait it out
      if (data.status !== '000') return;
      const rows = (data.list ?? []).filter((row) => /국민연금/.test(row.repror)).sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)));
      if (rows[0] && num(rows[0].stkrt) >= 5) found.push({ corp, row: rows[0] });
      return;
    } catch {
      await sleep(1500);
    }
  }
  failed += 1;
}

let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < corps.length) {
      const corp = corps[cursor++];
      await scan(corp);
      done += 1;
      if (done % 400 === 0) console.log(`${done}/${corps.length} scanned, ${found.length} NPS stakes`);
      await sleep(120);
    }
  }),
);

found.sort((a, b) => num(b.row.stkrt) - num(a.row.stkrt));
const total = found.reduce((sum, { row }) => sum + num(row.stkrt), 0);
const holdings = found.map(({ corp, row }) => ({
  ticker: corp.s,
  cusip: '',
  name: { ko: corp.n, en: corp.e || corp.n },
  sector: 'other',
  region: 'kr',
  weight: Number((num(row.stkrt) / total).toFixed(5)),
  stakePct: num(row.stkrt),
  stakeShares: num(row.stkqy),
  reported: row.rcept_dt,
}));
const concentration = (() => {
  const w = holdings.map((h) => h.weight);
  return { eff: 1 / w.reduce((s, x) => s + x * x, 0), top1: w[0] ?? 0, top5: w.slice(0, 5).reduce((s, x) => s + x, 0) };
})();
const today = new Date().toISOString().slice(0, 10);
const fund = {
  source: 'DART',
  secName: '국민연금공단 · 국내 주식 (5% 이상 보유)',
  period: today,
  filed: holdings.map((h) => h.reported).sort().at(-1) ?? today,
  accession: 'DART',
  url: 'https://dart.fss.or.kr/',
  totalValueUsd: null,
  holdingsCount: holdings.length,
  effectiveHoldings: Number(concentration.eff.toFixed(2)),
  top1: Number(concentration.top1.toFixed(4)),
  top5: Number(concentration.top5.toFixed(4)),
  holdings: holdings.slice(0, 15),
  allHoldings: holdings,
  previous: null,
  changeCounts: null,
  changes: [],
};
const path = fileURLToPath(new URL('src/data/guruPortfolios.json', root));
const snapshot = JSON.parse(await readFile(path, 'utf8'));
snapshot.funds.nps_kr = fund;
await writeFile(path, `${JSON.stringify(snapshot)}\n`);
console.log(`${holdings.length} NPS stakes of 5%+ (${failed} companies failed). Top: ${holdings.slice(0, 5).map((h) => `${h.name.ko} ${h.stakePct}%`).join(', ')}`);
