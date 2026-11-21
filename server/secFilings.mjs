// Live SEC EDGAR lookups for the 유명인 tab: entity search, a fund's latest 13F portfolio with
// quarter-over-quarter buys/sells, and a person's (or 10% owner's) recent Form 4 trades.
//
// Nothing here is "real time" in the market sense — these are the fastest *public* records:
//   13F-HR  quarter-end holdings, due 45 days after the quarter
//   Form 4  insider buys/sells, due 2 business days after the trade
// What is live is the lookup: each request reads EDGAR (behind a short cache), so a filing shows
// up here as soon as SEC publishes it.
//
// sec.gov rejects automated requests that don't declare a contact, so lookups need
// SEC_CONTACT_EMAIL; without it they throw SecNotConfiguredError and the UI falls back to the
// bundled snapshot (src/data/guruPortfolios.json).
import { createRequire } from 'node:module';
import { SECURITY_META, concentrationOf, normalizeTicker } from '../src/lib/guruCompare.js';

const require = createRequire(import.meta.url);

const SEC_MIN_INTERVAL_MS = 125; // SEC fair access: at most 10 requests per second
const TOP_N = 15;

export class SecNotConfiguredError extends Error {
  constructor() {
    super('SEC_CONTACT_EMAIL is not set; sec.gov requires a declared contact for automated lookups.');
    this.code = 'sec-not-configured';
  }
}

