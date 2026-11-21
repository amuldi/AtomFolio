// 유명인 tab: search famous investors, institutions and executives (curated directory, or anyone
// on SEC EDGAR), see their portfolio on the main stage (GuruStage, same atom as the app's own),
// press 비교하기 to set it against my portfolio, and read what they bought and sold — quarter
// over quarter from 13F, within two business days from Form 4.
//
// "Live" here means three things, because a 13F itself can't be real time (it is published up to
// 45 days after quarter end): the filing list is re-read every few minutes so a new filing shows
// up as soon as SEC has it; every holding carries a live price, today's move and the move since
// the filing's period end (that is what colors the electrons); and Form 4 / community rankings,
// which are far fresher, are read the same way.
//
// The bundled snapshot (src/data/guruPortfolios.json, lazy-loaded) paints instantly; the server
// then reads EDGAR live (/api/gurus/profile) and replaces it.
import { useEffect, useMemo, useRef, useState } from 'react';
import directory from '../../data/guruDirectory.json';
import photos from '../../data/guruPhotos.json';
import {
  buildGuruSummary,
  buildUserHoldings,
  compareWithGuru,
  normalizeTicker,
  searchGuruDirectory,
} from '../../lib/guruCompare.js';
import {
  describeChange,
  nextFilingDeadline,
  portfolioDrift,
  quoteTickers,
} from '../../lib/guruLive.js';
import { BuzzCard, TradeSummaryCard, TradesCard } from './GuruActivity.jsx';
import { GuruHoldingCard, GuruHoverCard, holdingDetail } from './GuruHoldingCards.jsx';
import { DartCards } from './GuruDart.jsx';
import { GuruResultCards } from './GuruResultCards.jsx';
import { Move, ResizeBox, TRADE_KIND, useFormatters } from './GuruShared.jsx';
import { GuruStage } from './GuruStage.jsx';

const SELECTION_KEY = 'atomfolio-guru-selection';
const PEOPLE = directory.people;
const LIVE_TTL_MS = 5 * 60_000; // how often the filing list is re-read
const QUOTE_REFRESH_MS = 60_000; // how often prices are re-read
const COMPARE_MS = 1700;

const CATEGORY_FILTERS = [
  ['all', '전체', 'All'],
  ['investor', '투자자', 'Investors'],
  ['community', '커뮤니티·밈', 'Community'],
  ['korea', '한국', 'Korea'],
  ['institution', '기관', 'Institutions'],
  ['executive', '기업인', 'Executives'],
];

// Where an entry's live data comes from: SEC by CIK (13F / Form 4), a fund's N-PORT by ticker,
// or a community's mention ranking.
function liveKeyOf(entry) {
  if (entry.kind === 'etf') return `etf:${entry.symbol}`;
  if (entry.kind === 'buzz') return `buzz:${entry.filter}`;
  if (entry.kind === 'dart') return `dart:${entry.corpCode}`;
  return `cik:${entry.cik}`;
}

function liveUrlOf(key) {
  const [type, value] = key.split(/:(.*)/);
  return `/api/gurus/profile?${type}=${encodeURIComponent(value)}`;
}

function readSelection() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? 'null');
    if (value?.type === 'directory' && PEOPLE.some((entry) => entry.id === value.id)) return value;
    if (value?.type === 'sec' && /^\d+$/.test(String(value.cik))) return value;
    if (value?.type === 'dart' && /^\d+$/.test(String(value.corpCode))) return value;
  } catch {
    // unreadable or blocked storage: start from the first entry
  }
  return { type: 'directory', id: PEOPLE[0].id };
}

function storeSelection(value) {
  try {
    window.localStorage.setItem(SELECTION_KEY, JSON.stringify(value));
  } catch {
    // not remembered; nothing else depends on it
  }
}

