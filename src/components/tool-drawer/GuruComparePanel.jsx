// 비교 tab → 유명인 포트폴리오. Pick an investor (their atom blooms on the mini stage), then press
// 비교하기: both atoms meet, common holdings fuse in the middle, and only then do the comparison
// cards appear. Picking another investor or switching portfolios goes back to the picker.
//
// Investor data is the bundled 13F snapshot in src/data/guruPortfolios.json
// (scripts/fetch-guru-portfolios.mjs); all math lives in src/lib/guruCompare.js.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import guruData from '../../data/guruPortfolios.json';
import {
  REGION_LABELS,
  REGION_ORDER,
  SECTOR_LABELS,
  buildGuruInsights,
  buildUserHoldings,
  compareWithGuru,
  daysSince,
} from '../../lib/guruCompare.js';
import { readStoredOption } from '../../utils/storage.js';
import { drawGuruScene, easeOut } from './guruAtomDraw.js';

const STORAGE_KEY = 'atomfolio-guru-compare-investor';
const GURU_IDS = guruData.gurus.map((guru) => guru.id);
const SELECT_MS = 650;
const COMPARE_MS = 2100;
const REGION_SWATCH = {
  us: 'rgba(var(--frame-ink-a), 0.92)',
  kr: 'rgb(var(--guru-accent))',
  cn: '#c98f7a',
  tw: '#a9b98a',
  other: '#8f8a80',
  rest: 'rgba(var(--frame-ink-a), 0.16)',
};

const formatPercent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function readSceneColors(element) {
  const style = window.getComputedStyle(element);
  return {
    ink: style.getPropertyValue('--frame-ink-a').trim() || '255, 248, 233',
    guru: style.getPropertyValue('--guru-accent').trim() || '233, 184, 92',
  };
}

function storeInvestor(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode / blocked storage: the choice just isn't remembered
  }
}

