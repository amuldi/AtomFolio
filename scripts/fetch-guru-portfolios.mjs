#!/usr/bin/env node
// Rebuilds src/data/guruPortfolios.json from the investors' latest SEC 13F-HR filings.
//
//   npm run data:gurus
//
// 13F filings are due 45 days after each quarter end, so run this in mid-February, May, August
// and November. Both sources are free and keyless:
//   - SEC EDGAR (filing index + information-table XML). SEC asks automated clients to identify
//     themselves; set SEC_USER_AGENT (e.g. "AtomFolio data-refresh you@example.com") before
//     running. Without it a generic identifier is sent.
//   - OpenFIGI (CUSIP → ticker), unauthenticated tier: 25 requests/min, 10 ids per request.
//
// Nothing is written unless every investor resolves, so a partial outage never ships half a file.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { SECURITY_META, concentrationOf, normalizeTicker } from '../src/lib/guruCompare.js';

const OUT_FILE = fileURLToPath(new URL('../src/data/guruPortfolios.json', import.meta.url));
const TOP_N = 15;
const USER_AGENT = process.env.SEC_USER_AGENT || 'AtomFolio data-refresh script';

const INVESTORS = [
  { id: 'berkshire', cik: '1067983', person: { ko: '워런 버핏', en: 'Warren Buffett' }, entity: 'Berkshire Hathaway' },
  { id: 'nps', cik: '1608046', person: { ko: '국민연금', en: 'Korea NPS' }, entity: 'National Pension Service' },
  { id: 'appaloosa', cik: '1656456', person: { ko: '데이비드 테퍼', en: 'David Tepper' }, entity: 'Appaloosa LP' },
  { id: 'himalaya', cik: '1709323', person: { ko: '리 루', en: 'Li Lu' }, entity: 'Himalaya Capital' },
  { id: 'duquesne', cik: '1536411', person: { ko: '스탠리 드러켄밀러', en: 'Stanley Druckenmiller' }, entity: 'Duquesne Family Office' },
];

// CUSIPs OpenFIGI's US-exchange lookup misses (foreign-domiciled issuers listed in the US).
const CUSIP_TICKER_FIXES = {
  H1467J104: 'CB',
  G7997R103: 'STX',
  G0896C103: 'TBBB',
  N62509109: 'NAMS',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function secFetch(url, as = 'json') {
  await sleep(150); // SEC's fair-access limit is 10 requests/second
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`SEC ${response.status} for ${url}`);
  }
  return as === 'json' ? response.json() : response.text();
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`));
  return match ? match[1].trim() : null;
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\b(Inc|Corp|Co|Ltd|Plc|Hldgs?|Del|Sa|Nv|Lp)\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchLatestFiling(investor) {
  const submissions = await secFetch(
    `https://data.sec.gov/submissions/CIK${investor.cik.padStart(10, '0')}.json`,
  );
  const recent = submissions.filings.recent;
  const index = recent.form.findIndex((form) => form === '13F-HR');
  if (index < 0) {
    throw new Error(`${investor.id}: no 13F-HR filing found`);
  }
  const accession = recent.accessionNumber[index];
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(investor.cik)}/${accession.replace(/-/g, '')}/`;
  const listing = await secFetch(`${folder}index.json`);
  const xmlNames = listing.directory.item
    .map((item) => item.name)
    .filter((name) => /\.xml$/i.test(name) && !/primary_doc/i.test(name));

  for (const name of xmlNames) {
    const xml = await secFetch(folder + name, 'text');
    const rows = [...xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)].map(
      ([, block]) => ({
        issuer: readTag(block, 'nameOfIssuer'),
        cusip: readTag(block, 'cusip'),
        value: Number(readTag(block, 'value') ?? 0),
        putCall: readTag(block, 'putCall'),
      }),
    );
    if (rows.length) {
      return {
        accession,
        url: folder,
        period: recent.reportDate[index],
        filed: recent.filingDate[index],
        rows,
      };
    }
  }
  throw new Error(`${investor.id}: information table not found in ${folder}`);
}

async function mapCusipsToTickers(cusips) {
  const tickers = {};
  for (let start = 0; start < cusips.length; start += 10) {
    const batch = cusips.slice(start, start + 10);
    const response = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map((cusip) => ({ idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' }))),
    });
    if (!response.ok) {
      throw new Error(`OpenFIGI ${response.status}`);
    }
    const results = await response.json();
    batch.forEach((cusip, i) => {
      tickers[cusip] = results[i]?.data?.[0]?.ticker ?? null;
    });
    await sleep(2600);
  }
  return tickers;
}

async function main() {
  const filings = [];
  for (const investor of INVESTORS) {
    const filing = await fetchLatestFiling(investor);
    // Long positions only — option rows (putCall set) are exposure, not holdings.
    const byIssuer = new Map();
    for (const row of filing.rows) {
      if (row.putCall) continue;
      const key = row.cusip.slice(0, 6); // same issuer, different share classes
      const current = byIssuer.get(key) ?? { issuer: row.issuer, cusip: row.cusip, value: 0 };
      current.value += row.value;
      byIssuer.set(key, current);
    }
    const positions = [...byIssuer.values()].sort((a, b) => b.value - a.value);
    let total = positions.reduce((sum, position) => sum + position.value, 0);
    // Pre-2023 filings report values in thousands; any real 13F filer holds ≥ $100M.
    const unit = total < 1e8 ? 1000 : 1;
    total *= unit;
    filings.push({ investor, filing, positions, total, unit });
    console.log(`${investor.id}: ${filing.period} (filed ${filing.filed}), ${positions.length} positions`);
  }

  const cusips = [...new Set(filings.flatMap(({ positions }) => positions.slice(0, TOP_N).map((p) => p.cusip)))];
  const tickers = await mapCusipsToTickers(cusips.filter((cusip) => !CUSIP_TICKER_FIXES[cusip]));
  const unmapped = new Set();

  const gurus = filings.map(({ investor, filing, positions, total, unit }) => {
    const concentration = concentrationOf(positions.map((position) => position.value));
    return {
      id: investor.id,
      person: investor.person,
      entity: investor.entity,
      cik: investor.cik,
      accession: filing.accession,
      url: filing.url,
      period: filing.period,
      filed: filing.filed,
      totalValueUsd: Math.round(total),
      holdingsCount: concentration.holdings,
      effectiveHoldings: Number(concentration.effectiveHoldings.toFixed(2)),
      top1: Number(concentration.top1.toFixed(4)),
      top5: Number(concentration.top5.toFixed(4)),
      holdings: positions.slice(0, TOP_N).map((position) => {
        const ticker = normalizeTicker(CUSIP_TICKER_FIXES[position.cusip] ?? tickers[position.cusip] ?? '');
        const meta = SECURITY_META[ticker];
        if (!meta) unmapped.add(`${ticker || '?'} (${position.cusip} ${position.issuer})`);
        return {
          ticker,
          cusip: position.cusip,
          name: { ko: meta?.[0] ?? titleCase(position.issuer), en: meta?.[1] ?? titleCase(position.issuer) },
          sector: meta?.[2] ?? 'other',
          region: meta?.[3] ?? 'other',
          weight: Number(((position.value * unit) / total).toFixed(5)),
        };
      }),
    };
  });

  if (unmapped.size) {
    console.warn(
      `\nAdd these to SECURITY_META in src/lib/guruCompare.js (currently filed as 기타/other):\n  ${[...unmapped].join('\n  ')}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'SEC EDGAR 13F-HR information tables; CUSIP→ticker via OpenFIGI',
    topN: TOP_N,
    gurus,
  };
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${gurus.length} investors to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