function initialsOf(entry, lang) {
  const name = String(entry.person?.[lang] ?? entry.person?.en ?? '').trim();
  if (/[가-힣]/.test(name)) return name.replace(/\s/g, '').slice(0, 1);
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function Avatar({ entry, lang, size = 'sm' }) {
  const image = photos[entry.id];
  return (
    <span
      className={`guru-panel__avatar is-${size}${image?.kind === 'logo' ? ' is-logo' : ''}`}
      aria-hidden="true"
    >
      {image ? <img src={image.src} alt="" loading="lazy" /> : <b>{initialsOf(entry, lang)}</b>}
    </span>
  );
}

// Electrons for an executive's own disclosed stakes: one per company, sized by the latest
// reported holding × the latest trade price we have for it.
function insiderItems(insider, quotes, lang) {
  return (insider?.issuers ?? []).map((issuer, index) => {
    const trades = insider.trades.filter((trade) => trade.ticker === issuer.ticker);
    const owned = trades.find((trade) => trade.ownedAfter != null)?.ownedAfter;
    const price = trades.find((trade) => trade.averagePrice)?.averagePrice;
    const latest = trades[0];
    const kind = latest ? TRADE_KIND[latest.kind] : null;
    return {
      id: `i-${index}`,
      label: issuer.ticker || issuer.name,
      stockName: issuer.name,
      ticker: issuer.ticker,
      shares: 1,
      weight: owned && price ? owned * price : 1,
      returnRate: quotes?.[issuer.ticker]?.dayPct ?? null,
      labelExtra: latest && kind ? `${kind[lang]} ${String(latest.date).slice(5)}` : null,
    };
  });
}

// Live prices for the holdings on screen, re-read every minute while the tab is visible.
// `since` is the filing's period end, so each quote also says how far the stock has moved since.
function useGuruQuotes(tickers, since) {
  const key = `${since ?? ''}|${tickers.join(',')}`;
  const [state, setState] = useState({ key: '', quotes: {}, at: 0, status: 'idle' });
  useEffect(() => {
    if (!tickers.length) return undefined;
    let alive = true;
    let timer = 0;
    const schedule = () => {
      if (alive) timer = window.setTimeout(load, QUOTE_REFRESH_MS);
    };
    function load() {
      if (document.hidden) {
        schedule();
        return;
      }
      const url = `/api/gurus/quotes?symbols=${encodeURIComponent(tickers.join(','))}${since ? `&since=${since}` : ''}`;
      fetch(url)
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
        )
        .then((payload) => {
          if (alive) setState({ key, quotes: payload.quotes ?? {}, at: Date.now(), status: 'ok' });
        })
        .catch(() => {
          if (alive) setState((current) => ({ ...current, key, status: 'error' }));
        })
        .finally(schedule);
    }
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // tickers/since are folded into key
  }, [key]);
  if (!tickers.length) return { quotes: {}, at: 0, status: 'idle' };
  return state.key === key ? state : { quotes: {}, at: 0, status: 'loading' };
}

