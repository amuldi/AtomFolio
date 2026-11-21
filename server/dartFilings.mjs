// Korean disclosures from OpenDART (https://opendart.fss.or.kr) for the 유명인 tab: who owns a
// listed company (largest shareholder and related parties, 5%+ blockholders) and what its
// executives and principal shareholders recently bought or sold.
//
// Needs DART_API_KEY; without it lookups throw DartNotConfiguredError and the UI says so.
// DART allows ~20,000 requests a day per key, so results are cached for an hour.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let corpsCache = null;
function corps() {
  // require(), not fs, so Vercel's file tracing ships the JSON with the function.
  corpsCache ??= require('../src/data/dartCorps.json');
  return corpsCache;
}

export class DartNotConfiguredError extends Error {
  constructor() {
    super('DART_API_KEY is not set; Korean disclosures need an OpenDART key.');
    this.code = 'dart-not-configured';
  }
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

async function dartGet(endpoint, params) {
  const key = String(process.env.DART_API_KEY ?? '').trim();
  if (!key) throw new DartNotConfiguredError();
  const query = new URLSearchParams({ crtfc_key: key, ...params });
  const response = await fetch(`https://opendart.fss.or.kr/api/${endpoint}.json?${query}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`DART ${response.status}`);
  const data = await response.json();
  // 013 = "no data", which is an empty list rather than a failure.
  if (data.status === '013') return [];
  if (data.status !== '000') throw new Error(`DART ${data.status}: ${data.message}`);
  return data.list ?? [];
}

const toNumber = (value) => {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
};

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[\s()㈜.,·-]/g, '');

export function searchKoreanCompanies(query, limit = 8) {
  const needle = normalize(query);
  if (needle.length < 1) return [];
  const rows = corps();
  const exact = [];
  const partial = [];
  for (const corp of rows) {
    const name = normalize(corp.n);
    if (name === needle || corp.s === needle) exact.push(corp);
    else if (name.includes(needle) || normalize(corp.e).includes(needle)) partial.push(corp);
    if (exact.length + partial.length > 200) break;
  }
  partial.sort((a, b) => a.n.length - b.n.length);
  return [...exact, ...partial].slice(0, limit).map((corp) => ({ corpCode: corp.c, name: corp.n, stockCode: corp.s }));
}

export function findKoreanCompany(corpCode) {
  const corp = corps().find((candidate) => candidate.c === String(corpCode));
  return corp ? { corpCode: corp.c, name: corp.n, stockCode: corp.s } : null;
}

// Largest shareholder and related parties from the latest annual report, as the share of common
// stock each holds. Weights are the actual stake (they do not sum to 1).
async function fetchOwners(corpCode) {
  const thisYear = new Date().getFullYear();
  for (const year of [thisYear - 1, thisYear - 2]) {
    const rows = await dartGet('hyslrSttus', { corp_code: corpCode, bsns_year: String(year), reprt_code: '11011' });
    if (!rows.length) continue;
    const byName = new Map();
    for (const row of rows) {
      const rate = toNumber(row.trmend_posesn_stock_qota_rt);
      const shares = toNumber(row.trmend_posesn_stock_co);
      // DART appends a subtotal row named "계" per class; it is not an owner.
      if (!row.nm || /^(계|합계|소계)$/.test(row.nm.trim()) || !(rate > 0)) continue;
      const entry = byName.get(row.nm) ?? { name: row.nm, relation: row.relate, shares: 0, rate: 0, sharesBefore: 0, kinds: [] };
      entry.shares += shares ?? 0;
      entry.sharesBefore += toNumber(row.bsis_posesn_stock_co) ?? 0;
      entry.rate += rate;
      entry.kinds.push(row.stock_knd);
      if (/최대주주 본인/.test(row.relate)) entry.relation = row.relate;
      byName.set(row.nm, entry);
    }
    const owners = [...byName.values()].sort((a, b) => b.rate - a.rate);
    return { year, settled: rows[0].stlm_dt, receipt: rows[0].rcept_no, owners };
  }
  return { year: null, settled: null, receipt: null, owners: [] };
}

async function fetchBlockholders(corpCode) {
  const rows = await dartGet('majorstock', { corp_code: corpCode });
  // Newest report per holder.
  const latest = new Map();
  for (const row of rows.sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)))) {
    if (!latest.has(row.repror)) latest.set(row.repror, row);
  }
  return [...latest.values()].slice(0, 12).map((row) => ({
    name: row.repror,
    date: row.rcept_dt,
    shares: toNumber(row.stkqy),
    sharesChange: toNumber(row.stkqy_irds),
    rate: toNumber(row.stkrt),
    rateChange: toNumber(row.stkrt_irds),
    reason: String(row.report_resn ?? '').split('\n')[0].replace(/^-\s*/, ''),
    receipt: row.rcept_no,
  }));
}

async function fetchExecutiveTrades(corpCode) {
  const rows = await dartGet('elestock', { corp_code: corpCode });
  return rows
    .sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)) || b.rcept_no.localeCompare(a.rcept_no))
    .map((row) => ({
      name: row.repror,
      title: row.isu_exctv_ofcps && row.isu_exctv_ofcps !== '-' ? row.isu_exctv_ofcps : row.isu_main_shrholdr !== '-' ? row.isu_main_shrholdr : '',
      registered: row.isu_exctv_rgist_at,
      date: row.rcept_dt,
      shares: toNumber(row.sp_stock_lmp_cnt),
      change: toNumber(row.sp_stock_lmp_irds_cnt),
      rate: toNumber(row.sp_stock_lmp_rate),
      receipt: row.rcept_no,
    }))
    .filter((trade) => trade.change)
    .slice(0, 20);
}

export async function fetchKoreanProfile(corpCode) {
  const corp = findKoreanCompany(corpCode);
  if (!corp) return null;
  return cached(`dart:${corp.corpCode}`, 60 * 60_000, async () => {
    const [owners, blockholders, executives] = await Promise.all([
      fetchOwners(corp.corpCode),
      fetchBlockholders(corp.corpCode).catch((error) => (error instanceof DartNotConfiguredError ? Promise.reject(error) : [])),
      fetchExecutiveTrades(corp.corpCode).catch((error) => (error instanceof DartNotConfiguredError ? Promise.reject(error) : [])),
    ]);
    return { ...corp, fetchedAt: new Date().toISOString(), owners, blockholders, executives };
  });
}
