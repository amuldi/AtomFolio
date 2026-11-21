#!/usr/bin/env node
// Rebuilds src/data/guruPortfolios.json — the bundled snapshot the 유명인 tab paints instantly
// and falls back to when live SEC lookups are unavailable (no SEC_CONTACT_EMAIL, SEC down).
//
//   npm run data:gurus
//
// Reads every entry in src/data/guruDirectory.json: funds get their latest 13F portfolio plus
// changes against the previous quarter, ETFs their N-PORT holdings, community entries their
// most-mentioned stocks, insiders their recent Form 4 trades. Uses the same code
// as the live API (server/secFilings.mjs). sec.gov requires a declared contact: set
// SEC_CONTACT_EMAIL (read from .env.local when not already in the environment).
//
// Nothing is written unless every entry resolves, so a partial outage never ships half a file.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fetchBuzzPortfolio, fetchEtfPortfolio, fetchFundPortfolio, fetchInsiderTrades } from '../server/secFilings.mjs';

const root = new URL('..', import.meta.url);
const OUT_FILE = fileURLToPath(new URL('src/data/guruPortfolios.json', root));

async function loadContactFromEnvFile() {
  if (process.env.SEC_CONTACT_EMAIL) return;
  try {
    const text = await readFile(new URL('.env.local', root), 'utf8');
    const line = text.split('\n').find((entry) => entry.startsWith('SEC_CONTACT_EMAIL='));
    if (line) process.env.SEC_CONTACT_EMAIL = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim();
  } catch {
    // no .env.local — fetchFundPortfolio will explain what's missing
  }
}

async function main() {
  await loadContactFromEnvFile();
  const directory = JSON.parse(await readFile(new URL('src/data/guruDirectory.json', root), 'utf8'));
  // `--only id1,id2` refreshes just those entries and keeps the rest of the existing snapshot.
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const existing = only ? JSON.parse(await readFile(OUT_FILE, 'utf8').catch(() => '{}')) : {};
  const funds = { ...(existing.funds ?? {}) };
  const insiders = { ...(existing.insiders ?? {}) };
  const unmapped = new Set();

  for (const entry of directory.people) {
    if (only && !only.has(entry.id)) continue;
    if (entry.kind === 'fund' || entry.kind === 'etf' || entry.kind === 'buzz') {
      const fund =
        entry.kind === 'etf'
          ? await fetchEtfPortfolio(entry.symbol)
          : entry.kind === 'buzz'
            ? await fetchBuzzPortfolio(entry.filter)
            : await fetchFundPortfolio(entry.cik);
      if (!fund) throw new Error(`${entry.id}: no portfolio found`);
      funds[entry.id] = fund;
      for (const holding of [...fund.holdings, ...fund.changes]) {
        if (holding.sector === 'other') unmapped.add(`${holding.ticker} (${holding.name.en})`);
      }
      console.log(`${entry.id}: ${fund.source} ${fund.period} (filed ${fund.filed}), ${fund.holdingsCount} positions, ${fund.changes.length} changes`);
    } else {
      const insider = await fetchInsiderTrades(entry.cik);
      if (!insider) throw new Error(`${entry.id}: no Form 4 trades found`);
      insiders[entry.id] = insider;
      console.log(`${entry.id}: Form 4 latest ${insider.latestFiled}, ${insider.trades.length} trade rows`);
    }
  }

  if (unmapped.size) {
    console.warn(
      `\nStill unclassified (shown as 기타/other; add to SECURITY_META in src/lib/guruCompare.js):\n  ${[...unmapped].sort().join('\n  ')}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'SEC EDGAR 13F-HR information tables and Form 4; CUSIP→ticker via OpenFIGI',
    topN: 15,
    funds,
    insiders,
  };
  await writeFile(OUT_FILE, `${JSON.stringify(payload)}\n`);
  console.log(`\nWrote ${Object.keys(funds).length} funds and ${Object.keys(insiders).length} insiders to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
