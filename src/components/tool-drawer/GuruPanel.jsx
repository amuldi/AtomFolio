// 유명인 tab: search famous investors, institutions and executives (curated directory, or anyone
// on SEC EDGAR), see their portfolio on the main stage (GuruStage, same atom as the app's own),
// press 비교하기 to set it against my portfolio, and read what they bought and sold — quarter
// over quarter from 13F, within two business days from Form 4.
//
// The bundled snapshot (src/data/guruPortfolios.json, lazy-loaded) paints instantly; the server
// then reads EDGAR live (/api/gurus/profile) and replaces it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import directory from '../../data/guruDirectory.json';
import photos from '../../data/guruPhotos.json';
import {
  REGION_LABELS,
  SECTOR_LABELS,
  buildGuruInsights,
  buildUserHoldings,
  compareWithGuru,
  normalizeTicker,
  searchGuruDirectory,
} from '../../lib/guruCompare.js';
import { GuruResultCards } from './GuruResultCards.jsx';
import { GuruStage } from './GuruStage.jsx';

const SELECTION_KEY = 'atomfolio-guru-selection';
const LIST_HEIGHT_KEY = 'atomfolio-guru-list-height';
const LIST_MIN = 120;
const LIST_MAX = 720;
const PEOPLE = directory.people;
const LIVE_TTL_MS = 5 * 60_000;
const COMPARE_MS = 1700;

const CATEGORY_FILTERS = [
  ['all', '전체', 'All'],
  ['investor', '투자자', 'Investors'],
  ['community', '커뮤니티·밈', 'Community'],
  ['institution', '기관', 'Institutions'],
  ['executive', '기업인', 'Executives'],
];

// Where an entry's live data comes from: SEC by CIK (13F / Form 4), a fund's N-PORT by ticker,
// or a community's mention ranking.
function liveKeyOf(entry) {
  if (entry.kind === 'etf') return `etf:${entry.symbol}`;
  if (entry.kind === 'buzz') return `buzz:${entry.filter}`;
  return `cik:${entry.cik}`;
}

function liveUrlOf(key) {
  const [type, value] = key.split(/:(.*)/);
  return `/api/gurus/profile?${type}=${encodeURIComponent(value)}`;
}

const TRADE_KIND = {
  buy: { ko: '매수', en: 'Buy', tone: 'is-buy' },
  sell: { ko: '매도', en: 'Sell', tone: 'is-sell' },
  new: { ko: '신규', en: 'New', tone: 'is-buy' },
  added: { ko: '추가', en: 'Added', tone: 'is-buy' },
  trimmed: { ko: '축소', en: 'Trimmed', tone: 'is-sell' },
  soldOut: { ko: '전량 매도', en: 'Sold out', tone: 'is-sell' },
  grant: { ko: '부여', en: 'Grant', tone: '' },
  exercise: { ko: '행사', en: 'Exercise', tone: '' },
  conversion: { ko: '전환', en: 'Conversion', tone: '' },
  tax: { ko: '세금 처분', en: 'Tax', tone: '' },
  gift: { ko: '증여', en: 'Gift', tone: '' },
  disposition: { ko: '반환', en: 'To issuer', tone: '' },
  other: { ko: '기타', en: 'Other', tone: '' },
};

function readSelection() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? 'null');
    if (value?.type === 'directory' && PEOPLE.some((entry) => entry.id === value.id)) return value;
    if (value?.type === 'sec' && /^\d+$/.test(String(value.cik))) return value;
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
    <span className={`guru-panel__avatar is-${size}${image?.kind === 'logo' ? ' is-logo' : ''}`} aria-hidden="true">
      {image ? <img src={image.src} alt="" loading="lazy" /> : <b>{initialsOf(entry, lang)}</b>}
    </span>
  );
}

