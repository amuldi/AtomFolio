// News tab of the tool drawer — split out of App.jsx alongside ToolSideDrawer.jsx, its only
// consumer. newsPanelCache is a plain module-level object (not React state) specifically so
// the panel's query/results survive an unmount/remount when the drawer switches tabs (see
// the comment at its own declaration for why that unmount happens every tab switch).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarketNews, formatNewsTime } from '../../lib/marketNews.js';

const NEWS_AUTO_REFRESH_MS = 90 * 1000;

// How long a freshly-arrived article keeps its "NEW" badge before it fades back to a normal row
// — a UX timing choice, independent of the design system's 100-150ms Contextual Duration rule
// (that rule governs the badge's own enter/exit transition, defined in CSS, not how long it stays).
const NEWS_NEW_BADGE_VISIBLE_MS = 8000;

const NEWS_PAGE_SIZE = 20;

const newsPanelCache = {
  hasLoadedOnce: false,
  language: null,
  query: '',
  submittedQuery: '',
  news: null,
  seenArticleIds: new Set(),
};

export const MarketNewsPanel = memo(function MarketNewsPanel({ language, dateBasis }) {
  const requestIdRef = useRef(0);
  const activeNewsAbortRef = useRef(null);
  const seenArticleIdsRef = useRef(newsPanelCache.seenArticleIds);
  const newBadgeTimeoutRef = useRef(null);
  const rootRef = useRef(null);
  const [query, setQuery] = useState(newsPanelCache.query);
  const [submittedQuery, setSubmittedQuery] = useState(newsPanelCache.submittedQuery);
  const [news, setNews] = useState(newsPanelCache.news);
  const [status, setStatus] = useState(newsPanelCache.news ? 'ready' : 'idle');
  const [error, setError] = useState('');
  const [newArticleIds, setNewArticleIds] = useState(() => new Set());

  // Keep the cross-mount cache in sync with whatever's currently on screen — a plain effect per
  // field rather than threading cache writes through every setQuery/setSubmittedQuery/setNews
  // call site.
  useEffect(() => {
    newsPanelCache.query = query;
  }, [query]);
  useEffect(() => {
    newsPanelCache.submittedQuery = submittedQuery;
  }, [submittedQuery]);
  useEffect(() => {
    newsPanelCache.news = news;
  }, [news]);

  const loadNews = useCallback(
    async (
      nextQuery = '',
      { silent = false, page = 1, pageSize = NEWS_PAGE_SIZE, forceRefresh = false } = {},
    ) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      activeNewsAbortRef.current?.abort();

      const controller = new AbortController();
      activeNewsAbortRef.current = controller;
      const cleanQuery = String(nextQuery ?? '').trim();

      if (!silent) {
        setStatus('loading');
        setError('');
      }

      try {
        const payload = await fetchMarketNews({
          query: cleanQuery,
          language,
          mode: cleanQuery ? 'search' : 'today',
          // Only an explicit refresh bypasses the server's cached pool — page navigation and the
          // 90s auto-refresh tick reuse it, which is what keeps those near-instant instead of
          // re-triggering a ~3.5s full Naver/Bing/OG-image scrape on every click or tick.
          refreshKey: forceRefresh ? `${Date.now()}-${requestId}` : undefined,
          page,
          pageSize,
          signal: controller.signal,
        });

        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        // NEW badges only make sense on a background auto-refresh of a page that already has a
        // prior snapshot to compare against — a page the reader is navigating to for the first
        // time isn't "new content arriving", it's just content they haven't looked at yet. The
        // `seenIds.size` check additionally guards against React StrictMode's double-invoked
        // mount effect: the second invocation can see the cache's `hasLoadedOnce` flag already
        // set (from the first invocation's synchronous portion) and take the silent-refresh
        // branch before any response has actually populated seenIds yet, which would otherwise
        // badge the very first load's entire list as "new".
        const seenIds = seenArticleIdsRef.current;
        const freshIds =
          silent && seenIds.size > 0
            ? new Set(
                (payload.items ?? [])
                  .filter((article) => article.id && !seenIds.has(article.id))
                  .map((article) => article.id),
              )
            : new Set();
        for (const article of payload.items ?? []) {
          if (article.id) {
            seenIds.add(article.id);
          }
        }

        setNews(payload);
        setStatus('ready');
        setError('');

        if (freshIds.size) {
          window.clearTimeout(newBadgeTimeoutRef.current);
          setNewArticleIds(freshIds);
          newBadgeTimeoutRef.current = window.setTimeout(() => {
            setNewArticleIds(new Set());
          }, NEWS_NEW_BADGE_VISIBLE_MS);
        }
      } catch {
        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        // A silent (background poll) failure keeps whatever's already on screen rather than
        // blanking the panel over a single missed 90s tick.
        if (silent) {
          return;
        }

        setNews(null);
        setStatus('error');
        setError(language === 'en' ? 'Could not load market news.' : '뉴스를 가져오지 못했습니다.');
      }
    },
    [language],
  );

  useEffect(() => {
    // First-ever mount, or the UI language changed since the cache was built (cached articles
    // would be in the wrong language) — do the original full reset + fresh load. Otherwise this
    // is a remount after tabbing away and back: the cached state above already restored what was
    // on screen, so just refresh it quietly in the background instead of blanking the panel.
    const needsFreshLoad = !newsPanelCache.hasLoadedOnce || newsPanelCache.language !== language;

    if (needsFreshLoad) {
      newsPanelCache.hasLoadedOnce = true;
      newsPanelCache.language = language;
      setQuery('');
      setSubmittedQuery('');
      seenArticleIdsRef.current = new Set();
      newsPanelCache.seenArticleIds = seenArticleIdsRef.current;
      setNewArticleIds(new Set());
      loadNews('');
    } else {
      // Re-fetch whichever page was already showing (a cache-served slice, not a fresh scrape)
      // so tabbing back in doesn't reset pagination back to page 1.
      void loadNews(newsPanelCache.submittedQuery, {
        silent: true,
        page: newsPanelCache.news?.page ?? 1,
      });
    }

    return () => {
      requestIdRef.current += 1;
      activeNewsAbortRef.current?.abort();
      window.clearTimeout(newBadgeTimeoutRef.current);
    };
  }, [language, loadNews]);

  // Auto-refresh: only while this panel is mounted (i.e. actually open — see ToolSideDrawer's
  // resolvedTool.key === 'news' gate) and the tab is in the foreground. Background tabs pause
  // entirely rather than firing polls that'll just be wasted work. Re-fetches whichever page is
  // currently on screen — silent, so no refreshKey, so this reads the server's cached pool
  // instead of re-triggering a full scrape every 90s.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void loadNews(submittedQuery, { silent: true, page: news?.page ?? 1 });
      }
    };

    const intervalId = window.setInterval(tick, NEWS_AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadNews, submittedQuery, news?.page]);

  const handleSearch = useCallback(
    (event) => {
      event.preventDefault();
      const cleanQuery = query.trim();
      setSubmittedQuery(cleanQuery);
      seenArticleIdsRef.current = new Set();
      setNewArticleIds(new Set());
      loadNews(cleanQuery);
    },
    [loadNews, query],
  );

  const handleRefresh = useCallback(() => {
    loadNews(submittedQuery, { page: news?.page ?? 1, forceRefresh: true });
  }, [loadNews, submittedQuery, news?.page]);

  const handleGoToPage = useCallback(
    (pageNumber) => {
      const totalPages = Math.max(
        1,
        Math.ceil((news?.totalCount ?? 0) / (news?.pageSize ?? NEWS_PAGE_SIZE)),
      );
      const clampedPage = Math.min(Math.max(1, pageNumber), totalPages);
      if (clampedPage === (news?.page ?? 1)) {
        return;
      }
      loadNews(submittedQuery, { page: clampedPage });
      rootRef.current?.closest('.tool-drawer__body')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [loadNews, news?.page, news?.pageSize, news?.totalCount, submittedQuery],
  );

  const newsItems = news?.items ?? [];
  const isSearchMode = Boolean(submittedQuery || news?.mode === 'search');
  const metaLabel =
    news?.source ??
    (isSearchMode
      ? language === 'en'
        ? 'Search results'
        : '검색 결과'
      : language === 'en'
        ? 'Latest stock news'
        : '최신 주식 뉴스');
  const emptyCopy = isSearchMode
    ? language === 'en'
      ? 'No matching news.'
      : '검색 결과가 없습니다.'
    : language === 'en'
      ? 'No recent stock news found.'
      : '최신 주식 뉴스를 찾지 못했습니다.';
  const currentPage = news?.page ?? 1;
  const pageSize = news?.pageSize ?? NEWS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil((news?.totalCount ?? 0) / pageSize));
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="tool-drawer__news" ref={rootRef}>
      <form className="tool-drawer__news-search" onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            language === 'en' ? 'Ticker, company, theme, date' : '티커, 종목명, 테마, 날짜 검색'
          }
        />
        <button type="submit" disabled={status === 'loading'}>
          {language === 'en' ? 'Search' : '검색'}
        </button>
        <button type="button" onClick={handleRefresh} disabled={status === 'loading'}>
          {language === 'en' ? 'Refresh' : '새로고침'}
        </button>
      </form>

      <div className="tool-drawer__news-meta">
        <span>{metaLabel}</span>
        <em>
          {status === 'loading'
            ? language === 'en'
              ? 'updating'
              : '갱신 중'
            : news?.fetchedAt
              ? formatNewsTime(news.fetchedAt, language, dateBasis)
              : ''}
        </em>
      </div>

      {error ? <p className="tool-drawer__empty">{error}</p> : null}
      {!error && status !== 'loading' && newsItems.length === 0 ? (
        <p className="tool-drawer__empty">{emptyCopy}</p>
      ) : null}

      <div className={`tool-drawer__news-list${status === 'loading' ? ' is-loading' : ''}`}>
        {newsItems.map((article) => {
          const sourceLabel = /naver|네이버/i.test(article.source ?? '')
            ? language === 'en'
              ? 'Market news'
              : '주식 뉴스'
            : article.source;

          return (
            <a
              key={article.id}
              className="tool-drawer__news-card"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="tool-drawer__news-thumb">
                {article.thumbnailUrl ? (
                  <img
                    src={article.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              <div className="tool-drawer__news-body">
                <div className="tool-drawer__news-title-row">
                  <strong>{article.title}</strong>
                  {newArticleIds.has(article.id) ? (
                    <span className="tool-drawer__news-badge">NEW</span>
                  ) : null}
                </div>
                <span>
                  {sourceLabel}
                  {article.publishedAt
                    ? ` · ${formatNewsTime(article.publishedAt, language, dateBasis)}`
                    : ''}
                </span>
              </div>
            </a>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <nav
          className="tool-drawer__news-pagination"
          aria-label={language === 'en' ? 'News pages' : '뉴스 페이지'}
        >
          <button
            type="button"
            className="tool-drawer__news-page tool-drawer__news-page--nav"
            onClick={() => handleGoToPage(currentPage - 1)}
            disabled={currentPage <= 1 || status === 'loading'}
            aria-label={language === 'en' ? 'Previous page' : '이전 페이지'}
          >
            ‹
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              className={`tool-drawer__news-page${pageNumber === currentPage ? ' is-active' : ''}`}
              onClick={() => handleGoToPage(pageNumber)}
              disabled={status === 'loading'}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            className="tool-drawer__news-page tool-drawer__news-page--nav"
            onClick={() => handleGoToPage(currentPage + 1)}
            disabled={currentPage >= totalPages || status === 'loading'}
            aria-label={language === 'en' ? 'Next page' : '다음 페이지'}
          >
            ›
          </button>
        </nav>
      ) : null}
    </div>
  );
});
