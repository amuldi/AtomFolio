// Stock detail on the 유명인 stage, in two steps like the app's own atom:
//   GuruHoverCard    a compact peek that follows the cursor over an electron
//   GuruHoldingCard  the full card a click opens (the peek disappears when it does)
// Both read the same numbers: weight, price now, today's move, the move since the filing's period
// end (colored red up / blue down) and what the person bought or sold.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { REGION_LABELS, SECTOR_LABELS } from '../../lib/guruCompare.js';
import { describeChange, isBuyKind } from '../../lib/guruLive.js';
import { KindBadge, Move, toneOf, useFormatters } from './GuruShared.jsx';

export function holdingDetail({
  picked,
  guru,
  fund,
  insider,
  userHoldings,
  result,
  quotes,
  language,
}) {
  const lang = language === 'en' ? 'en' : 'ko';
  const ticker = picked.ticker;
  const theirs = ticker
    ? (guru?.holdings.find((holding) => holding.ticker === ticker) ?? null)
    : null;
  const mine = ticker ? (userHoldings.find((holding) => holding.ticker === ticker) ?? null) : null;
  const base = theirs ?? mine;
  return {
    lang,
    ticker,
    theirs,
    mine,
    base,
    name: base?.name?.[lang] ?? picked.label,
    sector: base?.sector ? SECTOR_LABELS[base.sector]?.[lang] : null,
    region: base?.region ? REGION_LABELS[base.region]?.[lang] : null,
    change: fund?.changes?.find((candidate) => candidate.ticker === ticker) ?? null,
    trades: (insider?.trades ?? []).filter((trade) => trade.ticker === ticker).slice(0, 4),
    shared: result?.shared.find((holding) => holding.ticker === ticker) ?? null,
    quote: quotes?.[ticker] ?? null,
    person: guru?.person?.[lang] ?? '',
  };
}

const realTicker = (ticker) => (ticker && !ticker.startsWith('CUSIP:') ? ticker : null);

// Where the price stood at the filing's period end versus now, on one track.
function PriceTrack({ quote, language }) {
  if (!Number.isFinite(quote?.periodClose) || !Number.isFinite(quote?.price)) return null;
  const en = language === 'en';
  const low = Math.min(quote.periodClose, quote.price) * 0.96;
  const high = Math.max(quote.periodClose, quote.price) * 1.04;
  const at = (value) => ((value - low) / (high - low)) * 100;
  const tone = toneOf(quote.price - quote.periodClose);
  return (
    <div className="guru-card__track" aria-hidden="true">
      <div>
        <span
          className={tone}
          style={{
            left: `${Math.min(at(quote.periodClose), at(quote.price))}%`,
            width: `${Math.abs(at(quote.price) - at(quote.periodClose))}%`,
          }}
        />
        <i style={{ left: `${at(quote.periodClose)}%` }} />
        <i className={`is-now ${tone}`} style={{ left: `${at(quote.price)}%` }} />
      </div>
      <small>
        <span>{`${en ? 'Period end' : '기준일'} $${quote.periodClose.toFixed(2)}`}</span>
        <span>{`${en ? 'Now' : '지금'} $${quote.price.toFixed(2)}`}</span>
      </small>
    </div>
  );
}

