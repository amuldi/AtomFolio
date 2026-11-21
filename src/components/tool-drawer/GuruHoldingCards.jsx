// Stock detail on the 유명인 stage, built to behave exactly like my own atom's:
//   GuruHoverCard      the compact peek that follows the cursor (same markup and styles as the
//                      app's HoverCard: name, return, weight · region · sector, "click for details")
//   guruDetailProps    the numbers for AtomDetailPanel — the very card a click opens on my own
//                      account — so a click here shows the same panel, filled with the investor's
//                      weight, live price, today's move, move since the filing and last quarter's
//                      trade.
import { createPortal } from 'react-dom';
import { REGION_LABELS, SECTOR_LABELS } from '../../lib/guruCompare.js';
import { describeChange, isBuyKind } from '../../lib/guruLive.js';
import { toneOf } from './GuruShared.jsx';

// Same clamping as the app's own hover card (App.jsx updateHoverInfo).
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 260;
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

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
    label: picked.label,
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
const signedPercent = (value, digits = 1) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}%` : null;
const toneClass = (value) => {
  const tone = toneOf(value);
  return tone === 'positive' ? 'is-positive' : tone === 'negative' ? 'is-negative' : '';
};

// The move that colors this electron: since the filing's period end for a 13F / N-PORT, today's
// otherwise. A holding that is only in my portfolio shows my own return.
function headlineMove(detail, isFiling, en) {
  const { quote, theirs, mine } = detail;
  if (theirs && quote) {
    if (isFiling && Number.isFinite(quote.sincePct))
      return { value: quote.sincePct, note: en ? 'since filing' : '기준일 이후' };
    if (Number.isFinite(quote.dayPct)) return { value: quote.dayPct, note: en ? 'today' : '오늘' };
  }
  if (mine?.returnRate != null)
    return { value: mine.returnRate, note: en ? 'my return' : '내 수익률' };
  if (quote && Number.isFinite(quote.dayPct))
    return { value: quote.dayPct, note: en ? 'today' : '오늘' };
  return null;
}

export function GuruHoverCard({ hovered, detail, language, isFiling }) {
  if (!hovered || !detail) return null;
  const en = language === 'en';
  const move = headlineMove(detail, isFiling, en);
  const weight = detail.theirs?.weight ?? detail.mine?.weight;
  const meta = [
    Number.isFinite(weight)
      ? `${en ? 'Weight' : '비중'} ${weight * 100 >= 10 ? Math.round(weight * 100) : (weight * 100).toFixed(1)}%`
      : null,
    detail.region,
    detail.sector,
    detail.change ? describeChange(detail.change, language) : null,
  ].filter(Boolean);
  const x = Math.round(clamp(hovered.x + 18, 16, window.innerWidth - TOOLTIP_WIDTH - 16));
  const y = Math.round(clamp(hovered.y + 18, 16, window.innerHeight - TOOLTIP_HEIGHT - 16));
  return createPortal(
    <aside className="hover-card is-compact" style={{ left: `${x}px`, top: `${y}px` }}>
      <div className="hover-card__header">
        <div className="hover-card__title-wrap">
          <strong className="hover-card__title">{detail.name}</strong>
          {move ? (
            <span
              className={`hover-card__return${toneClass(move.value) ? ` ${toneClass(move.value)}` : ''}`}
            >
              {signedPercent(move.value)}
            </span>
          ) : null}
        </div>
      </div>
      {meta.length ? <p className="hover-card__meta">{meta.join(' · ')}</p> : null}
      <p className="hover-card__hint">{en ? 'Click for details' : '클릭하면 자세히'}</p>
    </aside>,
    document.body,
  );
}

// Everything AtomDetailPanel needs, as the same slots it fills for my own holdings.
export function guruDetailProps({ detail, fund, isFiling, language, fmt }) {
  const en = language === 'en';
  const { theirs, mine, change, trades, shared, quote } = detail;
  const move = headlineMove(detail, isFiling, en);
  const period = fund?.period;
  const estimatedValue = theirs && fund?.totalValueUsd ? theirs.weight * fund.totalValueUsd : null;
  const weight = theirs?.weight ?? mine?.weight ?? null;

  const cells = [];
  if (estimatedValue != null)
    cells.push({
      label: en ? 'Est. value' : '평가금액(추정)',
      value: `≈${fmt.usd(estimatedValue)}`,
    });
  else if (theirs?.mentions)
    cells.push({ label: en ? 'Mentions' : '언급 수', value: theirs.mentions.toLocaleString() });
  if (weight != null)
    cells.push({ label: en ? 'Weight' : '비중', value: fmt.percent(weight), bar: weight });
  if (quote && Number.isFinite(quote.dayPct)) {
    cells.push({
      label: en ? 'Today' : '오늘',
      value: signedPercent(quote.dayPct),
      tone: toneOf(quote.dayPct),
    });
  }
  if (isFiling && quote && Number.isFinite(quote.sincePct)) {
    cells.push({
      label: en ? 'Since filing' : '기준일 이후',
      value: signedPercent(quote.sincePct),
      tone: toneOf(quote.sincePct),
    });
  } else if (mine?.returnRate != null) {
    cells.push({
      label: en ? 'My return' : '내 수익률',
      value: signedPercent(mine.returnRate),
      tone: toneOf(mine.returnRate),
    });
  }

  const fields = [
    { label: en ? 'Ticker' : '종목 티커', value: realTicker(detail.ticker) },
    { label: en ? 'Sector' : '분야', value: detail.sector },
    { label: en ? 'Region' : '지역', value: detail.region },
    theirs
      ? {
          label: detail.person,
          value: `${fmt.percent(theirs.weight)}${estimatedValue != null ? ` · ≈${fmt.usd(estimatedValue)}` : ''}`,
        }
      : null,
    mine ? { label: en ? 'My weight' : '내 비중', value: fmt.percent(mine.weight) } : null,
    mine?.returnRate != null
      ? { label: en ? 'My return' : '내 수익률', value: signedPercent(mine.returnRate) }
      : null,
    shared ? { label: en ? 'Held by' : '보유', value: en ? 'Both of us' : '둘 다 보유 중' } : null,
    theirs?.mentions
      ? {
          label: en ? 'Mentions · 24h' : '언급 (24시간)',
          value: `${theirs.mentions.toLocaleString()} · #${theirs.rank}`,
        }
      : null,
    change
      ? {
          label: en ? 'Last quarter' : '지난 분기 매매',
          value: `${describeChange(change, language)} · ≈${fmt.usd(Math.abs(change.tradeValueUsd))}`,
        }
      : null,
    change
      ? {
          label: en ? 'Shares' : '주식 수',
          value: `${fmt.shares(change.sharesBefore)} → ${fmt.shares(change.sharesAfter)}`,
        }
      : null,
    change
      ? {
          label: en ? 'Weight change' : '비중 변화',
          value: `${fmt.percent(change.weightBefore)} → ${fmt.percent(change.weightAfter)}`,
        }
      : null,
    quote ? { label: en ? 'Price' : '현재가', value: `$${quote.price.toFixed(2)}` } : null,
    quote && Number.isFinite(quote.dayPct)
      ? { label: en ? 'Today' : '오늘', value: signedPercent(quote.dayPct) }
      : null,
    quote && isFiling && Number.isFinite(quote.sincePct)
      ? { label: en ? 'Since filing' : '기준일 이후', value: signedPercent(quote.sincePct) }
      : null,
    quote && Number.isFinite(quote.periodClose)
      ? {
          label: en ? 'Price at period end' : '기준일 종가',
          value: `$${quote.periodClose.toFixed(2)}`,
        }
      : null,
    quote?.asOf
      ? {
          label: en ? 'Quote time' : '시세시각',
          value: new Date(quote.asOf).toLocaleString(en ? 'en-US' : 'ko-KR', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        }
      : null,
    ...trades.map((trade) => ({
      label: `${trade.date}`,
      value: `${trade.kind === 'buy' || isBuyKind(trade.kind) ? (en ? 'Buy' : '매수') : trade.kind === 'sell' ? (en ? 'Sell' : '매도') : trade.kind} ${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''}`,
    })),
  ].filter((field) => field && field.value != null && field.value !== '');

  return {
    atom: {
      id: detail.ticker || detail.label,
      label: detail.name,
      ticker: realTicker(detail.ticker) ?? '',
    },
    fields,
    returnValue: move ? signedPercent(move.value) : '',
    returnToneClass: move ? toneClass(move.value) : '',
    profitText: move ? move.note : null,
    metricCells: cells,
    track:
      quote && Number.isFinite(quote.periodClose) && Number.isFinite(quote.price) && isFiling
        ? {
            buy: quote.periodClose,
            current: quote.price,
            currency: quote.currency ?? 'USD',
            labels: {
              buy: `${en ? 'At' : ''} ${period ?? (en ? 'period end' : '기준일')}`.trim(),
              current: en ? 'Now' : '현재가',
            },
          }
        : null,
    chips: [detail.region, detail.sector, change ? describeChange(change, language) : null].filter(
      Boolean,
    ),
  };
}