export function secUserAgent() {
  const contact = String(process.env.SEC_CONTACT_EMAIL ?? '').trim();
  return contact ? `AtomFolio ${contact}` : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;
let queue = Promise.resolve();
function throttle() {
  queue = queue.then(async () => {
    const wait = lastRequestAt + SEC_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  return queue;
}

async function secGet(url, as = 'json') {
  const userAgent = secUserAgent();
  if (!userAgent) throw new SecNotConfiguredError();
  await throttle();
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json, text/xml, */*' } });
  const text = await response.text();
  if (!response.ok || /Undeclared Automated Tool/i.test(text)) {
    throw new Error(`SEC request failed (${response.status}) for ${url}`);
  }
  return as === 'json' ? JSON.parse(text) : text;
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

const padCik = (cik) => String(Number(cik)).padStart(10, '0');
const archiveFolder = (cik, accession) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/`;

export function normalizeCik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits && digits.length <= 10 && Number(digits) > 0 ? String(Number(digits)) : null;
}

// ── entity search ─────────────────────────────────────────────────────────────────────────────
export async function searchSecEntities(query) {
  const text = String(query ?? '').trim().slice(0, 80);
  if (text.length < 2) return [];
  return cached(`search:${text.toLowerCase()}`, 10 * 60_000, async () => {
    const data = await secGet(`https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(text)}`);
    return (data?.hits?.hits ?? []).slice(0, 12).map((hit) => ({
      cik: normalizeCik(hit._id),
      name: String(hit._source?.entity ?? '').trim(),
      tickers: String(hit._source?.tickers ?? '').trim(),
    }));
  });
}

async function fetchSubmissions(cik) {
  return cached(`subs:${cik}`, 5 * 60_000, () => secGet(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`));
}

function recentFilings(submissions, forms) {
  const recent = submissions?.filings?.recent ?? {};
  const list = [];
  (recent.form ?? []).forEach((form, index) => {
    if (forms.includes(form)) {
      list.push({
        form,
        accession: recent.accessionNumber[index],
        filed: recent.filingDate[index],
        period: recent.reportDate[index],
        primaryDocument: recent.primaryDocument[index],
      });
    }
  });
  return list;
}

// ── XML helpers (EDGAR XML is flat and predictable enough for targeted regexes) ──────────────
function blocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))].map((m) => m[1]);
}
function decode(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
// <tag>text</tag> or <tag><value>text</value></tag>
function readTag(block, tag) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  if (!match) return null;
  const inner = match[1].match(/<(?:\w+:)?value>([\s\S]*?)<\/(?:\w+:)?value>/);
  return decode(inner ? inner[1] : match[1].replace(/<[^>]+>/g, ''));
}
const toNumber = (value) => {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
};

export function parseInfoTable(xml) {
  return blocks(xml, 'infoTable').map((block) => ({
    issuer: readTag(block, 'nameOfIssuer'),
    cusip: (readTag(block, 'cusip') ?? '').toUpperCase(),
    titleOfClass: readTag(block, 'titleOfClass'),
    value: toNumber(readTag(block, 'value')) ?? 0,
    shares: toNumber(readTag(block, 'sshPrnamt')) ?? 0,
    shareType: readTag(block, 'sshPrnamtType'),
    putCall: readTag(block, 'putCall'),
  }));
}

// Long equity positions only, merged per issuer (first 6 CUSIP characters = issuer). Options are
// exposure rather than holdings, and PRN rows are bond principal amounts (convertible notes).
export function aggregateHoldings(rows) {
  const byIssuer = new Map();
  for (const row of rows) {
    if (row.putCall || String(row.shareType).toUpperCase() === 'PRN' || !row.cusip) continue;
    const key = row.cusip.slice(0, 6);
    const current = byIssuer.get(key) ?? { key, issuer: row.issuer, cusip: row.cusip, value: 0, shares: 0 };
    current.value += row.value;
    current.shares += row.shares;
    byIssuer.set(key, current);
  }
  return [...byIssuer.values()].sort((a, b) => b.value - a.value);
}

async function fetchInfoTable(cik, accession) {
  // Filings never change once accepted, so these can be kept for a day.
  return cached(`13f:${accession}`, 24 * 3_600_000, async () => {
    const folder = archiveFolder(cik, accession);
    const listing = await secGet(`${folder}index.json`);
    const names = (listing?.directory?.item ?? [])
      .map((item) => item.name)
      .filter((name) => /\.xml$/i.test(name) && !/primary_doc/i.test(name));
    for (const name of names) {
      const rows = parseInfoTable(await secGet(folder + name, 'text'));
      if (rows.length) return { folder, rows };
    }
    throw new Error(`No 13F information table in ${folder}`);
  });
}

// ── CUSIP → ticker (OpenFIGI, free tier: 25 requests/min, 10 ids/request) ─────────────────────
const tickerCache = new Map();
// Seed from the bundled snapshot so the curated funds never wait on OpenFIGI's rate limit.
// (require(), not fs, so Vercel's file tracing ships the JSON with the function.)
try {
  const snapshot = require('../src/data/guruPortfolios.json');
  for (const fund of Object.values(snapshot.funds ?? {})) {
    for (const holding of [...(fund.holdings ?? []), ...(fund.changes ?? [])]) {
      if (holding.cusip && holding.ticker && !holding.ticker.startsWith('CUSIP:')) {
        tickerCache.set(holding.cusip.toUpperCase(), holding.ticker);
      }
    }
  }
} catch {
  // first run of the snapshot script: nothing to seed yet
}
// CUSIPs OpenFIGI's lookup misses or answers inconsistently (mostly foreign-domiciled issuers
// listed in the US, plus share classes written with a slash).
const CUSIP_TICKER_FIXES = {
  H1467J104: 'CB', G7997R103: 'STX', G0896C103: 'TBBB', N62509109: 'NAMS', G0403H108: 'AON',
  G25508105: 'CRH', Y2573F102: 'FLEX', H8817H100: 'RIG', '30231G102': 'XOM', '285512109': 'EA',
  '934423104': 'WBD', '682680103': 'OKE', '947890109': 'WBS', '86800U500': 'SMCI', '881624209': 'TEVA',
  M8769Q102: 'TEVA', '084670108': 'BRK.B', '084670702': 'BRK.B', '115637100': 'BF.B', '115637209': 'BF.B',
  '16115Q308': 'GTLS', '053484101': 'AVB', '039653100': 'ACA', G0750C108: 'AXTA', G4412G101: 'HLF',
  G54950103: 'LIN', G61188127: 'LBTYK', G66721104: 'NCLH', H17182108: 'CRSP', N97284108: 'NBIS',
};

// Unauthenticated OpenFIGI allows 25 requests a minute; going faster returns 429s that would
// silently leave holdings unmapped.
const FIGI_MIN_INTERVAL_MS = 2500;
let lastFigiAt = 0;
let figiQueue = Promise.resolve();
function figiThrottle() {
  figiQueue = figiQueue.then(async () => {
    const wait = lastFigiAt + FIGI_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFigiAt = Date.now();
  });
  return figiQueue;
}

async function figiBatch(cusips, withExchange, attempt = 0) {
  await figiThrottle();
  const response = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      cusips.map((cusip) => (withExchange ? { idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' } : { idType: 'ID_CUSIP', idValue: cusip })),
    ),
  });
  if (response.status === 429 && attempt < 2) {
    await sleep(15_000);
    return figiBatch(cusips, withExchange, attempt + 1);
  }
  if (!response.ok) throw new Error(`OpenFIGI ${response.status}`);
  return response.json();
}

// Plain listed-equity symbols only: rejects bond descriptions ("SMCI 7 06/01/29"), foreign-venue
// variants (EXMOC, TEVAN) and odd suffixes (EA*).
const isListedSymbol = (entry) =>
  entry?.marketSector === 'Equity' && /^[A-Z]{1,5}([./][A-Z])?$/.test(String(entry?.ticker ?? ''));

async function mapCusipsToTickers(cusips) {
  const wanted = [...new Set(cusips.map((cusip) => cusip.toUpperCase()))].filter((cusip) => !tickerCache.has(cusip));
  for (const cusip of wanted) {
    if (CUSIP_TICKER_FIXES[cusip]) tickerCache.set(cusip, CUSIP_TICKER_FIXES[cusip]);
  }
  let pending = wanted.filter((cusip) => !tickerCache.has(cusip));
  for (const withExchange of [true, false]) {
    const misses = [];
    for (let start = 0; start < pending.length; start += 10) {
      const batch = pending.slice(start, start + 10);
      try {
        const results = await figiBatch(batch, withExchange);
        batch.forEach((cusip, index) => {
          const data = (results[index]?.data ?? []).filter(isListedSymbol);
          // Second pass (no exchange filter) only trusts a US venue; anything else stays unmapped
          // and is shown by name instead of under a wrong symbol.
          const pick = withExchange
            ? data[0]
            : data.find((entry) => /^(US|UN|UW|UQ|UR|UA|UP|UV)$/.test(entry.exchCode ?? ''));
          if (pick?.ticker) tickerCache.set(cusip, pick.ticker);
          else misses.push(cusip);
        });
      } catch {
        misses.push(...batch);
      }
    }
    pending = misses;
  }
  return Object.fromEntries(cusips.map((cusip) => [cusip, tickerCache.get(cusip.toUpperCase()) ?? null]));
}

function titleCase(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\b(Inc|Corp|Co|Ltd|Plc|Hldgs?|Del|Sa|Nv|Lp|New|Cl [AB])\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function describeHolding(position, ticker) {
  const symbol = normalizeTicker(ticker ?? '');
  const meta = SECURITY_META[symbol];
  return {
    ticker: symbol || `CUSIP:${position.cusip}`,
    cusip: position.cusip,
    name: { ko: meta?.[0] ?? titleCase(position.issuer), en: meta?.[1] ?? titleCase(position.issuer) },
    sector: meta?.[2] ?? 'other',
    region: meta?.[3] ?? 'other',
  };
}

// ── 13F portfolio + quarter-over-quarter changes ──────────────────────────────────────────────
export function diffQuarters(current, previous) {
  const before = new Map(previous.map((position) => [position.key, position]));
  const after = new Map(current.map((position) => [position.key, position]));
  const currentTotal = current.reduce((sum, position) => sum + position.value, 0) || 1;
  const previousTotal = previous.reduce((sum, position) => sum + position.value, 0) || 1;
  const changes = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const now = after.get(key);
    const then = before.get(key);
    const sharesBefore = then?.shares ?? 0;
    const sharesAfter = now?.shares ?? 0;
    let kind = null;
    if (!then && now) kind = 'new';
    else if (then && !now) kind = 'soldOut';
    else if (sharesAfter > sharesBefore * 1.02) kind = 'added';
    else if (sharesAfter < sharesBefore * 0.98) kind = 'trimmed';
    if (!kind) continue;
    const price = now?.shares ? now.value / now.shares : then?.shares ? then.value / then.shares : 0;
    changes.push({
      key,
      cusip: (now ?? then).cusip,
      issuer: (now ?? then).issuer,
      kind,
      sharesBefore,
      sharesAfter,
      weightBefore: (then?.value ?? 0) / previousTotal,
      weightAfter: (now?.value ?? 0) / currentTotal,
      // Approximate dollar size of the trade at the quarter-end price.
      tradeValue: Math.abs(sharesAfter - sharesBefore) * price,
    });
  }
  return changes.sort((a, b) => b.tradeValue - a.tradeValue);
}

// ── Sector / region for tickers SECURITY_META doesn't know ────────────────────────────────────
// The issuer's own SEC record carries an SIC industry code and its business address, which is
// enough to place any US-listed holding on the comparison's broad sector/region scale.
// ETF trusts carry no operating-company SIC code, so their names are the signal.
export const ETF_NAME = /\b(etfs?|trust|tr|fund|ishares|spdr|vanguard|invesco|index|proshares|roundhill|wisdomtree|direxion|vaneck|global x|select sector)\b/i;

export function sectorFromSic(sic, name = '') {
  const code = Number(sic);
  if (ETF_NAME.test(name) && (!code || code === 6726 || code === 6221)) return 'etf';
  if (!Number.isFinite(code) || code <= 0) return 'other';
  if (code === 6798 || (code >= 6500 && code <= 6599)) return 'realestate';
  if (code >= 6000 && code <= 6799) return 'financials';
  if ((code >= 1300 && code <= 1399) || (code >= 2900 && code <= 2999)) return 'energy';
  if ((code >= 1000 && code <= 1299) || (code >= 1400 && code <= 1499)) return 'materials';
  if (code >= 1500 && code <= 1799) return 'industrials';
  if (code >= 2000 && code <= 2199) return 'staples';
  if (code >= 2830 && code <= 2836) return 'health';
  if (code >= 2840 && code <= 2844) return 'staples';
  if ((code >= 2800 && code <= 2899) || (code >= 2400 && code <= 2499) || (code >= 2600 && code <= 2699) || (code >= 3000 && code <= 3099) || (code >= 3200 && code <= 3399)) return 'materials';
  if (code >= 2700 && code <= 2799) return 'comm';
  if ((code >= 2200 && code <= 2399) || (code >= 2500 && code <= 2599) || (code >= 3100 && code <= 3199) || code === 3630 || code === 3711 || code === 3714 || code === 3716 || code === 3751 || (code >= 3900 && code <= 3999)) return 'discretionary';
  if ((code >= 3570 && code <= 3579) || (code >= 3660 && code <= 3699) || (code >= 3820 && code <= 3829)) return 'tech';
  if (code >= 3840 && code <= 3851) return 'health';
  if (code >= 3400 && code <= 3899) return 'industrials';
  if (code >= 4000 && code <= 4799) return 'industrials';
  if (code >= 4800 && code <= 4899) return 'comm';
  if (code === 4955) return 'industrials';
  if (code >= 4900 && code <= 4999) return 'utilities';
  if (code === 5122) return 'health';
  if ((code >= 5140 && code <= 5149) || code === 5331 || code === 5411 || code === 5912) return 'staples';
  if (code >= 5000 && code <= 5199) return 'industrials';
  if (code >= 5200 && code <= 5999) return 'discretionary';
  if (code >= 7370 && code <= 7379) return 'tech';
  if (code === 7310 || code === 7311 || (code >= 7800 && code <= 7899)) return 'comm';
  if (code >= 8000 && code <= 8099) return 'health';
  if (code === 8731) return 'health';
  if (code >= 7000 && code <= 7999) return 'discretionary';
  if (code >= 8700 && code <= 8799) return 'industrials';
  return 'other';
}

const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));
export function regionFromAddress(code, description = '') {
  const text = String(description ?? '').toUpperCase();
  if (US_STATES.has(String(code ?? '').toUpperCase())) return 'us';
  if (/KOREA/.test(text)) return 'kr';
  if (/CHINA|HONG KONG/.test(text)) return 'cn';
  if (/TAIWAN/.test(text)) return 'tw';
  return code ? 'other' : 'us';
}

// Company names as SEC and 13F filers write them differ in punctuation and legal suffixes
// ("JOHNSON CONTROLS INTERNATION" vs "Johnson Controls International plc").
const LEGAL_SUFFIX = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|N ?V|S ?A|AG|SE|LP|L ?P|LLC|HLDGS?|HOLDINGS?|GROUP|THE|DEL|NEW|CL [A-C]|CLASS [A-C]|ADR|SPONSORED|SPON)\b/g;
export function normalizeCompanyName(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTickerDirectory() {
  return cached('company-tickers', 24 * 3_600_000, async () => {
    const data = await secGet('https://www.sec.gov/files/company_tickers.json');
    const byTicker = new Map();
    const byName = new Map();
    for (const row of Object.values(data ?? {})) {
      const ticker = String(row.ticker).toUpperCase().replace(/-/g, '.');
      byTicker.set(ticker, String(row.cik_str));
      const name = normalizeCompanyName(row.title);
      // The file lists the primary listing first; keep it.
      if (name && !byName.has(name)) byName.set(name, ticker);
    }
    return { byTicker, byName };
  });
}

// Last resort for CUSIPs OpenFIGI can't map (mostly foreign-incorporated issuers listed in the
// US): match the 13F issuer name against SEC's own ticker list. 13F names are often cut at 28
// characters, so a long enough prefix of a listed company's name also counts.
async function tickersFromNames(positions) {
  const directory = await fetchTickerDirectory().catch(() => null);
  if (!directory) return {};
  const names = [...directory.byName.keys()];
  const found = {};
  for (const position of positions) {
    const name = normalizeCompanyName(position.issuer);
    if (!name) continue;
    let ticker = directory.byName.get(name);
    if (!ticker && name.length >= 10) {
      const candidates = names.filter((candidate) => candidate.startsWith(name) || name.startsWith(candidate));
      candidates.sort((a, b) => Math.abs(a.length - name.length) - Math.abs(b.length - name.length));
      ticker = candidates[0] ? directory.byName.get(candidates[0]) : undefined;
    }
    if (ticker) found[position.cusip] = ticker;
  }
  return found;
}

async function classifyTickers(tickers) {
  const result = {};
  const unknown = [...new Set(tickers)].filter((ticker) => ticker && !ticker.startsWith('CUSIP:') && !SECURITY_META[ticker]);
  if (!unknown.length) return result;
  const directory = await fetchTickerDirectory().catch(() => null);
  for (const ticker of unknown) {
    const issuerCik = directory?.byTicker.get(ticker);
    if (!issuerCik) continue;
    try {
      const subs = await cached(`subs:${issuerCik}`, 24 * 3_600_000, () =>
        secGet(`https://data.sec.gov/submissions/CIK${padCik(issuerCik)}.json`),
      );
      const address = subs?.addresses?.business ?? {};
      result[ticker] = {
        sector: sectorFromSic(subs?.sic, subs?.name),
        region: regionFromAddress(address.stateOrCountry, address.stateOrCountryDescription),
      };
    } catch {
      // unclassified stays 기타
    }
  }
  return result;
}

// Shared by 13F funds and N-PORT ETFs: top holdings with tickers/sectors, quarter-over-quarter
// changes, concentration. `current`/`previous` are aggregateHoldings()-shaped positions.
async function buildPortfolio({ current, previous, meta, prior, unit = 1, regionByCusip = {}, topN, maxChanges }) {
  const total = current.reduce((sum, position) => sum + position.value, 0) * unit;
  const changes = prior ? diffQuarters(current, previous) : [];
  const shownChanges = changes.slice(0, maxChanges);
  const top = current.slice(0, topN);
  const tickers = await mapCusipsToTickers([...top, ...shownChanges].map((entry) => entry.cusip).filter((cusip) => /^[0-9A-Z]{9}$/.test(cusip)));
  const unmapped = [...top, ...shownChanges].filter((entry) => !tickers[entry.cusip]);
  if (unmapped.length) Object.assign(tickers, await tickersFromNames(unmapped));
  const classes = await classifyTickers(Object.values(tickers).filter(Boolean).map((ticker) => normalizeTicker(ticker)));
  const describe = (position) => {
    let described = describeHolding(position, tickers[position.cusip]);
    const known = classes[described.ticker];
    if (known && described.sector === 'other') described = { ...described, ...known };
    else if (described.sector === 'other' && ETF_NAME.test(position.issuer)) described = { ...described, sector: 'etf', region: 'us' };
    const region = regionByCusip[position.cusip];
    return region && described.region === 'other' ? { ...described, region } : described;
  };
  const concentration = concentrationOf(current.map((position) => position.value));
  const countBy = (kind) => changes.filter((change) => change.kind === kind).length;
  return {
    ...meta,
    totalValueUsd: Math.round(total),
    holdingsCount: concentration.holdings,
    effectiveHoldings: Number(concentration.effectiveHoldings.toFixed(2)),
    top1: Number(concentration.top1.toFixed(4)),
    top5: Number(concentration.top5.toFixed(4)),
    holdings: top.map((position) => ({
      ...describe(position),
      weight: Number(((position.value * unit) / total).toFixed(5)),
    })),
    previous: prior,
    changeCounts: prior
      ? { new: countBy('new'), added: countBy('added'), trimmed: countBy('trimmed'), soldOut: countBy('soldOut') }
      : null,
    changes: shownChanges.map((change) => ({
      ...describe(change),
      kind: change.kind,
      sharesBefore: change.sharesBefore,
      sharesAfter: change.sharesAfter,
      weightBefore: Number(change.weightBefore.toFixed(5)),
      weightAfter: Number(change.weightAfter.toFixed(5)),
      tradeValueUsd: Math.round(change.tradeValue * unit),
    })),
  };
}

export async function fetchFundPortfolio(cik, { topN = TOP_N, maxChanges = 12 } = {}) {
  // The filing list is re-read every 5 minutes (fetchSubmissions), so a new 13F is picked up
  // within minutes of SEC publishing it. The parsed portfolio is keyed by the newest accession:
  // it is only rebuilt when that number changes, which is why it can be kept for a day.
  const submissions = await fetchSubmissions(cik);
  const filings = recentFilings(submissions, ['13F-HR']);
  if (!filings.length) return null;
  return cached(`fund:${cik}:${filings[0].accession}:${topN}:${maxChanges}`, 24 * 60 * 60_000, async () => {
    // Some filers send an empty placeholder table (one "NA" row) for a quarter; use the newest
    // filing that actually lists holdings, and compare it with the next one back.
    const loaded = [];
    for (const filing of filings.slice(0, 4)) {
      const table = await fetchInfoTable(cik, filing.accession).catch(() => null);
      const holdings = table ? aggregateHoldings(table.rows).filter((position) => position.value > 0) : [];
      if (holdings.length) loaded.push({ filing, folder: table.folder, holdings });
      if (loaded.length === 2) break;
    }
    if (!loaded.length) return null;
    const [{ filing: latest, folder, holdings: current }, priorEntry] = loaded;
    const rawTotal = current.reduce((sum, position) => sum + position.value, 0);
    return buildPortfolio({
      current,
      previous: priorEntry?.holdings ?? [],
      prior: priorEntry
        ? { period: priorEntry.filing.period, filed: priorEntry.filing.filed, accession: priorEntry.filing.accession }
        : null,
      // Pre-2023 filings report values in thousands; any real 13F filer holds at least $100M.
      unit: rawTotal < 1e8 ? 1000 : 1,
      meta: {
        source: '13F',
        cik: String(cik),
        secName: submissions.name,
        accession: latest.accession,
        url: folder,
        period: latest.period,
        filed: latest.filed,
      },
      topN,
      maxChanges,
    });
  });
}

// ── ETFs (N-PORT) ─────────────────────────────────────────────────────────────────────────────
// Funds report their full holdings to SEC quarterly on Form N-PORT (public ~60 days after the
// quarter). Used for funds that track communities: NANC copies congressional Democrats' trades,
// BUZZ and MEME hold the most-discussed stocks.
const COUNTRY_REGION = { US: 'us', KR: 'kr', CN: 'cn', HK: 'cn', TW: 'tw' };

async function fetchFundTickerMap() {
  return cached('mf-tickers', 24 * 3_600_000, async () => {
    const data = await secGet('https://www.sec.gov/files/company_tickers_mf.json');
    const index = Object.fromEntries(data.fields.map((field, i) => [field, i]));
    return new Map(
      data.data.map((row) => [String(row[index.symbol]).toUpperCase(), { cik: String(row[index.cik]), seriesId: row[index.seriesId] }]),
    );
  });
}

export function parseNport(xml) {
  return {
    seriesName: readTag(xml, 'seriesName'),
    period: readTag(xml, 'repPdDate'),
    positions: blocks(xml, 'invstOrSec').map((block) => ({
      issuer: readTag(block, 'name') || readTag(block, 'title'),
      cusip: String(readTag(block, 'cusip') ?? '').toUpperCase(),
      value: toNumber(readTag(block, 'valUSD')) ?? 0,
      shares: toNumber(readTag(block, 'balance')) ?? 0,
      assetCategory: readTag(block, 'assetCat'),
      payoff: readTag(block, 'payoffProfile'),
      country: readTag(block, 'invCountry'),
    })),
  };
}

function aggregateNport(positions) {
  const byIssuer = new Map();
  for (const position of positions) {
    // Long equity only — cash sweeps, swaps and collateral aren't the fund's picks.
    if (position.payoff === 'Short' || !/^(EC|EP)$/.test(position.assetCategory ?? '') || position.value <= 0) continue;
    const key = /^[0-9A-Z]{9}$/.test(position.cusip) ? position.cusip.slice(0, 6) : `name:${position.issuer}`;
    const current = byIssuer.get(key) ?? { key, issuer: position.issuer, cusip: position.cusip, value: 0, shares: 0, country: position.country };
    current.value += position.value;
    current.shares += position.shares;
    byIssuer.set(key, current);
  }
  return [...byIssuer.values()].sort((a, b) => b.value - a.value);
}

export async function fetchEtfPortfolio(symbol, { topN = TOP_N, maxChanges = 12 } = {}) {
  const ticker = String(symbol ?? '').trim().toUpperCase();
  return cached(`etf:${ticker}`, 6 * 3_600_000, async () => {
    const fund = (await fetchFundTickerMap()).get(ticker);
    if (!fund?.seriesId) return null;
    const search = await secGet(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${fund.seriesId}"`)}&forms=NPORT-P`,
    );
    const filings = (search?.hits?.hits ?? [])
      .map((hit) => ({ accession: hit._id.split(':')[0], document: hit._id.split(':')[1], filed: hit._source.file_date, period: hit._source.period_ending }))
      .sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(b.filed).localeCompare(String(a.filed)))
      .filter((filing, index, list) => list.findIndex((other) => other.period === filing.period) === index)
      .slice(0, 2);
    if (!filings.length) return null;
    const load = (filing) =>
      cached(`nport:${filing.accession}`, 24 * 3_600_000, async () =>
        parseNport(await secGet(archiveFolder(fund.cik, filing.accession) + (filing.document || 'primary_doc.xml'), 'text')),
      );
    const latest = await load(filings[0]);
    const previous = filings[1] ? await load(filings[1]).catch(() => null) : null;
    const current = aggregateNport(latest.positions);
    if (!current.length) return null;
    const regionByCusip = Object.fromEntries(current.map((position) => [position.cusip, COUNTRY_REGION[position.country] ?? 'other']));
    return buildPortfolio({
      current,
      previous: previous ? aggregateNport(previous.positions) : [],
      prior: previous ? { period: filings[1].period, filed: filings[1].filed, accession: filings[1].accession } : null,
      regionByCusip,
      meta: {
        source: 'N-PORT',
        symbol: ticker,
        secName: latest.seriesName,
        accession: filings[0].accession,
        url: archiveFolder(fund.cik, filings[0].accession),
        period: filings[0].period,
        filed: filings[0].filed,
      },
      topN,
      maxChanges,
    });
  });
}

// ── Community buzz (ApeWisdom) ────────────────────────────────────────────────────────────────
// Not anyone's holdings: the stocks a forum talks about most over the last 24 hours, weighted by
// mentions. Labelled as such in the UI.
export async function fetchBuzzPortfolio(filter = 'wallstreetbets', { topN = TOP_N } = {}) {
  const name = String(filter).replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'wallstreetbets';
  return cached(`buzz:${name}`, 20 * 60_000, async () => {
    const response = await fetch(`https://apewisdom.io/api/v1.0/filter/${name}`, { headers: { 'User-Agent': 'AtomFolio' } });
    if (!response.ok) throw new Error(`ApeWisdom ${response.status}`);
    // GOOG and GOOGL (or BRK.A/BRK.B) are one company: merge their mentions before ranking.
    const merged = new Map();
    for (const row of (await response.json())?.results ?? []) {
      const ticker = normalizeTicker(row.ticker);
      if (!ticker || !(Number(row.mentions) > 0)) continue;
      const current = merged.get(ticker);
      if (current) {
        current.mentions = Number(current.mentions) + Number(row.mentions);
        current.mentions_24h_ago = Number(current.mentions_24h_ago || 0) + Number(row.mentions_24h_ago || 0);
        current.rank_24h_ago = Math.min(Number(current.rank_24h_ago) || Infinity, Number(row.rank_24h_ago) || Infinity);
      } else {
        merged.set(ticker, { ...row, ticker });
      }
    }
    const rows = [...merged.values()].sort((a, b) => Number(b.mentions) - Number(a.mentions));
    if (!rows.length) return null;
    const pool = rows.slice(0, 50);
    const total = pool.reduce((sum, row) => sum + Number(row.mentions), 0);
    const top = pool.slice(0, topN);
    const classes = await classifyTickers(top.map((row) => normalizeTicker(row.ticker))).catch(() => ({}));
    const holdings = top.map((row, index) => {
      const ticker = row.ticker;
      const meta = SECURITY_META[ticker];
      const label = decode(row.name);
      return {
        ticker,
        cusip: '',
        name: { ko: meta?.[0] ?? label, en: meta?.[1] ?? label },
        sector: meta?.[2] ?? classes[ticker]?.sector ?? (ETF_NAME.test(label) ? 'etf' : 'other'),
        region: meta?.[3] ?? classes[ticker]?.region ?? 'us',
        weight: Number((Number(row.mentions) / total).toFixed(5)),
        mentions: Number(row.mentions),
        mentions24hAgo: Number(row.mentions_24h_ago) || 0,
        rank: index + 1,
        rank24hAgo: Number.isFinite(Number(row.rank_24h_ago)) ? Number(row.rank_24h_ago) : null,
      };
    });
    const concentration = concentrationOf(pool.map((row) => Number(row.mentions)));
    const today = new Date().toISOString().slice(0, 10);
    return {
      source: 'ApeWisdom',
      filter: name,
      period: today,
      filed: today,
      url: `https://apewisdom.io/${name === 'all-stocks' ? '' : name}`,
      totalValueUsd: null,
      holdingsCount: pool.length,
      effectiveHoldings: Number(concentration.effectiveHoldings.toFixed(2)),
      top1: Number(concentration.top1.toFixed(4)),
      top5: Number(concentration.top5.toFixed(4)),
      holdings,
      previous: null,
      changeCounts: null,
      changes: [],
    };
  });
}

// ── Form 4 insider trades ─────────────────────────────────────────────────────────────────────
const TRANSACTION_KINDS = {
  P: 'buy', // open-market or private purchase
  S: 'sell', // open-market or private sale
  A: 'grant',
  M: 'exercise',
  X: 'exercise',
  C: 'conversion',
  F: 'tax', // shares withheld to pay tax on vesting
  G: 'gift',
  D: 'disposition', // disposed back to the issuer
  J: 'other',
};

export function parseForm4(xml) {
  const owner = blocks(xml, 'reportingOwnerRelationship')[0] ?? '';
  const flag = (tag) => /^(1|true)$/i.test(readTag(owner, tag) ?? '');
  const issuer = {
    name: readTag(xml, 'issuerName'),
    // Some filers list several classes ("LEN, LEN.B"); the first is the common one.
    ticker: normalizeTicker(String(readTag(xml, 'issuerTradingSymbol') ?? '').split(/[,\s/;]+/)[0]),
    cik: normalizeCik(readTag(xml, 'issuerCik')),
  };
  const ownerCiks = blocks(xml, 'reportingOwnerId').map((block) => normalizeCik(readTag(block, 'rptOwnerCik')));
  const relationship = {
    director: flag('isDirector'),
    officer: flag('isOfficer'),
    officerTitle: readTag(owner, 'officerTitle'),
    tenPercentOwner: flag('isTenPercentOwner'),
  };
  const plan10b5 = /^(1|true)$/i.test(readTag(xml, 'aff10b5One') ?? '');
  const trades = blocks(xml, 'nonDerivativeTransaction').map((block) => {
    const code = readTag(block, 'transactionCode');
    const shares = toNumber(readTag(block, 'transactionShares')) ?? 0;
    const price = toNumber(readTag(block, 'transactionPricePerShare'));
    return {
      date: readTag(block, 'transactionDate'),
      code,
      kind: TRANSACTION_KINDS[code] ?? 'other',
      security: readTag(block, 'securityTitle'),
      shares,
      price,
      valueUsd: price ? Math.round(shares * price) : null,
      acquired: readTag(block, 'transactionAcquiredDisposedCode') === 'A',
      ownedAfter: toNumber(readTag(block, 'sharesOwnedFollowingTransaction')),
      direct: readTag(block, 'directOrIndirectOwnership') !== 'I',
    };
  });
  return { issuer, ownerCiks, relationship, plan10b5, trades };
}

// A plan sale often arrives as dozens of rows at slightly different prices; one row per
// day × security × kind reads far better and loses nothing that matters here.
export function groupTrades(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const key = `${trade.date}|${trade.ticker || trade.issuer}|${trade.kind}`;
    const group = groups.get(key) ?? {
      date: trade.date,
      filed: trade.filed,
      url: trade.url,
      issuer: trade.issuer,
      ticker: trade.ticker,
      code: trade.code,
      kind: trade.kind,
      shares: 0,
      valueUsd: 0,
      priced: 0,
      rows: 0,
      plan10b5: false,
      ownedAfter: null,
    };
    group.shares += trade.shares;
    if (trade.valueUsd != null) {
      group.valueUsd += trade.valueUsd;
      group.priced += trade.shares;
    }
    group.rows += 1;
    group.plan10b5 ||= trade.plan10b5;
    if (trade.ownedAfter != null && trade.direct) group.ownedAfter = trade.ownedAfter;
    if (String(trade.filed) > String(group.filed)) group.filed = trade.filed;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ priced, ...group }) => ({
      ...group,
      valueUsd: priced ? Math.round(group.valueUsd) : null,
      averagePrice: priced ? Number((group.valueUsd / priced).toFixed(2)) : null,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

export async function fetchInsiderTrades(cik, { maxFilings = 15 } = {}) {
  return cached(`form4:${cik}`, 10 * 60_000, async () => {
    const submissions = await fetchSubmissions(cik);
    const filings = recentFilings(submissions, ['4']).slice(0, maxFilings);
    if (!filings.length) return null;
    const trades = [];
    const issuers = new Map();
    for (const filing of filings) {
      // primaryDocument points at the XSL-rendered HTML ("xslF345X06/form4.xml"); the raw XML
      // has the same name at the folder root.
      const document = String(filing.primaryDocument ?? '').split('/').pop();
      if (!document) continue;
      const url = archiveFolder(cik, filing.accession) + document;
      try {
        const parsed = parseForm4(await secGet(url, 'text'));
        // A company's filing list also carries its own insiders' Form 4s (it is the issuer
        // there). Only filings where this CIK is a reporting owner are *its* trades.
        if (!parsed.ownerCiks.includes(String(Number(cik)))) continue;
        issuers.set(parsed.issuer.ticker || parsed.issuer.name, { ...parsed.issuer, relationship: parsed.relationship });
        for (const trade of parsed.trades) {
          trades.push({
            ...trade,
            filed: filing.filed,
            accession: filing.accession,
            url: archiveFolder(cik, filing.accession),
            issuer: parsed.issuer.name,
            ticker: parsed.issuer.ticker,
            plan10b5: parsed.plan10b5,
          });
        }
      } catch {
        // One unreadable filing shouldn't hide the rest.
      }
    }
    if (!issuers.size) return null;
    return {
      cik: String(cik),
      secName: submissions.name,
      latestFiled: filings[0].filed,
      issuers: [...issuers.values()],
      trades: groupTrades(trades).slice(0, 40),
    };
  });
}

export async function fetchEtfProfile(symbol) {
  const fund = await fetchEtfPortfolio(symbol);
  return { etf: String(symbol).toUpperCase(), name: fund?.secName ?? symbol, fetchedAt: new Date().toISOString(), fund, insider: null };
}

export async function fetchBuzzProfile(filter) {
  const fund = await fetchBuzzPortfolio(filter);
  return { buzz: filter, name: filter, fetchedAt: new Date().toISOString(), fund, insider: null };
}

export async function fetchSecProfile(cik) {
  const submissions = await fetchSubmissions(cik);
  const has13F = recentFilings(submissions, ['13F-HR']).length > 0;
  const hasForm4 = recentFilings(submissions, ['4']).length > 0;
  const [fund, insider] = await Promise.all([
    has13F ? fetchFundPortfolio(cik) : null,
    hasForm4 ? fetchInsiderTrades(cik) : null,
  ]);
  return { cik: String(cik), name: submissions.name, fetchedAt: new Date().toISOString(), fund, insider };
}