export function GuruHoverCard({ hovered, detail, language }) {
  const en = language === 'en';
  const fmt = useFormatters(en);
  if (!hovered || !detail) return null;
  const { theirs, mine, change, quote, trades, shared } = detail;
  const width = 232;
  const left = Math.min(Math.max(12, hovered.x + 18), window.innerWidth - width - 12);
  const top = Math.min(Math.max(12, hovered.y + 14), window.innerHeight - 190);
  const trade = trades[0];
  return createPortal(
    <aside className="guru-hover" style={{ left, top, width }} role="tooltip">
      <header>
        <strong>{detail.name}</strong>
        <span>{[realTicker(detail.ticker), detail.sector].filter(Boolean).join(' · ')}</span>
      </header>
      {quote ? (
        <div className="guru-hover__moves">
          <b>{`$${quote.price.toFixed(2)}`}</b>
          <Move value={quote.dayPct} label={en ? 'Today' : '오늘'} />
          {Number.isFinite(quote.sincePct) ? (
            <Move value={quote.sincePct} label={en ? 'Since filing' : '기준일 이후'} />
          ) : null}
        </div>
      ) : null}
      {mine?.returnRate != null ? (
        <div className="guru-hover__moves">
          <Move value={mine.returnRate} label={en ? 'My return' : '내 수익률'} />
        </div>
      ) : null}
      <p className="guru-hover__line">
        {theirs ? `${detail.person} ${fmt.percent(theirs.weight)}` : null}
        {theirs && mine ? ' · ' : null}
        {mine ? `${en ? 'Me' : '나'} ${fmt.percent(mine.weight)}` : null}
      </p>
      {change ? (
        <p className="guru-hover__line">
          <KindBadge kind={change.kind} lang={detail.lang} />
          {[describeChange(change, language), `≈${fmt.usd(Math.abs(change.tradeValueUsd))}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {!change && trade ? (
        <p className="guru-hover__line">
          <KindBadge kind={trade.kind} lang={detail.lang} />
          {`${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''} · ${trade.date}`}
        </p>
      ) : null}
      {shared ? (
        <p className="guru-hover__shared">{en ? 'Held by both' : '둘 다 보유 중'}</p>
      ) : null}
      <small>{en ? 'Click for details' : '클릭하면 자세히'}</small>
    </aside>,
    document.body,
  );
}

export function GuruHoldingCard({ picked, detail, fund, language, onClose }) {
  const en = language === 'en';
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

  const { theirs, mine, change, trades, shared, quote } = detail;
  const width = 276;
  const left = Math.min(Math.max(12, picked.x + 18), window.innerWidth - width - 12);
  const top = Math.min(Math.max(12, picked.y - 40), Math.max(12, window.innerHeight - 440));

  return createPortal(
    <aside
      ref={cardRef}
      className="guru-card"
      style={{ left, top, width }}
      role="dialog"
      aria-label={detail.name}
    >
      <button
        type="button"
        className="guru-card__close"
        onClick={onClose}
        aria-label={en ? 'Close' : '닫기'}
      >
        ×
      </button>
      <header>
        <strong>{detail.name}</strong>
        <span>
          {[realTicker(detail.ticker), detail.sector, detail.region].filter(Boolean).join(' · ')}
        </span>
      </header>

      {quote ? (
        <div className="guru-card__price">
          <div className="guru-card__price-now">
            <b>{`$${quote.price.toFixed(2)}`}</b>
            <span>
              {quote.asOf
                ? new Date(quote.asOf).toLocaleString(en ? 'en-US' : 'ko-KR', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </span>
          </div>
          <div className="guru-card__price-moves">
            <Move value={quote.dayPct} label={en ? 'Today' : '오늘'} />
            {Number.isFinite(quote.sincePct) ? (
              <Move value={quote.sincePct} label={en ? 'Since filing' : '기준일 이후'} />
            ) : null}
          </div>
          <PriceTrack quote={quote} language={language} />
        </div>
      ) : null}

      {theirs ? (
        <div className="guru-card__metric">
          <span>{detail.person}</span>
          <b>{fmt.percent(theirs.weight)}</b>
          <i style={{ '--w': `${Math.min(100, theirs.weight * 100 * 2.5)}%` }} />
          {fund?.totalValueUsd ? (
            <em>{`≈ ${fmt.usd(theirs.weight * fund.totalValueUsd)}`}</em>
          ) : null}
          {theirs.mentions ? <em>{en ? 'share of mentions' : '언급 비중'}</em> : null}
        </div>
      ) : null}
      {mine ? (
        <div className="guru-card__metric is-mine">
          <span>{en ? 'Me' : '나'}</span>
          <b>{fmt.percent(mine.weight)}</b>
          <i style={{ '--w': `${Math.min(100, mine.weight * 100 * 2.5)}%` }} />
          {mine.returnRate != null ? (
            <em className={toneOf(mine.returnRate)}>
              {`${en ? 'My return' : '내 수익률'} ${mine.returnRate >= 0 ? '▲' : '▼'}${Math.abs(mine.returnRate).toFixed(1)}%`}
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
        <div className={`guru-card__trade ${isBuyKind(change.kind) ? 'is-buy' : 'is-sell'}`}>
          <div>
            <KindBadge kind={change.kind} lang={detail.lang} />
            <b>{describeChange(change, language)}</b>
            <small>{`${fund.previous.period} → ${fund.period}`}</small>
          </div>
          <p>
            {`${fmt.shares(change.sharesBefore)} → ${fmt.shares(change.sharesAfter)}${en ? ' sh' : '주'} · ≈${fmt.usd(Math.abs(change.tradeValueUsd))}`}
          </p>
          <p>{`${en ? 'Weight' : '비중'} ${fmt.percent(change.weightBefore)} → ${fmt.percent(change.weightAfter)}`}</p>
        </div>
      ) : null}
      {trades.map((trade) => (
        <p key={`${trade.date}-${trade.kind}-${trade.filed}`} className="guru-card__line">
          <KindBadge kind={trade.kind} lang={detail.lang} />
          {`${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''}`}
          {quote && trade.averagePrice > 0 ? (
            <Move
              value={(quote.price / trade.averagePrice - 1) * 100}
              label={en ? 'Now' : '지금'}
            />
          ) : null}
          <small>{trade.date}</small>
        </p>
      ))}
    </aside>,
    document.body,
  );
}
