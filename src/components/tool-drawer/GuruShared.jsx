// Small pieces shared by the 유명인 tab's panels and cards: number formats, buy/sell badges,
// the red-up / blue-down move chip (the app's own convention), and a natural-height scroll box.
import { useMemo } from 'react';

export const TRADE_KIND = {
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

export function useFormatters(en) {
  return useMemo(() => {
    const compact = new Intl.NumberFormat(en ? 'en-US' : 'ko-KR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const usd = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    return {
      shares: (value) => (Number.isFinite(value) ? compact.format(value) : '-'),
      usd: (value) => (Number.isFinite(value) ? usd.format(value) : '-'),
      price: (value) => (Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}` : '-'),
      percent: (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-'),
    };
  }, [en]);
}

export function KindBadge({ kind, lang }) {
  const meta = TRADE_KIND[kind] ?? TRADE_KIND.other;
  return <span className={`guru-panel__kind ${meta.tone}`}>{meta[lang]}</span>;
}

export const toneOf = (value) =>
  !Number.isFinite(value) || Math.abs(value) < 0.005 ? '' : value > 0 ? 'positive' : 'negative';

// ▲3.2% in red, ▼1.8% in blue; "-" when there is no number. The arrow keeps the direction
// readable without relying on color.
export function Move({ value, label = null, digits = 1 }) {
  if (!Number.isFinite(value)) {
    return <span className="guru-move is-empty">{label ? <small>{label}</small> : null}-</span>;
  }
  const arrow = value > 0.005 ? '▲' : value < -0.005 ? '▼' : '';
  return (
    <span className={`guru-move ${toneOf(value)}`}>
      {label ? <small>{label}</small> : null}
      {`${arrow}${Math.abs(value).toFixed(digits)}%`}
    </span>
  );
}

// A list that keeps its natural height, and scrolls inside `maxHeight` when it is longer.
export function ScrollBox({ maxHeight = null, className = '', children }) {
  return (
    <div
      className={`guru-scroll${className ? ` ${className}` : ''}`}
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
    >
      {children}
    </div>
  );
}