export function GuruComparePanel({ analyticsSummary, activePortfolio, language, onInteract }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const [guruId, setGuruId] = useState(() => {
    try {
      return readStoredOption(STORAGE_KEY, GURU_IDS, GURU_IDS[0]);
    } catch {
      return GURU_IDS[0];
    }
  });
  const [mode, setMode] = useState('preview'); // 'preview' | 'animating' | 'result'
  const portfolioKey = activePortfolio?.id ?? null;
  const [seenPortfolioKey, setSeenPortfolioKey] = useState(portfolioKey);
  if (seenPortfolioKey !== portfolioKey) {
    // A different portfolio makes the shown result stale — back to the picker.
    setSeenPortfolioKey(portfolioKey);
    setMode('preview');
  }

  const guru = guruData.gurus.find((candidate) => candidate.id === guruId) ?? guruData.gurus[0];
  const userHoldings = useMemo(() => buildUserHoldings(analyticsSummary?.positions), [analyticsSummary]);
  const result = useMemo(() => compareWithGuru(userHoldings, guru), [userHoldings, guru]);
  const insights = useMemo(
    () => (mode === 'result' ? buildGuruInsights(result, guru, language) : []),
    [guru, language, mode, result],
  );
  const canCompare = userHoldings.length > 0;
  const age = daysSince(guru.period);
  const portfolioName = String(activePortfolio?.fileName ?? '').replace(/\.(csv|tsv|txt)$/i, '') || (en ? 'My portfolio' : '내 포트폴리오');

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const countRef = useRef(null);
  const rafRef = useRef(0);
  const frameRef = useRef({ kind: 'select', t: 1 });
  const colorsRef = useRef(null);
  const sceneRef = useRef(null);

  useLayoutEffect(() => {
    sceneRef.current = {
      guru,
      result,
      language,
      labels: {
        me: en ? 'Me' : '나',
        noShared: en ? 'No common holdings' : '공통 종목 없음',
        moreShared: (count) => (en ? `+${count} more in common` : `공통 +${count}종목`),
      },
    };
  });

  const paint = useCallback((kind, t) => {
    frameRef.current = { kind, t };
    const canvas = canvasRef.current;
    if (!canvas || !sceneRef.current) return;
    colorsRef.current ??= readSceneColors(canvas);
    drawGuruScene(canvas, { kind, t, colors: colorsRef.current, ...sceneRef.current });
    if (kind === 'compare' && countRef.current) {
      countRef.current.textContent = formatPercent(
        sceneRef.current.result.commonShare * easeOut(clamp01((t - 0.36) / 0.6)),
      );
    }
  }, []);

  const play = useCallback(
    (kind, duration, onDone) => {
      cancelAnimationFrame(rafRef.current);
      const reduced = prefersReducedMotion();
      const start = performance.now();
      const step = (now) => {
        const t = reduced ? 1 : Math.min(1, (now - start) / duration);
        paint(kind, t);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = 0;
          onDone?.();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [paint],
  );

  // Bloom the investor's atom whenever the picker is (re)shown or the investor changes.
  useEffect(() => {
    if (mode === 'preview') {
      play('select', SELECT_MS);
    }
  }, [guruId, mode, play]);

  // Live quote refreshes change the numbers under a finished scene: redraw it in place.
  useEffect(() => {
    if (!rafRef.current) {
      paint(frameRef.current.kind, frameRef.current.t);
    }
  }, [language, paint, result]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (!rafRef.current) paint(frameRef.current.kind, frameRef.current.t);
    });
    observer.observe(stage);
    document.fonts?.ready?.then(() => {
      if (!rafRef.current) paint(frameRef.current.kind, frameRef.current.t);
    });
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const selectGuru = (id) => {
    onInteract?.();
    storeInvestor(id);
    setGuruId(id);
    setMode('preview');
  };

  const startCompare = () => {
    onInteract?.();
    if (!canCompare) return;
    setMode('animating');
    const stage = stageRef.current;
    if (stage && stage.getBoundingClientRect().top < 0) {
      stage.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    play('compare', COMPARE_MS, () => setMode('result'));
  };

  const handleStageButton = () => {
    if (mode === 'preview') {
      startCompare();
    } else if (mode === 'result') {
      onInteract?.();
      setMode('preview');
    }
  };

  const sectorLabel = (key) => SECTOR_LABELS[key]?.[lang] ?? key;
  const regionLabel = (key) => REGION_LABELS[key]?.[lang] ?? key;
  const nameOf = (holding) => holding.name?.[lang] ?? holding.ticker;
  const person = guru.person[lang];
  const sectorMax = Math.max(0.0001, ...result.sectors.map((row) => Math.max(row.user, row.guru)));
  const topSum = guru.holdings.reduce((sum, holding) => sum + holding.weight, 0);

  const renderRegionRow = (label, buckets) => (
    <div className="guru-compare__stack-row">
      <span>{label}</span>
      <div className="guru-compare__stack">
        {REGION_ORDER.filter((key) => (buckets[key] ?? 0) > 0.0005).map((key) => (
          <i
            key={key}
            title={`${regionLabel(key)} ${formatPercent(buckets[key])}`}
            style={{ flexGrow: buckets[key], background: REGION_SWATCH[key] }}
            className={key === 'rest' ? 'is-rest' : undefined}
          >
            {buckets[key] > 0.16 ? `${regionLabel(key)} ${formatPercent(buckets[key], 0)}` : ''}
          </i>
        ))}
      </div>
    </div>
  );

  const usedRegions = REGION_ORDER.filter(
    (key) => (result.userRegions[key] ?? 0) + (result.guruRegions[key] ?? 0) > 0.0005,
  );

  return (
    <section className="tool-drawer__overview-card tool-drawer__overview-card--wide guru-compare">
      <div className="tool-drawer__overview-card-head">
        <p>{en ? 'Famous investors' : '유명인 포트폴리오'}</p>
        <span className="guru-compare__source">
          {en ? `SEC 13F · as of ${guru.period}` : `SEC 13F · ${guru.period} 기준`}
        </span>
      </div>

      <div className="guru-compare__picker" role="list" aria-label={en ? 'Investors' : '투자자'}>
        {guruData.gurus.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="listitem"
            aria-pressed={candidate.id === guru.id}
            className={`guru-compare__investor${candidate.id === guru.id ? ' is-active' : ''}`}
            onClick={() => selectGuru(candidate.id)}
          >
            <strong>{candidate.person[lang]}</strong>
            <em>{candidate.entity}</em>
            <small>
              {en
                ? `${candidate.holdingsCount} holdings · #1 ${candidate.holdings[0].name.en} ${formatPercent(candidate.top1, 0)}`
                : `${candidate.holdingsCount}종목 · 1위 ${candidate.holdings[0].name.ko} ${formatPercent(candidate.top1, 0)}`}
            </small>
          </button>
        ))}
      </div>

      <div className={`guru-compare__stage is-${mode}`} ref={stageRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            mode === 'preview'
              ? en
                ? `${person}'s portfolio drawn as an atom; electron size is the holding's weight.`
                : `${person}의 포트폴리오를 원자로 그린 그림. 전자 크기가 종목 비중입니다.`
              : en
                ? `My portfolio on the left, ${person}'s on the right; electrons held by both atoms in the middle are common holdings.`
                : `왼쪽은 내 포트폴리오, 오른쪽은 ${person}의 포트폴리오. 가운데에서 두 원자가 함께 잡은 전자가 공통 종목입니다.`
          }
        />
        <div className="guru-compare__pill" key={mode === 'preview' ? `p-${guru.id}` : `c-${guru.id}`} aria-live="polite">
          {mode === 'preview' ? (
            <>
              <strong>{person}</strong>
              <span>
                {en
                  ? `${guru.entity} · ${guru.period} (${age} days ago)`
                  : `${guru.entity} · ${guru.period} 기준 (${age}일 전)`}
              </span>
            </>
          ) : (
            <>
              <strong>
                {en ? 'Common ' : '공통 '}
                {/* While animating, the count-up writes straight into this <b> every frame, so it
                    has no React children; the settled value is a separate keyed element. */}
                {mode === 'result' ? (
                  <b key="settled">{formatPercent(result.commonShare)}</b>
                ) : (
                  <b key="counting" ref={countRef} />
                )}
              </strong>
              <span>
                {en
                  ? `${portfolioName} ↔ ${person} · ${result.shared.length} in common`
                  : `${portfolioName} ↔ ${person} · 공통 ${result.shared.length}종목`}
              </span>
            </>
          )}
        </div>
        <div className="guru-compare__stage-bar">
          {mode === 'preview' ? null : (
            <div className="guru-compare__legend">
              <span><i className="is-mine" />{en ? 'Mine' : '내 종목'}</span>
              <span><i className="is-guru" />{person}</span>
              <span><i className="is-both" />{en ? 'Common' : '공통'}</span>
            </div>
          )}
          <button
            type="button"
            className={`guru-compare__action${mode === 'preview' ? ' is-primary' : ''}`}
            onClick={handleStageButton}
            disabled={mode === 'animating' || (mode === 'preview' && !canCompare)}
            title={!canCompare ? (en ? 'Add a portfolio first' : '포트폴리오를 먼저 추가하세요') : undefined}
          >
            {mode === 'preview' ? <span aria-hidden="true">⚛</span> : null}
            {mode === 'preview'
              ? en
                ? 'Compare'
                : '비교하기'
              : mode === 'animating'
                ? en
                  ? 'Matching…'
                  : '맞춰 보는 중…'
                : en
                  ? 'Pick another investor'
                  : '다른 투자자 고르기'}
          </button>
        </div>
      </div>

      {mode === 'preview' || mode === 'animating' ? (
        <div className="guru-compare__holdings">
          <div className="guru-compare__subhead">
            <span>{en ? `${person} · top ${guru.holdings.length}` : `${person} · 상위 ${guru.holdings.length}종목`}</span>
            <em>
              {en
                ? `${guru.holdingsCount} holdings in the filing · filed ${guru.filed}`
                : `공시 전체 ${guru.holdingsCount}종목 · ${guru.filed} 공시`}
            </em>
          </div>
          <ol key={guru.id}>
            {guru.holdings.map((holding, index) => (
              <li key={holding.ticker || holding.cusip} style={{ '--row': index }}>
                <span className="guru-compare__rank">{index + 1}</span>
                <span className="guru-compare__name">
                  <span>
                    {nameOf(holding)}
                    <small>{holding.ticker}</small>
                  </span>
                  <i style={{ '--w': `${(holding.weight / guru.holdings[0].weight) * 100}%` }} />
                </span>
                <strong>{formatPercent(holding.weight)}</strong>
              </li>
            ))}
          </ol>
          <p className="guru-compare__note">
            {canCompare
              ? en
                ? `Top ${guru.holdings.length} cover ${formatPercent(topSum)} of the filing. Press Compare to line them up against ${portfolioName}.`
                : `상위 ${guru.holdings.length}종목 비중 합계 ${formatPercent(topSum)}. 비교하기를 누르면 ${portfolioName}와(과) 맞대 봅니다.`
              : en
                ? 'Add a portfolio to compare it with this investor.'
                : '포트폴리오를 추가하면 이 투자자와 비교할 수 있습니다.'}
          </p>
        </div>
      ) : null}

      {mode === 'result' ? (
        <div className="guru-compare__result">
          <div className="guru-compare__card guru-compare__insights" style={{ '--i': 0 }}>
            <span className="guru-compare__subhead"><span>{en ? 'At a glance' : '한눈에 보는 차이'}</span></span>
            <ul>
              {insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="guru-compare__card" style={{ '--i': 1 }}>
            <div className="guru-compare__subhead">
              <span>{en ? 'Sectors' : '섹터 비중'}</span>
              <em className="guru-compare__keys">
                <i className="is-mine" />{en ? 'Me' : '나'}
                <i className="is-guru" />{person}
              </em>
            </div>
            <div className="guru-compare__bars">
              {result.sectors.map((row, index) => (
                <div key={row.key} className={`guru-compare__bar-row${row.key === 'rest' ? ' is-rest' : ''}`} style={{ '--i': 1 + index * 0.3 }}>
                  <span>{sectorLabel(row.key)}</span>
                  <div>
                    {row.key === 'rest' ? null : (
                      <div className="guru-compare__bar">
                        <b><i className="is-mine" style={{ '--w': `${(row.user / sectorMax) * 100}%` }} /></b>
                        <em>{formatPercent(row.user)}</em>
                      </div>
                    )}
                    <div className="guru-compare__bar">
                      <b><i className="is-guru" style={{ '--w': `${(row.guru / sectorMax) * 100}%` }} /></b>
                      <em>{formatPercent(row.guru)}</em>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="guru-compare__card" style={{ '--i': 2 }}>
            <div className="guru-compare__subhead">
              <span>{en ? 'Common holdings' : '공통 종목'}</span>
              <em>
                {en
                  ? `${result.shared.length} · common share ${formatPercent(result.commonShare)}`
                  : `${result.shared.length}종목 · 공통 비중 ${formatPercent(result.commonShare)}`}
              </em>
            </div>
            {result.shared.length ? (
              <div className="guru-compare__table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{en ? 'Holding' : '종목'}</th>
                      <th>{en ? 'Mine' : '내 비중'}</th>
                      <th>{person}</th>
                      <th>{en ? 'My return' : '내 수익률'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.shared.map((holding, index) => (
                      <tr key={holding.ticker} style={{ '--row': index }}>
                        <td>
                          {nameOf(holding)}
                          <small>{holding.ticker}</small>
                        </td>
                        <td>{formatPercent(holding.userWeight)}</td>
                        <td className="is-guru">{formatPercent(holding.guruWeight)}</td>
                        <td className={holding.returnRate == null ? '' : holding.returnRate >= 0 ? 'positive' : 'negative'}>
                          {holding.returnRate == null
                            ? '-'
                            : `${holding.returnRate >= 0 ? '▲' : '▼'}${Math.abs(holding.returnRate).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="guru-compare__empty">
                {en
                  ? `No common holdings: none of ${person}'s top ${guru.holdings.length} is in your portfolio.`
                  : `공통 종목이 없습니다. ${person}의 상위 ${guru.holdings.length}종목 중 내가 가진 종목이 없습니다.`}
              </p>
            )}
            <p className="guru-compare__note">
              {en
                ? 'Common share = for each common holding, the smaller of your weight and theirs, summed.'
                : '공통 비중 = 공통 종목마다 내 비중과 투자자 비중 중 작은 값을 더한 값.'}
            </p>
          </div>

          <div className="guru-compare__card" style={{ '--i': 3 }}>
            <div className="guru-compare__subhead"><span>{en ? 'Regions' : '지역 비중'}</span></div>
            {renderRegionRow(en ? 'Me' : '나', result.userRegions)}
            {renderRegionRow(person, result.guruRegions)}
            <div className="guru-compare__region-keys">
              {usedRegions.map((key) => (
                <span key={key}>
                  <i style={{ background: REGION_SWATCH[key] }} />
                  {regionLabel(key)}
                </span>
              ))}
            </div>
          </div>

          <div className="guru-compare__card" style={{ '--i': 4 }}>
            <div className="guru-compare__subhead"><span>{en ? 'Concentration' : '집중도'}</span></div>
            <dl className="guru-compare__stats">
              <dt />
              <dd>{en ? 'Me' : '나'}</dd>
              <dd className="is-guru">{person}</dd>
              <dt>{en ? 'Holdings' : '보유 종목 수'}</dt>
              <dd>{result.userConcentration.holdings}</dd>
              <dd className="is-guru">{guru.holdingsCount}</dd>
              <dt>{en ? 'Effective holdings' : '유효 종목 수'}</dt>
              <dd>{result.userConcentration.effectiveHoldings.toFixed(1)}</dd>
              <dd className="is-guru">{guru.effectiveHoldings.toFixed(1)}</dd>
              <dt>{en ? 'Largest holding' : '1위 종목 비중'}</dt>
              <dd>{formatPercent(result.userConcentration.top1)}</dd>
              <dd className="is-guru">{formatPercent(guru.top1)}</dd>
              <dt>{en ? 'Top 5' : '상위 5종목 비중'}</dt>
              <dd>{formatPercent(result.userConcentration.top5)}</dd>
              <dd className="is-guru">{formatPercent(guru.top5)}</dd>
            </dl>
            <p className="guru-compare__note">
              {en
                ? 'Effective holdings = 1 ÷ Σ(weight²). The investor side uses every holding in the filing.'
                : '유효 종목 수 = 1 ÷ Σ(비중²). 투자자 쪽은 공시 전체 종목 기준입니다.'}
            </p>
          </div>
        </div>
      ) : null}

      <details className="guru-compare__about">
        <summary>{en ? 'How to read this data' : '이 데이터를 읽는 법'}</summary>
        <ul>
          <li>
            {en
              ? `13F filings show holdings at quarter end and are due 45 days later. These are ${guru.period} holdings (${age} days ago), not today's.`
              : `13F는 분기 말 보유 내역을 45일 안에 공시합니다. 이 데이터는 ${guru.period} 보유 기준(${age}일 전)이며 지금 보유 중인 종목과 다를 수 있습니다.`}
          </li>
          <li>
            {en
              ? 'Only long positions in US-listed stocks, ETFs and ADRs. Cash, bonds, shorts and non-US listings are missing.'
              : '미국 상장 주식·ETF·ADR의 매수 포지션만 들어갑니다. 현금, 채권, 공매도, 미국 밖 상장 주식은 빠집니다.'}
          </li>
          <li>
            {en
              ? "Korea's NPS files 13F for its US stocks only; its Korean holdings are not included."
              : '국민연금은 미국 주식 보유분만 13F에 나옵니다. 국내 주식은 포함되지 않습니다.'}
          </li>
          <li>
            {en
              ? `Only each investor's top ${guruData.topN} are compared by name; the rest is grouped as "Outside top ${guruData.topN}". ETFs are not looked through.`
              : `투자자별 상위 ${guruData.topN}종목만 종목 단위로 비교하고 나머지는 '상위 ${guruData.topN} 외'로 묶었습니다. ETF는 구성 종목으로 풀지 않습니다.`}
          </li>
          <li>
            {en
              ? 'Public filings shown for information only. Not investment advice.'
              : '공개 공시를 정리한 정보이며 투자 권유가 아닙니다.'}
          </li>
        </ul>
        <a href={guru.url} target="_blank" rel="noreferrer">
          {en ? `Original filing (${guru.accession})` : `SEC 원문 (${guru.accession})`}
        </a>
      </details>
    </section>
  );
}