function useFormatters(en) {
  return useMemo(() => {
    const compact = new Intl.NumberFormat(en ? 'en-US' : 'ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
    const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
    return {
      shares: (value) => (Number.isFinite(value) ? compact.format(value) : '-'),
      usd: (value) => (Number.isFinite(value) ? usd.format(value) : '-'),
      price: (value) => (Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}` : '-'),
      percent: (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-'),
    };
  }, [en]);
}

function KindBadge({ kind, lang }) {
  const meta = TRADE_KIND[kind] ?? TRADE_KIND.other;
  return <span className={`guru-panel__kind ${meta.tone}`}>{meta[lang]}</span>;
}

function ChangesCard({ fund, language }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const fmt = useFormatters(en);
  if (!fund?.previous || !fund.changes?.length) return null;
  const counts = fund.changeCounts ?? {};
  return (
    <div className="guru-compare__card guru-panel__activity">
      <div className="guru-compare__subhead">
        <span>{en ? 'Last quarter' : '지난 분기 매매'}</span>
        <em>{`${fund.previous.period} → ${fund.period}`}</em>
      </div>
      <div className="guru-panel__counts">
        {['new', 'added', 'trimmed', 'soldOut'].map((kind) => (
          <span key={kind} className={TRADE_KIND[kind].tone}>
            {TRADE_KIND[kind][lang]} <b>{counts[kind] ?? 0}</b>
          </span>
        ))}
      </div>
      <ul className="guru-panel__rows">
        {fund.changes.map((change) => {
          const delta = change.sharesBefore ? change.sharesAfter / change.sharesBefore - 1 : null;
          return (
            <li key={`${change.cusip}-${change.kind}`}>
              <KindBadge kind={change.kind} lang={lang} />
              <span className="guru-panel__what">
                <strong>{change.name?.[lang]}</strong>
                <small>{change.ticker.startsWith('CUSIP:') ? '' : change.ticker}</small>
              </span>
              <span className="guru-panel__how">
                {`${fmt.shares(change.sharesBefore)} → ${fmt.shares(change.sharesAfter)}${
                  delta != null && change.sharesAfter ? ` (${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%)` : ''
                }`}
                <em>{`≈${fmt.usd(change.tradeValueUsd)} · ${fmt.percent(change.weightAfter)}`}</em>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Community mention ranking (not holdings): rank and mentions now vs 24 hours ago.
function BuzzCard({ fund, language }) {
  const en = language === 'en';
  if (fund?.source !== 'ApeWisdom') return null;
  return (
    <div className="guru-compare__card guru-panel__activity">
      <div className="guru-compare__subhead">
        <span>{en ? 'Most mentioned · 24h' : '언급 순위 · 24시간'}</span>
        <em>ApeWisdom</em>
      </div>
      <ul className="guru-panel__rows">
        {fund.holdings.slice(0, 10).map((holding) => {
          const delta = holding.mentions - holding.mentions24hAgo;
          const moved = holding.rank24hAgo ? holding.rank24hAgo - holding.rank : null;
          return (
            <li key={holding.ticker}>
              <span className="guru-panel__rank">{holding.rank}</span>
              <span className="guru-panel__what">
                <strong>{holding.ticker}</strong>
                <small>{holding.name?.[en ? 'en' : 'ko']}</small>
              </span>
              <span className="guru-panel__how">
                {`${holding.mentions.toLocaleString()}${en ? ' mentions' : '회'}`}
                <em className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>
                  {`${delta >= 0 ? '+' : ''}${delta.toLocaleString()}${moved ? ` · ${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}` : ''}`}
                </em>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TradesCard({ insider, language }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const fmt = useFormatters(en);
  const [expanded, setExpanded] = useState(false);
  if (!insider?.trades?.length) return null;
  const rows = expanded ? insider.trades : insider.trades.slice(0, 10);
  return (
    <div className="guru-compare__card guru-panel__activity">
      <div className="guru-compare__subhead">
        <span>{en ? 'Latest trades' : '최근 매매'}</span>
        <em>{`Form 4 · ${insider.latestFiled}`}</em>
      </div>
      <ul className="guru-panel__rows">
        {rows.map((trade) => (
          <li key={`${trade.date}-${trade.ticker}-${trade.kind}-${trade.filed}`}>
            <KindBadge kind={trade.kind} lang={lang} />
            <span className="guru-panel__what">
              <strong>{trade.ticker || trade.issuer}</strong>
              <small>{trade.date}</small>
            </span>
            <span className="guru-panel__how">
              {`${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''}`}
              <em>{[trade.valueUsd ? fmt.usd(trade.valueUsd) : null, trade.plan10b5 ? '10b5-1' : null].filter(Boolean).join(' · ')}</em>
            </span>
          </li>
        ))}
      </ul>
      {insider.trades.length > 10 ? (
        <button type="button" className="guru-panel__more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? (en ? 'Less' : '접기') : en ? `All ${insider.trades.length}` : `전체 ${insider.trades.length}건`}
        </button>
      ) : null}
    </div>
  );
}

// Electrons for an executive's own disclosed stakes: one per company, sized by the latest
// reported holding × the latest trade price we have for it.
function insiderItems(insider) {
  return (insider?.issuers ?? []).map((issuer, index) => {
    const trades = insider.trades.filter((trade) => trade.ticker === issuer.ticker);
    const owned = trades.find((trade) => trade.ownedAfter != null)?.ownedAfter;
    const price = trades.find((trade) => trade.averagePrice)?.averagePrice;
    return {
      id: `i-${index}`,
      label: issuer.ticker || issuer.name,
      stockName: issuer.name,
      ticker: issuer.ticker,
      shares: 1,
      weight: owned && price ? owned * price : 1,
    };
  });
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

function readListHeight() {
  try {
    const value = Number(window.localStorage.getItem(LIST_HEIGHT_KEY));
    return Number.isFinite(value) && value >= LIST_MIN ? Math.min(LIST_MAX, value) : 240;
  } catch {
    return 240;
  }
}

// Detail for an electron clicked on the stage — theirs or mine — placed next to the click.
function HoldingCard({ picked, guru, fund, insider, userHoldings, result, language, onClose }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const fmt = useFormatters(en);
  const cardRef = useRef(null);

  useEffect(() => {
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && cardRef.current?.contains(event.target)) return;
      onClose();
    };
    // Next tick, so the click that opened the card doesn't close it.
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', close);
      window.addEventListener('keydown', close);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  const theirs = guru?.holdings.find((holding) => holding.ticker === picked.ticker) ?? null;
  const mine = userHoldings.find((holding) => holding.ticker === picked.ticker) ?? null;
  const change = fund?.changes?.find((candidate) => candidate.ticker === picked.ticker) ?? null;
  const trades = (insider?.trades ?? []).filter((trade) => trade.ticker === picked.ticker).slice(0, 3);
  const shared = result?.shared.find((holding) => holding.ticker === picked.ticker) ?? null;
  const base = theirs ?? mine;
  const name = base?.name?.[lang] ?? picked.label;
  const sector = base?.sector ? SECTOR_LABELS[base.sector]?.[lang] : null;
  const region = base?.region ? REGION_LABELS[base.region]?.[lang] : null;
  const person = guru?.person?.[lang] ?? '';
  const width = 260;
  const left = Math.min(Math.max(12, picked.x + 18), window.innerWidth - width - 12);
  const top = Math.min(Math.max(12, picked.y - 40), window.innerHeight - 320);

  return createPortal(
    <aside ref={cardRef} className="guru-card" style={{ left, top, width }} role="dialog" aria-label={name}>
      <button type="button" className="guru-card__close" onClick={onClose} aria-label={en ? 'Close' : '닫기'}>
        ×
      </button>
      <header>
        <strong>{name}</strong>
        <span>{[picked.ticker && !picked.ticker.startsWith('CUSIP:') ? picked.ticker : null, sector, region].filter(Boolean).join(' · ')}</span>
      </header>
      {theirs ? (
        <div className="guru-card__metric">
          <span>{person}</span>
          <b>{fmt.percent(theirs.weight)}</b>
          <i style={{ '--w': `${Math.min(100, theirs.weight * 100 * 2.5)}%` }} />
          {guru?.totalValueUsd ? <em>{`≈ ${fmt.usd(theirs.weight * guru.totalValueUsd)}`}</em> : null}
          {theirs.mentions ? <em>{en ? 'share of mentions' : '언급 비중'}</em> : null}
        </div>
      ) : null}
      {mine ? (
        <div className="guru-card__metric is-mine">
          <span>{en ? 'Me' : '나'}</span>
          <b>{fmt.percent(mine.weight)}</b>
          <i style={{ '--w': `${Math.min(100, mine.weight * 100 * 2.5)}%` }} />
          {mine.returnRate != null ? (
            <em className={mine.returnRate >= 0 ? 'positive' : 'negative'}>
              {`${mine.returnRate >= 0 ? '▲' : '▼'}${Math.abs(mine.returnRate).toFixed(1)}%`}
            </em>
          ) : null}
        </div>
      ) : null}
      {theirs?.mentions ? (
        <p className="guru-card__line">
          {`${theirs.mentions.toLocaleString()}${en ? ' mentions in 24h' : '회 언급 (24시간)'}`}
          <small>{`#${theirs.rank}`}</small>
        </p>
      ) : null}
      {shared ? <p className="guru-card__shared">{en ? 'Held by both' : '둘 다 보유 중'}</p> : null}
      {change ? (
        <p className="guru-card__line">
          <KindBadge kind={change.kind} lang={lang} />
          {`${fmt.shares(change.sharesBefore)} → ${fmt.shares(change.sharesAfter)}${en ? ' sh' : '주'}`}
          <small>{`${fund.previous.period} → ${fund.period}`}</small>
        </p>
      ) : null}
      {trades.map((trade) => (
        <p key={`${trade.date}-${trade.kind}`} className="guru-card__line">
          <KindBadge kind={trade.kind} lang={lang} />
          {`${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''}`}
          <small>{trade.date}</small>
        </p>
      ))}
    </aside>,
    document.body,
  );
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
  const [burstKey, setBurstKey] = useState(0);
  const [listHeight, setListHeight] = useState(readListHeight);
  const liveRef = useRef(live);
  liveRef.current = live;

  const portfolioKey = activePortfolio?.id ?? null;
  const [seenPortfolioKey, setSeenPortfolioKey] = useState(portfolioKey);
  if (seenPortfolioKey !== portfolioKey) {
    setSeenPortfolioKey(portfolioKey);
    setMode('preview');
    setPicked(null);
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
    if (!force && current && (current.status === 'loading' || Date.now() - (current.at ?? 0) < LIVE_TTL_MS)) return;
    setLive((state) => ({ ...state, [key]: { ...state[key], status: 'loading' } }));
    // A manual refresh (button, nucleus click) must not be answered from the browser's HTTP cache.
    fetch(liveUrlOf(key), { cache: force ? 'reload' : 'default' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 503 && payload.code === 'sec-not-configured') {
          setLive((state) => ({ ...state, [key]: { status: 'off', at: Date.now() } }));
          return;
        }
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        setLive((state) => ({ ...state, [key]: { status: 'ok', at: Date.now(), profile: payload } }));
      })
      .catch((error) => {
        setLive((state) => ({ ...state, [key]: { ...state[key], status: 'error', at: Date.now(), error: error.message } }));
      });
  };

  // One live lookup per selection (loadLive reads current state through liveRef).
  const liveKey = liveKeyOf(entry);
  useEffect(() => {
    loadLive(liveKey);
  }, [liveKey]);

  const trimmedQuery = query.trim();
  useEffect(() => {
    if (trimmedQuery.length < 2) return undefined;
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
  const directoryCiks = useMemo(() => new Set(PEOPLE.map((candidate) => candidate.cik)), []);
  const secResults =
    trimmedQuery.length >= 2 && secSearch.query === trimmedQuery
      ? secSearch.results.filter((result) => !directoryCiks.has(result.cik))
      : [];

  const liveState = live[liveKey];
  const profile = liveState?.status === 'ok' ? liveState.profile : null;
  const fund = profile ? profile.fund : snapshot?.funds?.[entry.id] ?? null;
  const insider = profile ? profile.insider : snapshot?.insiders?.[entry.id] ?? null;
  const guru = fund ? { ...fund, id: entry.id, person: entry.person, entity: entry.entity } : null;

  const userHoldings = useMemo(() => buildUserHoldings(analyticsSummary?.positions), [analyticsSummary]);
  const result = useMemo(() => (guru ? compareWithGuru(userHoldings, guru) : null), [guru, userHoldings]);
  const insights = useMemo(
    () => (result && mode === 'result' ? buildGuruInsights(result, guru, language) : []),
    [guru, language, mode, result],
  );
  const canCompare = Boolean(guru && userHoldings.length);

  // Atom items for the main stage.
  const guruItems = useMemo(() => {
    if (guru) {
      return guru.holdings.map((holding, index) => ({
        id: `g-${index}`,
        label: holding.name?.[lang] ?? holding.ticker,
        stockName: holding.name?.en ?? holding.ticker,
        ticker: holding.ticker.startsWith('CUSIP:') ? '' : holding.ticker,
        shares: 1,
        weight: holding.weight,
        share: holding.weight,
      }));
    }
    return insiderItems(insider);
  }, [guru, insider, lang]);
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
  const sharedTickers = useMemo(() => new Set(result?.shared.map((holding) => holding.ticker) ?? []), [result]);
  const counted = useCountUp(result?.commonShare ?? 0, mode !== 'preview');
  const portfolioName =
    String(activePortfolio?.fileName ?? '').replace(/\.(csv|tsv|txt)$/i, '') || (en ? 'My portfolio' : '내 포트폴리오');
  const person = entry.person[lang];

  const select = (next) => {
    onInteract?.();
    storeSelection(next);
    setSelection(next);
    setMode('preview');
    setPicked(null);
  };

  // Center click on the stage: re-read SEC, with light running out to every electron.
  const refreshFromStage = () => {
    onInteract?.();
    setBurstKey((value) => value + 1);
    loadLive(liveKey, { force: true });
  };

  // Drag the handle under the list to give it more (or less) room.
  const startListResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = listHeight;
    let latest = startHeight;
    const move = (moveEvent) => {
      latest = Math.min(LIST_MAX, Math.max(LIST_MIN, startHeight + moveEvent.clientY - startY));
      setListHeight(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        window.localStorage.setItem(LIST_HEIGHT_KEY, String(Math.round(latest)));
      } catch {
        // size just isn't remembered
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startCompare = () => {
    if (!canCompare || mode !== 'preview') return;
    onInteract?.();
    setMode('animating');
    window.setTimeout(() => setMode((current) => (current === 'animating' ? 'result' : current)), COMPARE_MS);
  };

  const tag =
    mode === 'preview'
      ? {
          title: person,
          note: fund
            ? `${entry.entity} · ${fund.source === 'ApeWisdom' ? (en ? 'live' : '실시간') : `${fund.source ?? '13F'} ${fund.period}`}`
            : insider
              ? `${entry.entity} · Form 4 ${insider.latestFiled}`
              : entry.entity,
        }
      : {
          title: en ? 'Common' : '공통',
          value: fmt.percent(counted),
          note: `${portfolioName} ↔ ${person}`,
        };

  const image = photos[entry.id];
  const liveText =
    liveState?.status === 'loading'
      ? en
        ? 'Updating…'
        : '업데이트 중…'
      : profile
        ? `${fund?.source === 'ApeWisdom' ? 'ApeWisdom' : 'SEC'} · ${new Date(liveState.at).toLocaleTimeString(en ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}`
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
          burstKey={burstKey}
          onCenterClick={refreshFromStage}
          onSelectAtom={setPicked}
          tag={tag}
          ariaLabel={{
            guru: en ? `${person}'s portfolio` : `${person}의 포트폴리오`,
            mine: en ? 'My portfolio' : '내 포트폴리오',
          }}
        />
      ) : null}

      {picked ? (
        <HoldingCard
          picked={picked}
          guru={guru}
          fund={fund}
          insider={insider}
          userHoldings={userHoldings}
          result={result}
          language={language}
          onClose={() => setPicked(null)}
        />
      ) : null}

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
            <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>
              {en ? enLabel : ko}
            </button>
          ))}
        </div>
      </div>

      <div className="guru-panel__list" role="list" style={{ maxHeight: listHeight }}>
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
            key={`sec-${result.cik}`}
            type="button"
            role="listitem"
            className={`guru-panel__person is-sec${selection.type === 'sec' && String(selection.cik) === result.cik ? ' is-active' : ''}`}
            onClick={() => select({ type: 'sec', cik: result.cik, name: result.name })}
          >
            <Avatar entry={{ id: `sec-${result.cik}`, person: { ko: result.name, en: result.name } }} lang="en" />
            <span className="guru-panel__person-text">
              <strong>{result.name}</strong>
              <em>{`SEC · ${result.tickers || `CIK ${result.cik}`}`}</em>
            </span>
          </button>
        ))}
        {trimmedQuery.length >= 2 && secSearch.query !== trimmedQuery ? (
          <span className="guru-panel__searching">{en ? 'Searching SEC…' : 'SEC 검색 중…'}</span>
        ) : null}
      </div>
      <div
        className="guru-panel__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={en ? 'Resize list' : '목록 크기 조절'}
        onPointerDown={startListResize}
        onDoubleClick={() => setListHeight((height) => (height < 400 ? 560 : 240))}
      />

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
          <button type="button" className="guru-panel__compare" onClick={startCompare} disabled={!canCompare}>
            <span aria-hidden="true">⚛</span>
            {en ? 'Compare' : '비교하기'}
          </button>
        ) : null}
      </div>

      {guru && result && mode === 'result' ? (
        <GuruResultCards guru={guru} result={result} insights={insights} language={language} />
      ) : null}
      <ChangesCard fund={fund} language={language} />
      <BuzzCard fund={fund} language={language} />
      <TradesCard key={entry.id} insider={insider} language={language} />

      {!fund && !insider ? (
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
          {insider?.trades?.[0]?.url ? (
            <li>
              <a href={insider.trades[0].url} target="_blank" rel="noreferrer">{`SEC Form 4 ${insider.latestFiled}`}</a>
            </li>
          ) : null}
          {image ? (
            <li>
              {image.kind === 'photo' ? (
                <>
                  {en ? 'Photo: ' : '사진: '}
                  <a href={image.sourceUrl} target="_blank" rel="noreferrer">{image.author}</a>
                  {` · ${image.license}`}
                </>
              ) : (
                `${en ? 'Logo' : '로고'}: ${image.author} (${en ? 'trademark of its owner' : '각 소유자의 상표'})`
              )}
            </li>
          ) : null}
          <li>{en ? 'Public filings, not investment advice.' : '공개 공시 정보이며 투자 권유가 아닙니다.'}</li>
        </ul>
      </details>
    </section>
  );
}