// What "live" means for this person, in plain words, with how the holdings have moved since.
function LiveCard({ fund, insider, drift, quoteStatus, language }) {
  const en = language === 'en';
  if (!fund && !insider) return null;
  const isBuzz = fund?.source === 'ApeWisdom';
  const isFiling = fund && !isBuzz;
  const next = isFiling && fund.source === '13F' ? nextFilingDeadline(fund.period) : null;
  let note;
  if (isBuzz) {
    note = en
      ? 'The stocks this community talks about most in the last 24 hours. Mention counts are re-read every few minutes.'
      : '지난 24시간 동안 이 커뮤니티에서 가장 많이 언급된 종목이에요. 언급 수는 몇 분마다 새로 읽어 와요.';
  } else if (isFiling) {
    note = en
      ? `${fund.source} filings come out up to 45 days after a quarter ends, so the holdings are as of ${fund.period}. Prices are live, and new filings are checked every 5 minutes${next ? ` (the next is due around ${next})` : ''}.`
      : `${fund.source} 공시는 분기가 끝나고 최대 45일 뒤에야 나와서, 보유 내역은 ${fund.period} 기준이에요. 가격은 지금 시세를 반영했고, 새 공시는 5분마다 확인해요${next ? ` (다음 공시는 ${next}쯤)` : ''}.`;
  } else {
    note = en
      ? `Form 4 is filed within two business days of a trade, the fastest public record there is. "Now" compares today's price with the price of that trade.`
      : 'Form 4는 거래 후 영업일 2일 안에 공개돼요. 일반에 공개되는 기록 중 가장 빠른 편이에요. "지금"은 그 거래 가격 대비 오늘 시세예요.';
  }
  const showDrift = (isFiling || isBuzz) && (drift.sincePct != null || drift.dayPct != null);
  return (
    <div className="guru-compare__card guru-live">
      {showDrift ? (
        <div className="guru-live__moves">
          {isFiling ? (
            <div>
              <em>{en ? `Since ${fund.period}` : `${fund.period} 이후`}</em>
              <Move value={drift.sincePct} digits={1} />
            </div>
          ) : null}
          <div>
            <em>{en ? 'Today' : '오늘'}</em>
            <Move value={drift.dayPct} digits={1} />
          </div>
          <small>
            {quoteStatus === 'loading'
              ? en
                ? 'Loading prices…'
                : '시세 불러오는 중…'
              : en
                ? `top ${Math.round(drift.coverage * 100)}% of holdings priced`
                : `상위 종목의 ${Math.round(drift.coverage * 100)}% 반영`}
          </small>
        </div>
      ) : null}
      <p>{note}</p>
      {isFiling || isBuzz ? (
        <p className="guru-live__key">
          <i className="is-up" />
          {en ? 'Up' : '오른 종목'}
          <i className="is-down" />
          {en ? 'Down' : '내린 종목'}
          <span>{en ? '· size = weight' : '· 크기 = 비중'}</span>
        </p>
      ) : null}
      {fund?.url ? (
        <small className="guru-live__filed">{`${fund.source ?? '13F'} · ${en ? 'filed' : '제출'} ${fund.filed ?? ''}`}</small>
      ) : null}
    </div>
  );
}

function useCountUp(target, running) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start - 650) / 1000));
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, target]);
  return value;
}

