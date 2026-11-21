#!/usr/bin/env node
// Avatars for src/data/guruDirectory.json → public/gurus/<id>.<ext>, credits in
// src/data/guruPhotos.json.
//
//   npm run data:guru-photos
//
// Order of preference for each entry:
//   1. A portrait: the English Wikipedia lead image, else the person's Wikidata image (P18) —
//      only Wikimedia Commons files whose license metadata says CC BY / CC BY-SA / CC0 / public
//      domain / OGL. Credits must stay visible in the app (CC BY requires attribution).
//   2. The organisation's own logo (institutions, and people without a free portrait), taken
//      from the official site's icon links, used only to identify that organisation.
//
// A free photo license covers copyright only; showing a real person's likeness in a commercial
// product can also involve publicity/portrait rights, which no license here grants.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const IMAGE_DIR = new URL('public/gurus/', root);
const CREDITS_FILE = fileURLToPath(new URL('src/data/guruPhotos.json', root));
const HEADERS = { 'User-Agent': 'AtomFolio/1.0 (https://atomfolio.vercel.app) avatar-credits script' };
const FREE_LICENSE = /^(cc[ -]?by|cc0|public domain|pd\b|pd-|ogl)/i;
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/gif': 'gif',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripHtml = (value) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function fetchWithTimeout(url, options = {}) {
  await sleep(250);
  return fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12_000), ...options });
}

async function getJson(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

async function saveImage(id, url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;
  const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  let extension = IMAGE_TYPES[type];
  if (!extension) {
    const magic = bytes.subarray(0, 4).toString('hex');
    extension = magic === '89504e47' ? 'png' : magic.startsWith('ffd8') ? 'jpg' : null;
  }
  if (!extension || bytes.length < 200) return null;
  await writeFile(new URL(`${id}.${extension}`, IMAGE_DIR), bytes);
  return `/gurus/${id}.${extension}`;
}

async function commonsPortrait(fileName) {
  const info = await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=256&titles=${encodeURIComponent(`File:${fileName}`)}`,
  );
  const image = Object.values(info?.query?.pages ?? {})[0]?.imageinfo?.[0];
  const meta = image?.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!image || !FREE_LICENSE.test(license)) return { skip: `license "${license || 'unknown'}"` };
  return {
    url: image.thumburl ?? image.url,
    author: stripHtml(meta.Artist?.value).slice(0, 120) || 'Unknown',
    license,
    sourceUrl: image.descriptionurl,
  };
}

// Files on Commons named after the person ("Bruce Berkowitz, Fairholme Capital Management.jpg")
// often exist even when no article uses them. Namesakes are common ("Li Lu" matched a Bastille
// archive scan, "Chase Coleman" a musician), so the title must hold the full name as a phrase
// *and* a word from the person's firm.
async function commonsSearchPortrait(name, entity) {
  const phrase = String(name ?? '').toLowerCase().trim();
  const firmWords = String(entity ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !['capital', 'management', 'group', 'investments', 'investors', 'fund', 'office', 'family', 'asset', 'holdings'].includes(word));
  if (phrase.split(/\s+/).length < 2 || !firmWords.length) return null;
  const data = await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=20&srsearch=${encodeURIComponent(`"${name}"`)}`,
  ).catch(() => null);
  const titles = (data?.query?.search ?? [])
    .map((hit) => hit.title.replace(/^File:/, ''))
    .filter((title) => {
      const lower = title.toLowerCase();
      return /\.(jpe?g|png|webp)$/i.test(title) && lower.includes(phrase) && firmWords.some((word) => lower.includes(word));
    });
  for (const title of titles) {
    const result = await commonsPortrait(title.replace(/ /g, '_')).catch(() => null);
    if (result?.url) return result;
  }
  return null;
}

async function portraitFor(wiki) {
  const summary = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki)}`).catch(() => null);
  const lead = summary?.originalimage?.source ?? summary?.thumbnail?.source;
  const candidates = [];
  if (lead?.includes('/wikipedia/commons/')) {
    candidates.push(decodeURIComponent(lead.split('?')[0].split('/').pop().replace(/^\d+px-/, '')));
  }
  // Wikidata's image (P18) is often a free portrait even when the article's lead image isn't.
  const qid = summary?.wikibase_item;
  if (qid) {
    const entity = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`).catch(() => null);
    const p18 = entity?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (p18) candidates.push(p18.replace(/ /g, '_'));
  }
  for (const fileName of [...new Set(candidates)]) {
    const result = await commonsPortrait(fileName).catch(() => null);
    if (result?.url) return result;
  }
  return null;
}

