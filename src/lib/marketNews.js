const BING_NEWS_RSS_URL = 'https://www.bing.com/news/search';
const NAVER_FINANCE_NEWS_URL = 'https://finance.naver.com/news/news_list.naver';
const NAVER_NEWS_SEARCH_URL = 'https://search.naver.com/search.naver';
const NEWS_TIMEOUT_MS = 8500;
const KOREA_TIME_ZONE = 'Asia/Seoul';
const DEFAULT_KOREAN_STOCK_NEWS_QUERY = '증시 오늘';

function withTimeout(signal, timeoutMs = NEWS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();

  signal?.addEventListener?.('abort', abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/&middot;/g, '·')
    .replace(/&uarr;/g, '↑')
    .replace(/&darr;/g, '↓')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp('<(?:\\w+:)?' + tag + '[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?' + tag + '>', 'i'));
  return stripHtml(match?.[1] ?? '');
}

function normalizeQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeTicker(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').slice(0, 18);
}

function normalizeLanguage(value) {
  return value === 'en' ? 'en' : 'ko';
}

function normalizeNewsSource(value) {
  const cleanValue = stripHtml(value).replace(/\s*언론사\s*선정\s*/g, ' ').trim();

  if (!cleanValue || /naver|네이버/i.test(cleanValue)) {
    return '주식 뉴스';
  }

  return cleanValue;
}