export function GuruPanel({ analyticsSummary, activePortfolio, language, onInteract }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const fmt = useFormatters(en);
  const [snapshot, setSnapshot] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selection, setSelection] = useState(readSelection);
  const [mode, setMode] = useState('preview'); // 'preview' | 'animating' | 'result'
  const [live, setLive] = useState({});
  const [secSearch, setSecSearch] = useState({ query: '', status: 'idle', results: [] });
  const [picked, setPicked] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [burstKey, setBurstKey] = useState(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  const portfolioKey = activePortfolio?.id ?? null;
  const [seenPortfolioKey, setSeenPortfolioKey] = useState(portfolioKey);
  if (seenPortfolioKey !== portfolioKey) {
    setSeenPortfolioKey(portfolioKey);
    setMode('preview');
    setPicked(null);
    setHovered(null);
  }

  useEffect(() => {
    let alive = true;
    import('../../data/guruPortfolios.json').then((module) => {
      if (alive) setSnapshot(module.default);
    });
    return () => {
      alive = false;
    };
  }, []);

  const entry = useMemo(() => {
    if (selection.type === 'directory') {
      return PEOPLE.find((candidate) => candidate.id === selection.id) ?? PEOPLE[0];
    }
    if (selection.type === 'dart') {
      return (
        PEOPLE.find((candidate) => candidate.corpCode === String(selection.corpCode)) ?? {
          id: `dart-${selection.corpCode}`,
          kind: 'dart',
          category: 'korea',
          corpCode: String(selection.corpCode),
          person: { ko: selection.name, en: selection.name },
          entity: `KRX ${selection.stockCode ?? ''}`.trim(),
        }
      );
    }
    const known = PEOPLE.find((candidate) => candidate.cik === String(selection.cik));
    if (known) return known;
    return {
      id: `cik-${selection.cik}`,
      kind: 'sec',
      cik: String(selection.cik),
      person: { ko: selection.name, en: selection.name },
      entity: `SEC CIK ${selection.cik}`,
    };
  }, [selection]);

  const loadLive = (key, { force = false } = {}) => {
    const current = liveRef.current[key];
    if (
      !force &&
      current &&
      (current.status === 'loading' || Date.now() - (current.at ?? 0) < LIVE_TTL_MS)
    )
      return;
    setLive((state) => ({ ...state, [key]: { ...state[key], status: 'loading' } }));
    // A manual refresh (button, nucleus click) must not be answered from the browser's HTTP cache.
    fetch(liveUrlOf(key), { cache: force ? 'reload' : 'default' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 503 && /^(sec|dart)-not-configured$/.test(payload.code)) {
          setLive((state) => ({ ...state, [key]: { status: 'off', at: Date.now() } }));
          return;
        }
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        setLive((state) => ({
          ...state,
          [key]: { status: 'ok', at: Date.now(), profile: payload },
        }));
      })
      .catch((error) => {
        setLive((state) => ({
          ...state,
          [key]: { ...state[key], status: 'error', at: Date.now(), error: error.message },
        }));
      });
  };

  // One live lookup per selection (loadLive reads current state through liveRef).
  const liveKey = liveKeyOf(entry);
  useEffect(() => {
    loadLive(liveKey);
    // A new filing shows up within minutes: re-read the filing list on a timer while visible.
    const timer = window.setInterval(() => {
      if (!document.hidden) loadLive(liveKey, { force: true });
    }, LIVE_TTL_MS);
    return () => window.clearInterval(timer);
  }, [liveKey]);

  const trimmedQuery = query.trim();
  useEffect(() => {
    if (trimmedQuery.length < 2 && !/[가-힣]/.test(trimmedQuery)) return undefined;
    if (trimmedQuery.length < 1) return undefined;
    const timer = setTimeout(() => {
      setSecSearch({ query: trimmedQuery, status: 'loading', results: [] });
      fetch(`/api/gurus/search?q=${encodeURIComponent(trimmedQuery)}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          setSecSearch({ query: trimmedQuery, status: 'ok', results: payload.results ?? [] });
        })
        .catch(() => setSecSearch({ query: trimmedQuery, status: 'error', results: [] }));
    }, 450);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  const matches = useMemo(
    () =>
      searchGuruDirectory(PEOPLE, snapshot, query).filter(
        ({ entry: candidate }) => category === 'all' || candidate.category === category,
      ),
    [category, query, snapshot],
  );
  const directoryCiks = useMemo(
    () => new Set(PEOPLE.map((candidate) => candidate.cik).filter(Boolean)),
    [],
  );
  const directoryCorps = useMemo(
    () => new Set(PEOPLE.map((candidate) => candidate.corpCode).filter(Boolean)),
    [],
  );
  const secResults =
    trimmedQuery.length >= 1 && secSearch.query === trimmedQuery
      ? secSearch.results.filter((result) =>
          result.source === 'dart'
            ? !directoryCorps.has(result.corpCode)
            : !directoryCiks.has(result.cik),
        )
      : [];

  const liveState = live[liveKey];
  const profile = liveState?.status === 'ok' ? liveState.profile : null;
  const dart = entry.kind === 'dart' && profile?.owners ? profile : null;
  const fund = dart ? null : profile ? profile.fund : (snapshot?.funds?.[entry.id] ?? null);
  const insider = dart ? null : profile ? profile.insider : (snapshot?.insiders?.[entry.id] ?? null);
  const guru = fund ? { ...fund, id: entry.id, person: entry.person, entity: entry.entity } : null;

  const userHoldings = useMemo(
    () => buildUserHoldings(analyticsSummary?.positions),
    [analyticsSummary],
  );
  const result = useMemo(
    () => (guru ? compareWithGuru(userHoldings, guru) : null),
    [guru, userHoldings],
  );
  const summary = useMemo(
    () => (result && mode === 'result' ? buildGuruSummary(result, guru, language) : null),
    [guru, language, mode, result],
  );
  const canCompare = Boolean(guru && userHoldings.length);

  // Live prices: relative to the filing's period end for 13F / N-PORT, to the previous close
  // otherwise (a community ranking or an executive's stakes have no "snapshot" to measure from).
  const isFiling = Boolean(fund && fund.source !== 'ApeWisdom');
  const tickers = useMemo(() => quoteTickers(fund, insider), [fund, insider]);
  const quoteState = useGuruQuotes(tickers, isFiling ? fund.period : null);
  const quotes = quoteState.quotes;
  const drift = useMemo(() => portfolioDrift(fund?.holdings, quotes), [fund, quotes]);

  // Atom items for the main stage. Electron color = how far the stock has moved (red up, blue
  // down); the label adds what the person did with it last quarter.
  const guruItems = useMemo(() => {
    if (dart) {
      // Owners as electrons: size and label are the stake in the company, in percent.
      return dart.owners.owners.slice(0, 15).map((owner, index) => ({
        id: `d-${index}`,
        label: owner.name,
        stockName: owner.name,
        ticker: '',
        shares: 1,
        weight: owner.rate,
        share: owner.rate / 100,
      }));
    }
    if (guru) {
      const changeByTicker = new Map(
        (fund?.changes ?? []).map((change) => [change.ticker, change]),
      );
      const basis = isFiling ? 'sincePct' : 'dayPct';
      return guru.holdings.map((holding, index) => ({
        id: `g-${index}`,
        label: holding.name?.[lang] ?? holding.ticker,
        stockName: holding.name?.en ?? holding.ticker,
        ticker: holding.ticker.startsWith('CUSIP:') ? '' : holding.ticker,
        shares: 1,
        weight: holding.weight,
        share: holding.weight,
        returnRate: quotes[holding.ticker]?.[basis] ?? null,
        labelExtra: describeChange(changeByTicker.get(holding.ticker), language) || null,
      }));
    }
    return insiderItems(insider, quotes, lang);
  }, [dart, fund, guru, insider, isFiling, lang, language, quotes]);
  const myItems = useMemo(
    () =>
      (analyticsSummary?.positions ?? []).map((position, index) => ({
        id: `m-${index}`,
        label: position.label,
        stockName: position.label,
        ticker: normalizeTicker(position.code),
        shares: 1,
        weight: position.weight,
        returnRate: position.returnRate,
      })),
    [analyticsSummary],
  );
  const sharedTickers = useMemo(
    () => new Set(result?.shared.map((holding) => holding.ticker) ?? []),
    [result],
  );
  const counted = useCountUp(result?.commonShare ?? 0, mode !== 'preview');
  const portfolioName =
    String(activePortfolio?.fileName ?? '').replace(/\.(csv|tsv|txt)$/i, '') ||
    (en ? 'My portfolio' : '내 포트폴리오');
  const person = entry.person[lang];

  const select = (next) => {
    onInteract?.();
    storeSelection(next);
    setSelection(next);
    setMode('preview');
    setPicked(null);
    setHovered(null);
  };

  // Center click on the stage: re-read SEC, with light running out to every electron.
  const refreshFromStage = () => {
    onInteract?.();
    setBurstKey((value) => value + 1);
    loadLive(liveKey, { force: true });
  };

  const startCompare = () => {
    if (!canCompare || mode !== 'preview') return;
    onInteract?.();
    setMode('animating');
    window.setTimeout(
      () => setMode((current) => (current === 'animating' ? 'result' : current)),
      COMPARE_MS,
    );
  };

  const driftValue = isFiling ? drift.sincePct : drift.dayPct;
  const tag =
    mode === 'preview'
      ? {
          title: person,
          value:
            driftValue == null
              ? null
              : `${driftValue > 0.005 ? '▲' : driftValue < -0.005 ? '▼' : ''}${Math.abs(driftValue).toFixed(1)}%`,
          tone:
            driftValue == null || Math.abs(driftValue) < 0.005
              ? 'flat'
              : driftValue > 0
                ? 'up'
                : 'down',
          note: dart
            ? `${entry.entity} · DART ${dart.owners.settled ?? ''}`
            : fund
            ? `${entry.entity} · ${fund.source === 'ApeWisdom' ? (en ? 'live' : '실시간') : en ? `${fund.source ?? '13F'} ${fund.period} → now` : `${fund.source ?? '13F'} ${fund.period} 이후`}`
            : insider
              ? `${entry.entity} · Form 4 ${insider.latestFiled}`
              : entry.entity,
        }
      : {
          title: en ? 'Common' : '공통',
          tone: 'flat',
          value: fmt.percent(counted),
          note: `${portfolioName} ↔ ${person}`,
        };

  const detailFor = (target) =>
    target
      ? holdingDetail({
          picked: target,
          guru,
          fund,
          insider,
          userHoldings,
          result,
          quotes,
          language,
        })
      : null;
  const pickedDetail = detailFor(picked);
  const hoveredDetail =
    !picked || (hovered && hovered.ticker !== picked.ticker) ? detailFor(hovered) : null;

  const image = photos[entry.id];
  const liveText =
    liveState?.status === 'loading'
      ? en
        ? 'Updating…'
        : '업데이트 중…'
      : profile
        ? `${dart ? 'DART' : fund?.source === 'ApeWisdom' ? 'ApeWisdom' : 'SEC'} · ${new Date(liveState.at).toLocaleTimeString(en ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}`
        : snapshot
          ? `${en ? 'Snapshot' : '스냅샷'} ${snapshot.generatedAt}`
          : '';

  return (
    <section className="tool-drawer__overview-card tool-drawer__overview-card--wide guru-compare guru-panel">
      {guruItems.length ? (
        <GuruStage
          guruItems={guruItems}
          myItems={myItems}
          captions={{ mine: portfolioName, guru: person }}
          mode={canCompare ? mode : 'preview'}
          sharedTickers={sharedTickers}
          selectedTicker={picked?.ticker ?? null}
          hovered={hovered}
          burstKey={burstKey}
          onCenterClick={refreshFromStage}
          onSelectAtom={(info) => {
            // A click hides the peek and opens the full card.
            setHovered(null);
            setPicked(info);
          }}
          onHoverAtom={setHovered}
          tag={tag}
          ariaLabel={{
            guru: en ? `${person}'s portfolio` : `${person}의 포트폴리오`,
            mine: en ? 'My portfolio' : '내 포트폴리오',
          }}
        />
      ) : null}

      {pickedDetail ? (
        <GuruHoldingCard
          picked={picked}
          detail={pickedDetail}
          fund={fund}
          language={language}
          onClose={() => setPicked(null)}
        />
      ) : null}
      <GuruHoverCard hovered={hovered} detail={hoveredDetail} language={language} />

      <div className="guru-panel__search">
        <input
          id="guru-panel-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={en ? 'Search people, funds, stocks' : '이름, 운용사, 종목 검색'}
          aria-label={en ? 'Search' : '검색'}
        />
        <div className="guru-panel__filters" role="group">
          {CATEGORY_FILTERS.map(([key, ko, enLabel]) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {en ? enLabel : ko}
            </button>
          ))}
        </div>
      </div>

      <ResizeBox
        storageKey="atomfolio-guru-list-height"
        initial={240}
        min={96}
        max={720}
        label={en ? 'Drag to resize the list' : '끌어서 목록 크기 조절'}
      >
        <div className="guru-panel__list" role="list">
          {matches.map(({ entry: candidate, holding }) => {
            const isActive = candidate.id === entry.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="listitem"
                aria-pressed={isActive}
                className={`guru-panel__person${isActive ? ' is-active' : ''}`}
                onClick={() => select({ type: 'directory', id: candidate.id })}
              >
                <Avatar entry={candidate} lang={lang} />
                <span className="guru-panel__person-text">
                  <strong>{candidate.person[lang]}</strong>
                  <em>
                    {holding
                      ? holding.source === 'holding'
                        ? `${holding.name?.[lang] ?? holding.ticker} ${(holding.weight * 100).toFixed(1)}%`
                        : holding.ticker
                      : candidate.entity}
                  </em>
                </span>
              </button>
            );
          })}
          {secResults.map((result) => (
            <button
              key={`sec-${result.cik ?? result.corpCode}`}
              type="button"
              role="listitem"
              className={`guru-panel__person is-sec${
                (
                  result.source === 'dart'
                    ? selection.type === 'dart' && String(selection.corpCode) === result.corpCode
                    : selection.type === 'sec' && String(selection.cik) === result.cik
                )
                  ? ' is-active'
                  : ''
              }`}
              onClick={() =>
                select(
                  result.source === 'dart'
                    ? {
                        type: 'dart',
                        corpCode: result.corpCode,
                        name: result.name,
                        stockCode: result.stockCode,
                      }
                    : { type: 'sec', cik: result.cik, name: result.name },
                )
              }
            >
              <Avatar
                entry={{
                  id: `sec-${result.cik ?? result.corpCode}`,
                  person: { ko: result.name, en: result.name },
                }}
                lang="en"
              />
              <span className="guru-panel__person-text">
                <strong>{result.name}</strong>
                <em>
                  {result.source === 'dart'
                    ? `KRX ${result.stockCode}`
                    : `SEC · ${result.tickers || `CIK ${result.cik}`}`}
                </em>
              </span>
            </button>
          ))}
          {trimmedQuery.length >= 1 && secSearch.query !== trimmedQuery ? (
            <span className="guru-panel__searching">{en ? 'Searching SEC…' : 'SEC 검색 중…'}</span>
          ) : null}
        </div>
      </ResizeBox>

      <div className="guru-panel__profile">
        <Avatar entry={entry} lang={lang} size="lg" />
        <div className="guru-panel__profile-text">
          <strong>{person}</strong>
          <em>{entry.entity}</em>
          <button
            type="button"
            className={`guru-panel__live${profile ? ' is-live' : ''}`}
            onClick={() => loadLive(liveKey, { force: true })}
            disabled={liveState?.status === 'loading'}
            title={en ? 'Refresh' : '새로고침'}
          >
            {liveText}
          </button>
        </div>
        {guru && mode === 'preview' ? (
          <button
            type="button"
            className="guru-panel__compare"
            onClick={startCompare}
            disabled={!canCompare}
          >
            <span aria-hidden="true">⚛</span>
            {en ? 'Compare' : '비교하기'}
          </button>
        ) : null}
      </div>

      {guru && result && mode === 'result' ? (
        <GuruResultCards guru={guru} result={result} summary={summary} language={language} />
      ) : null}
      <LiveCard
        fund={fund}
        insider={insider}
        drift={drift}
        quoteStatus={quoteState.status}
        language={language}
      />
      <DartCards dart={dart} language={language} />
      <TradeSummaryCard fund={fund} quotes={quotes} language={language} />
      <BuzzCard fund={fund} language={language} />
      <TradesCard key={entry.id} insider={insider} quotes={quotes} language={language} />

      {!fund && !insider && !dart ? (
        <p className="guru-compare__empty-state">
          {liveState?.status === 'loading' || !snapshot
            ? en
              ? 'Loading…'
              : '불러오는 중…'
            : en
              ? 'No public portfolio on file.'
              : '공개된 포트폴리오가 없습니다.'}
        </p>
      ) : null}

      <details className="guru-compare__about">
        <summary>{en ? 'Sources' : '출처'}</summary>
        <ul>
          {fund?.url ? (
            <li>
              <a href={fund.url} target="_blank" rel="noreferrer">{`SEC 13F ${fund.accession}`}</a>
              {` · ${fund.period}`}
            </li>
          ) : null}
          {dart ? (
            <li>
              <a
                href={`https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(entry.person.ko)}`}
                target="_blank"
                rel="noreferrer"
              >
                DART 전자공시
              </a>
              {` · ${dart.owners.settled ?? ''}`}
            </li>
          ) : null}
          {insider?.trades?.[0]?.url ? (
            <li>
              <a
                href={insider.trades[0].url}
                target="_blank"
                rel="noreferrer"
              >{`SEC Form 4 ${insider.latestFiled}`}</a>
            </li>
          ) : null}
          {image ? (
            <li>
              {image.kind === 'photo' ? (
                <>
                  {en ? 'Photo: ' : '사진: '}
                  <a href={image.sourceUrl} target="_blank" rel="noreferrer">
                    {image.author}
                  </a>
                  {` · ${image.license}`}
                </>
              ) : (
                `${en ? 'Logo' : '로고'}: ${image.author} (${en ? 'trademark of its owner' : '각 소유자의 상표'})`
              )}
            </li>
          ) : null}
          <li>
            {en
              ? 'Public filings, not investment advice.'
              : '공개 공시 정보이며 투자 권유가 아닙니다.'}
          </li>
        </ul>
      </details>
    </section>
  );
}
