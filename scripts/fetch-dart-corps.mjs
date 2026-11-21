#!/usr/bin/env node
// Rebuilds src/data/dartCorps.json: every KRX-listed company (name, DART corp code, stock code)
// from OpenDART's corpCode.xml, for name search in the 유명인 tab. Needs DART_API_KEY
// (environment or .env.local) and the `unzip` command. Run `npm run data:dart-corps` a few
// times a year (new listings).
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
if (!process.env.DART_API_KEY) {
  try {
    const line = (await readFile(new URL('.env.local', root), 'utf8')).split('\n').find((l) => l.startsWith('DART_API_KEY='));
    if (line) process.env.DART_API_KEY = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim();
  } catch {
    // no .env.local
  }
}
if (!process.env.DART_API_KEY) throw new Error('Set DART_API_KEY (https://opendart.fss.or.kr).');

const dir = await mkdtemp(join(tmpdir(), 'dart-'));
const response = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${process.env.DART_API_KEY}`);
if (!response.ok) throw new Error(`DART ${response.status}`);
await writeFile(join(dir, 'corp.zip'), Buffer.from(await response.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', join(dir, 'corp.zip'), '-d', dir]);
const xml = await readFile(join(dir, 'CORPCODE.xml'), 'utf8');
const decode = (v) => v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (block, name) => decode(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
const corps = [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)]
  .map(([, block]) => ({ c: tag(block, 'corp_code'), n: tag(block, 'corp_name'), e: tag(block, 'corp_eng_name'), s: tag(block, 'stock_code') }))
  .filter((corp) => /^\d{6}$/.test(corp.s));
await writeFile(fileURLToPath(new URL('src/data/dartCorps.json', root)), `${JSON.stringify(corps)}\n`);
console.log(`${corps.length} listed companies`);