// Biggest declared icon on the organisation's own home page, then the conventional paths.
async function logoUrlsFor(domain) {
  const urls = [];
  try {
    const response = await fetchWithTimeout(`https://${domain}/`);
    if (response.ok) {
      const base = response.url;
      const html = (await response.text()).slice(0, 400_000);
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
      const icons = links
        .filter((tag) => /rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(tag))
        .map((tag) => {
          const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
          const sizes = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? 0);
          const apple = /apple-touch-icon/i.test(tag);
          return href ? { href: new URL(href, base).href, score: (apple ? 1000 : 0) + sizes + (/\.svg/i.test(href) ? 500 : 0) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
      // Site-builder placeholders (Webflow's "W", Wix, Squarespace) are not the organisation's mark.
      urls.push(...icons.map((icon) => icon.href).filter((href) => !/webflow|website-files\.com\/img|wixstatic\.com\/favicon|squarespace\.com\/universal/i.test(href)));
    }
  } catch {
    // site unreachable from a script (bot protection etc.) — fall through
  }
  urls.push(`https://${domain}/apple-touch-icon.png`);
  urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  return urls;
}

async function main() {
  const directory = JSON.parse(await readFile(new URL('src/data/guruDirectory.json', root), 'utf8'));
  // `--only id1,id2` refreshes just those entries and keeps everyone else's files and credits.
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  await mkdir(IMAGE_DIR, { recursive: true });
  const credits = only ? JSON.parse(await readFile(CREDITS_FILE, 'utf8').catch(() => '{}')) : {};
  const customFiles = await readdir(new URL('custom/', IMAGE_DIR)).catch(() => []);
  for (const name of await readdir(IMAGE_DIR, { withFileTypes: true })) {
    if (name.isDirectory()) continue;
    if (!only || only.has(name.name.replace(/\.[^.]+$/, ''))) await rm(new URL(name.name, IMAGE_DIR));
  }
  for (const entry of directory.people) {
    if (only && !only.has(entry.id)) continue;
    delete credits[entry.id];
    let credit = null;
    // A file the app owner has the rights to always wins: public/gurus/custom/<id>.<ext>.
    const custom = customFiles.find((name) => name.replace(/\.[^.]+$/, '') === entry.id);
    if (custom) {
      credit = { kind: 'photo', src: `/gurus/custom/${custom}`, author: 'Provided by the app owner', license: 'Licensed to the app owner', sourceUrl: '' };
    }
    const isPerson = entry.category !== 'institution';
    // portrait: false / logo: false in the directory veto a source checked by hand and found
    // wrong (a namesake's photo, a site builder's default icon).
    if (!credit && entry.wiki && entry.portrait !== false) {
      const portrait =
        (await portraitFor(entry.wiki).catch(() => null)) ??
        (isPerson ? await commonsSearchPortrait(entry.person?.en, entry.entity).catch(() => null) : null);
      if (portrait) {
        const src = await saveImage(entry.id, portrait.url);
        if (src) credit = { kind: 'photo', src, author: portrait.author, license: portrait.license, sourceUrl: portrait.sourceUrl };
      }
    }
    if (!credit && entry.domain && entry.logo !== false) {
      for (const url of await logoUrlsFor(entry.domain)) {
        const src = await saveImage(entry.id, url).catch(() => null);
        if (src) {
          credit = { kind: 'logo', src, author: entry.entity, license: 'Trademark of its owner — shown for identification', sourceUrl: `https://${entry.domain}` };
          break;
        }
      }
    }
    if (credit) credits[entry.id] = credit;
    console.log(`${entry.id}: ${credit ? `${credit.kind} ${credit.src}${credit.kind === 'photo' ? ` (${credit.license})` : ''}` : 'none → monogram'}`);
  }
  await writeFile(CREDITS_FILE, `${JSON.stringify(credits, null, 2)}\n`);
  const missing = directory.people.filter((entry) => !credits[entry.id]).map((entry) => entry.id);
  console.log(`\n${Object.keys(credits).length}/${directory.people.length} avatars. Missing: ${missing.join(', ') || 'none'}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