function koreanDateParts(value = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(Number(value))).map((part) => [part.type, part.value]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

function koreanDateKey(value = Date.now()) {
  const parts = koreanDateParts(value);
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function naverDateValue(parts = koreanDateParts()) {
  return parts.year + '.' + parts.month + '.' + parts.day;
}

function naverCompactDateValue(parts = koreanDateParts()) {
  return parts.year + parts.month + parts.day;
}

function isTodayInKorea(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return false;
  }

  return koreanDateKey(numericValue) === koreanDateKey(Date.now());
}

function todayStockNewsQuery(language = 'ko') {
  return language === 'en' ? 'latest stock market news' : '최신 주식 뉴스';
}

function applyCacheBust(url, cacheBust) {
  if (cacheBust) {
    url.searchParams.set('_ts', String(cacheBust));
  }

  return url;
}

function isStockRelatedNewsItem(item) {
  const text = [item?.title, item?.description].filter(Boolean).join(' ').toLowerCase();
  return /(주식|증시|코스피|코스닥|주가|증권|종목|상장|투자|etf|펀드|나스닥|뉴욕증시|다우|s&p|반도체|금리|환율|stock|market|nasdaq|dow|equity|shares|investor)/i.test(text);
}

function safeExternalLink(value, baseUrl) {
  try {
    const url = new URL(String(value ?? '').trim(), baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function parsePublishedAt(value) {
  const cleanValue = stripHtml(value);

  if (!cleanValue) {
    return null;
  }

  const relativeMatch = cleanValue.match(/(\d+)\s*(분|시간|일)\s*전/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const multiplier = unit === '분' ? 60000 : unit === '시간' ? 3600000 : 86400000;
    return Date.now() - amount * multiplier;
  }

  const normalized = cleanValue
    .replace(/[.]\s*/g, '-')
    .replace(/-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parsed = Date.parse(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchText(url, { signal, encoding = 'utf-8' } = {}) {
  const timeout = withTimeout(signal);

  try {
    const response = await fetch(url.toString(), {
      signal: timeout.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 AtomFolio/1.0',
        Accept: 'text/html,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`news-fetch-failed:${response.status}`);
    }

    if (encoding === 'euc-kr') {
      const bytes = await response.arrayBuffer();
      return new TextDecoder('euc-kr').decode(bytes);
    }

    return await response.text();
  } finally {
    timeout.cleanup();
  }
}

const OG_IMAGE_TIMEOUT_MS = 4000;
const OG_IMAGE_ENRICH_LIMIT = 6;
const OG_IMAGE_PATTERN =
  /<meta\b[^>]*(?:property=["']og:image["'][^>]*content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*property=["']og:image["'])[^>]*>/i;
// finance.naver.com's article links are a JS bounce page (`top.location.href='...'`), not a real
// HTTP redirect — `fetch(..., { redirect: 'follow' })` can't follow that, so it has to be
// pattern-matched out of the tiny bounce-page body and re-fetched once.
const JS_REDIRECT_PATTERN = /location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i;

async function fetchHtml(url, signal) {
  const timeout = withTimeout(signal, OG_IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 AtomFolio/1.0',
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      return null;
    }

    // og:image (or a JS redirect target) is always near the top of the page — reading the whole
    // body would waste bandwidth on a 6-request-per-response enrichment step that's meant to
    // stay lightweight.
    const reader = response.body?.getReader?.();
    if (!reader) {
      return await response.text();
    }

    const decoder = new TextDecoder('utf-8');
    let html = '';
    while (html.length < 60000) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      html += decoder.decode(value, { stream: true });
      if (OG_IMAGE_PATTERN.test(html) || JS_REDIRECT_PATTERN.test(html)) {
        break;
      }
    }
    reader.cancel?.().catch(() => {});
    return html;
  } finally {
    timeout.cleanup();
  }
}

async function fetchOgImageUrl(link, signal) {
  try {
    let html = await fetchHtml(link, signal);

    if (html == null) {
      return null;
    }

    if (!OG_IMAGE_PATTERN.test(html)) {
      const redirectTarget = safeExternalLink(stripHtml(html.match(JS_REDIRECT_PATTERN)?.[1] ?? ''), link);
      if (redirectTarget && redirectTarget !== link) {
        html = (await fetchHtml(redirectTarget, signal)) ?? html;
      }
    }

    const match = html.match(OG_IMAGE_PATTERN);
    const rawUrl = stripHtml(match?.[1] ?? match?.[2] ?? '');

    // safeExternalLink(value, baseUrl) resolves an *empty* value to baseUrl itself (that's how
    // `new URL('', base)` behaves) rather than failing — without this guard, a page with no
    // og:image tag would silently "succeed" with the article's own link as its thumbnail.
    if (!rawUrl) {
      return null;
    }

    return safeExternalLink(rawUrl, link) || null;
  } catch {
    return null;
  }
}

// Only the top OG_IMAGE_ENRICH_LIMIT items still missing a thumbnail get this treatment — an
// extra per-article page fetch for every item in the list would noticeably slow the response, so
// this is deliberately bounded. Runs as Promise.allSettled: any individual article fetch failing
// (dead link, slow site, blocked scrape) just leaves that item's thumbnailUrl null rather than
// failing the whole news response.
async function enrichWithOgImages(items, { signal } = {}) {
  const candidates = items.filter((item) => !item.thumbnailUrl && item.link).slice(0, OG_IMAGE_ENRICH_LIMIT);

  if (!candidates.length) {
    return items;
  }

  const results = await Promise.allSettled(
    candidates.map((item) => fetchOgImageUrl(item.link, signal)),
  );
  const thumbnailByLink = new Map();

  candidates.forEach((item, index) => {
    const result = results[index];
    if (result.status === 'fulfilled' && result.value) {
      thumbnailByLink.set(item.link, result.value);
    }
  });

  if (!thumbnailByLink.size) {
    return items;
  }

  return items.map((item) =>
    thumbnailByLink.has(item.link) ? { ...item, thumbnailUrl: thumbnailByLink.get(item.link) } : item,
  );
}

async function fetchWithTimeout(url, options = {}) {
  const timeout = withTimeout(options.signal);

  try {
    return await fetch(url.toString(), {
      ...options,
      signal: timeout.signal,
    });
  } finally {
    timeout.cleanup();
  }
}

export function uniqueNewsItems(items, limit = 12) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const link = safeExternalLink(item.link);

    if (!item.title || !link || seen.has(link)) {
      continue;
    }

    seen.add(link);
    result.push({
      ...item,
      link,
      id: item.id || `${link}-${result.length}`,
      source: normalizeNewsSource(item.source),
      thumbnailUrl: item.thumbnailUrl ?? null,
    });

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function parseNaverFinanceItems(html, limit = 12) {
  const items = [];
  const articlePattern =
    /<dd[^>]*class=["'][^"']*articleSubject[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/dd>\s*<dd[^>]*class=["'][^"']*articleSummary[^"']*["'][^>]*>([\s\S]*?)<\/dd>/gi;
  const htmlText = String(html ?? '');
  let match = articlePattern.exec(htmlText);

  while (match && items.length < limit) {
    const [, rawLink, rawTitle, rawSummary] = match;
    const source = stripHtml(
      rawSummary.match(/<span[^>]*class=["'][^"']*press[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '',
    );
    const dateText = stripHtml(
      rawSummary.match(/<span[^>]*class=["'][^"']*wdate[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '',
    );
    const description = stripHtml(
      rawSummary
        .replace(/<span[^>]*class=["'][^"']*(?:press|wdate)[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ' ')
        .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, ' '),
    );
    const link = safeExternalLink(rawLink, 'https://finance.naver.com');

    items.push({
      id: `${link}-${items.length}`,
      title: stripHtml(rawTitle),
      link,
      description,
      source: source || '주식 뉴스',
      publishedAt: parsePublishedAt(dateText),
      thumbnailUrl: null,
    });

    match = articlePattern.exec(htmlText);
  }

  return uniqueNewsItems(items, limit);
}

// Naver's search-results HTML embeds a real per-article thumbnail (a search.pstatic.net proxy
// URL, already resized) right next to the headline — width="104" is specifically the article
// thumbnail size; width="24" images nearby are just the press outlet's tiny logo icon, not a
// thumbnail, so they're deliberately excluded.
function extractNaverThumbnailUrl(block) {
  const imgTags = block.match(/<img\b[^>]*>/gi) ?? [];

  for (const imgTag of imgTags) {
    if (!/width=["']104["']/i.test(imgTag)) {
      continue;
    }

    const src = imgTag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    const resolved = safeExternalLink(stripHtml(src ?? ''));

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function parseNaverSearchItems(html, limit = 12) {
  const items = [];
  const htmlText = String(html ?? '');
  const legacyTitlePattern =
    /<a[^>]*class=["'][^"']*news_tit[^"']*["'][^>]*href=["']([^"']+)["'][^>]*(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
  const sourcePattern = /<a[^>]*class=["'][^"']*info[^"']*press[^"']*["'][^>]*>([\s\S]*?)<\/a>/i;
  const descPattern = /<a[^>]*class=["'][^"']*api_txt_lines[^"']*dsc_txt_wrap[^"']*["'][^>]*>([\s\S]*?)<\/a>/i;
  const timePattern = /<span[^>]*class=["'][^"']*info[^"']*["'][^>]*>(\d+\s*(?:분|시간|일)\s*전|20\d{2}[.\-\s]\d{1,2}[.\-\s]\d{1,2}[^<]*)<\/span>/i;
  let match = legacyTitlePattern.exec(htmlText);

  while (match && items.length < limit) {
    const [, rawLink, rawTitleAttribute, rawTitle] = match;
    const blockStart = Math.max(0, match.index - 400);
    const blockEnd = Math.min(htmlText.length, legacyTitlePattern.lastIndex + 1600);
    const block = htmlText.slice(blockStart, blockEnd);
    const link = safeExternalLink(rawLink);

    items.push({
      id: link + '-' + items.length,
      title: stripHtml(rawTitleAttribute || rawTitle),
      link,
      description: stripHtml(block.match(descPattern)?.[1] ?? ''),
      source: stripHtml(block.match(sourcePattern)?.[1] ?? '') || '주식 뉴스',
      publishedAt: parsePublishedAt(block.match(timePattern)?.[1] ?? ''),
      thumbnailUrl: extractNaverThumbnailUrl(block),
    });

    match = legacyTitlePattern.exec(htmlText);
  }

  const modernTitlePattern = /<a(?=[^>]*data-heatmap-target=["']\.tit["'])([^>]*)>([\s\S]*?)<\/a>/gi;
  const modernBodyPattern = /<a(?=[^>]*data-heatmap-target=["']\.body["'])[^>]*>([\s\S]*?)<\/a>/i;
  const modernTimePattern = /<span[^>]*>(\d+\s*(?:분|시간|일)\s*전|20\d{2}[.\-\s]\d{1,2}[.\-\s]\d{1,2}[^<]*)<\/span>/i;
  match = modernTitlePattern.exec(htmlText);

  while (match && items.length < limit) {
    const [, attrs, rawTitle] = match;
    const rawLink = attrs.match(/\shref=["']([^"']+)["']/i)?.[1] ?? '';
    const link = safeExternalLink(rawLink);
    const blockStart = Math.max(0, match.index - 3600);
    const blockEnd = Math.min(htmlText.length, modernTitlePattern.lastIndex + 2200);
    const block = htmlText.slice(blockStart, blockEnd);

    items.push({
      id: link + '-' + items.length,
      title: stripHtml(rawTitle),
      link,
      description: stripHtml(block.match(modernBodyPattern)?.[1] ?? ''),
      source: '주식 뉴스',
      publishedAt: parsePublishedAt(block.match(modernTimePattern)?.[1] ?? ''),
      thumbnailUrl: extractNaverThumbnailUrl(block),
    });

    match = modernTitlePattern.exec(htmlText);
  }

  return uniqueNewsItems(items, limit);
}

async function fetchNaverFinanceNews({ signal, cacheBust } = {}) {
  const url = new URL(NAVER_FINANCE_NEWS_URL);
  url.searchParams.set('mode', 'LSS2D');
  url.searchParams.set('section_id', '101');
  url.searchParams.set('section_id2', '258');

  const html = await fetchText(applyCacheBust(url, cacheBust), { signal, encoding: 'euc-kr' });
  return parseNaverFinanceItems(html, 12);
}

async function fetchNaverSearchNews({ query, tickers = [], signal, todayOnly = false, cacheBust } = {}) {
  const cleanQuery = normalizeQuery(query);
  const tickerText = Array.isArray(tickers)
    ? tickers.map(normalizeTicker).filter(Boolean).slice(0, 5).join(' ')
    : '';
  const searchQuery = normalizeQuery(
    todayOnly
      ? [DEFAULT_KOREAN_STOCK_NEWS_QUERY, '오늘', '최신뉴스'].join(' ')
      : cleanQuery || tickerText || DEFAULT_KOREAN_STOCK_NEWS_QUERY,
  );
  const url = new URL(NAVER_NEWS_SEARCH_URL);
  url.searchParams.set('where', 'news');
  url.searchParams.set('sm', todayOnly ? 'tab_opt' : 'tab_hty.top');
  url.searchParams.set('sort', '1');
  url.searchParams.set('query', searchQuery);

  if (todayOnly) {
    const today = koreanDateParts();
    const dateValue = naverDateValue(today);
    const compactDateValue = naverCompactDateValue(today);
    url.searchParams.set('pd', '3');
    url.searchParams.set('ds', dateValue);
    url.searchParams.set('de', dateValue);
    url.searchParams.set('nso', 'so:dd,p:from' + compactDateValue + 'to' + compactDateValue + ',a:all');
  }

  const html = await fetchText(applyCacheBust(url, cacheBust), { signal });
  return parseNaverSearchItems(html, 12);
}

function latestStockNewsItems(items, limit = 12) {
  return uniqueNewsItems(
    items
      .filter(isStockRelatedNewsItem)
      .sort((left, right) => {
        const leftTime = Number(left.publishedAt);
        const rightTime = Number(right.publishedAt);
        const leftHasTime = Number.isFinite(leftTime);
        const rightHasTime = Number.isFinite(rightTime);

        if (leftHasTime && rightHasTime) {
          return rightTime - leftTime;
        }

        if (leftHasTime) {
          return -1;
        }

        if (rightHasTime) {
          return 1;
        }

        return 0;
      }),
    limit,
  );
}

function todayNewsItems(items, limit = 12) {
  const todayItems = items.filter((item) => isTodayInKorea(item.publishedAt) && isStockRelatedNewsItem(item));
  const undatedItems = items.filter(
    (item) => !Number.isFinite(Number(item.publishedAt)) && isStockRelatedNewsItem(item),
  );
  const datedItems = uniqueNewsItems([...todayItems, ...undatedItems], limit);

  // Early in the Korea trading day (or on a quiet news day) same-calendar-day articles alone can
  // be thin — once the strict "today" set falls short of a full page, pad it out with the next
  // most recent stock-related items regardless of date rather than leaving the panel looking
  // sparse. Today's own items still sort first, since latestStockNewsItems orders by recency.
  return datedItems.length >= limit ? datedItems : latestStockNewsItems(items, limit);
}

function parseRssItems(xml, limit = 10) {
  const blocks = String(xml ?? '').match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return blocks
    .slice(0, limit)
    .map((block, index) => {
      const title = extractTag(block, 'title');
      const link = safeExternalLink(extractTag(block, 'link'));
      const description = extractTag(block, 'description');
      const source = extractTag(block, 'source');
      const pubDate = extractTag(block, 'pubDate');
      const publishedAt = pubDate ? Date.parse(pubDate) : null;

      return {
        id: `${link || title}-${index}`,
        title,
        link,
        description,
        source: source || '뉴스',
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
        thumbnailUrl: null,
      };
    })
    .filter((item) => item.title && item.link);
}

async function fetchMarketNewsPayload({ query, tickers = [], language = 'ko', mode = 'today', signal, refreshKey } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const cleanQuery = normalizeQuery(query);
  const cacheBust = refreshKey || Date.now();
  const tickerText = Array.isArray(tickers)
    ? tickers.map(normalizeTicker).filter(Boolean).slice(0, 5).join(' OR ')
    : '';
  const isDefaultTodayMode = normalizedLanguage === 'ko' && !cleanQuery && mode !== 'search';
  let primaryPayload = null;

  if (normalizedLanguage === 'ko') {
    if (isDefaultTodayMode) {
      try {
        const items = todayNewsItems(await fetchNaverFinanceNews({ signal, cacheBust }), 12);

        if (items.length) {
          primaryPayload = {
            query: todayStockNewsQuery('ko'),
            items,
            source: '네이버 증시뉴스',
            mode: 'today',
            fetchedAt: Date.now(),
          };

          if (items.length >= 4) {
            return primaryPayload;
          }
        }
      } catch {
        // Try Naver search before falling back to RSS.
      }
    }

    try {
      const rawItems = await fetchNaverSearchNews({
        query: isDefaultTodayMode ? DEFAULT_KOREAN_STOCK_NEWS_QUERY : cleanQuery,
        tickers: isDefaultTodayMode ? [] : tickers,
        signal,
        todayOnly: isDefaultTodayMode,
        cacheBust,
      });
      const items = isDefaultTodayMode ? todayNewsItems(rawItems, 12) : rawItems;

      if (items.length) {
        primaryPayload = {
          query: isDefaultTodayMode ? todayStockNewsQuery('ko') : cleanQuery || tickerText || '주식 뉴스',
          items,
          source: isDefaultTodayMode ? '네이버 최신뉴스' : '검색 결과',
          mode: isDefaultTodayMode ? 'today' : 'search',
          fetchedAt: Date.now(),
        };

        if (!isDefaultTodayMode || items.length >= 4) {
          return primaryPayload;
        }
      }
    } catch {
      // Fall back to RSS below if the primary provider is temporarily unavailable.
    }
  }

  const isDefaultFallbackMode = !cleanQuery && mode !== 'search';
  const fallbackQuery =
    normalizedLanguage === 'en'
      ? cleanQuery || tickerText || 'stock market today'
      : isDefaultFallbackMode
        ? DEFAULT_KOREAN_STOCK_NEWS_QUERY
        : cleanQuery || tickerText || DEFAULT_KOREAN_STOCK_NEWS_QUERY;
  const decoratedQuery =
    normalizedLanguage === 'en'
      ? fallbackQuery + ' stock market'
      : isDefaultFallbackMode
        ? fallbackQuery
        : fallbackQuery + ' 주식 투자 증시';
  const url = new URL(BING_NEWS_RSS_URL);
  url.searchParams.set('q', decoratedQuery);
  url.searchParams.set('format', 'rss');
  url.searchParams.set('setlang', normalizedLanguage === 'en' ? 'en-US' : 'ko-KR');
  url.searchParams.set('cc', normalizedLanguage === 'en' ? 'US' : 'KR');

  try {
    const xml = await fetchText(applyCacheBust(url, cacheBust), { signal });
    const rawItems = uniqueNewsItems(parseRssItems(xml, 12), 12);
    const items = isDefaultFallbackMode ? todayNewsItems(rawItems, 12) : rawItems;

    if (items.length || !primaryPayload) {
      return {
        query: isDefaultFallbackMode ? todayStockNewsQuery(normalizedLanguage) : fallbackQuery,
        items,
        source: isDefaultFallbackMode ? '최신 주식 뉴스' : '검색 결과',
        mode: isDefaultFallbackMode ? 'today' : 'search',
        fetchedAt: Date.now(),
      };
    }
  } catch {
    if (!primaryPayload) {
      throw new Error('news-fetch-failed');
    }
  }

  return primaryPayload;
}

// Public entry point: runs whichever provider chain above succeeds, then makes one bounded
// best-effort pass to backfill thumbnails for items that still don't have one (see
// enrichWithOgImages) before handing the payload back to the server route / direct caller.
export async function fetchMarketNewsFromProviders(options = {}) {
  const payload = await fetchMarketNewsPayload(options);

  if (!payload?.items?.length) {
    return payload;
  }

  return {
    ...payload,
    items: await enrichWithOgImages(payload.items, { signal: options.signal }),
  };
}
export async function fetchMarketNews({ query, tickers, language, mode, refreshKey, signal } = {}) {
  if (typeof window !== 'undefined') {
    const url = new URL('/api/market/news', window.location.origin);

    if (normalizeQuery(query)) {
      url.searchParams.set('query', normalizeQuery(query));
    }
    if (Array.isArray(tickers) && tickers.length) {
      url.searchParams.set('tickers', tickers.map(normalizeTicker).filter(Boolean).slice(0, 5).join(','));
    }
    if (language) {
      url.searchParams.set('language', normalizeLanguage(language));
    }
    if (mode) {
      url.searchParams.set('mode', mode === 'search' ? 'search' : 'today');
    }
    if (refreshKey) {
      url.searchParams.set('_ts', String(refreshKey));
      url.searchParams.set('refresh', '1');
    }

    const response = await fetchWithTimeout(url.toString(), { signal, cache: 'no-store' });

    if (response.ok) {
      return await response.json();
    }

    throw new Error('news-api-failed:' + response.status);
  }

  return fetchMarketNewsFromProviders({ query, tickers, language, mode, refreshKey, signal });
}

export function formatNewsTime(value, language = 'ko') {
  if (!Number.isFinite(Number(value))) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(value)));
}
