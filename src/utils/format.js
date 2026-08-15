import { UI_TEXT } from '../constants/ui.js';

export function textFor(language) {
  return UI_TEXT[language] ?? UI_TEXT.ko;
}

export function compactLabel(value, max = 18) {
  const text = String(value ?? '');
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1)}…`;
}

// 억/만 축약 — a raw 8-digit KRW figure (₩12,345,000) reliably wraps or overflows in any of the
// narrow spaces this app shows money in (a digital-twin result card, the desktop atom widget's
// readout, the menu-bar popover's summary page); this stays short enough not to. Clamped to >= 0
// — callers that need a sign (a profit/loss delta, say) format that themselves and pass this only
// the magnitude, same as formatSignedInvestmentMoney below already does.
export function formatKoreanWonShort(value) {
  const numeric = Math.max(0, Number(value ?? 0));

  if (numeric >= 100000000) {
    const amount = numeric / 100000000;
    const fixed = amount >= 10 ? amount.toFixed(0) : amount.toFixed(1).replace(/\.0$/, '');
    return `${fixed}억`;
  }

  if (numeric >= 10000) {
    const amount = numeric / 10000;
    const fixed = amount >= 100 ? Math.round(amount).toLocaleString('ko-KR') : amount.toFixed(1).replace(/\.0$/, '');
    return `${fixed}만`;
  }

  return Math.round(numeric).toLocaleString('ko-KR');
}

export function formatHeatmapValue(value, mode) {
  if (!Number.isFinite(value)) {
    return '';
  }

  if (mode === 'percent') {
    const fixed = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
    const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
    return `${value > 0 ? '+' : ''}${trimmed}%`;
  }

  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return `${value > 0 ? '+' : ''}${trimmed}`;
}

export function formatHeatmapDateLabel(date, language) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatHeatmapMonthLabel(date, language) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: 'short',
  }).format(date);
}

export function formatAllocationPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  const percentValue = value * 100;
  const fixed = percentValue >= 10 ? percentValue.toFixed(1) : percentValue.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return `${trimmed}%`;
}

export function normalizeDisplayKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

const META_VALUE_TRANSLATIONS = {
  en: {
    미국: 'US',
    한국: 'Korea',
    글로벌: 'Global',
    선진국: 'Developed Markets',
    일본: 'Japan',
    홍콩: 'Hong Kong',
    캐나다: 'Canada',
    고위험: 'High Risk',
    중위험: 'Medium Risk',
    저위험: 'Low Risk',
    성장주: 'Growth',
    가치주: 'Value',
    배당주: 'Dividend',
    방어형: 'Defensive',
    분산형: 'Diversified',
    개별주식: 'Single Stock',
    '주식 ETF': 'Equity ETF',
    '채권 ETF': 'Bond ETF',
    '원자재 ETF': 'Commodity ETF',
    기술: 'Technology',
    '인터넷 플랫폼': 'Internet Platform',
    반도체: 'Semiconductors',
    '반도체/전자': 'Semiconductors / Electronics',
    '철강/소재': 'Steel / Materials',
    자동차: 'Automobiles',
    배터리: 'Batteries',
    금융: 'Financials',
    바이오: 'Biotech',
    '방산/산업재': 'Aerospace / Industrials',
    '플랫폼/소비재': 'Platform / Consumer',
    전기차: 'EV',
    복합금융: 'Diversified Financials',
    필수소비재: 'Consumer Staples',
    에너지: 'Energy',
    '대형 기술주': 'Large-Cap Tech',
    '광범위 시장': 'Broad Market',
    '국제 주식': 'International Equities',
    채권: 'Bonds',
    원자재: 'Commodities',
    금: 'Gold',
    부동산: 'Real Estate',
    '전세계 주식': 'Global Equities',
    '배당 ETF': 'Dividend ETF',
    '국내 주식': 'Korean Stocks',
    '미국 주식': 'US Stocks',
    '해외 주식': 'International Stocks',
    '국내 주식 ETF': 'Korean Equity ETF',
    '미국 주식 ETF': 'US Equity ETF',
    '글로벌 주식 ETF': 'Global Equity ETF',
    '금/원자재 ETF': 'Gold / Commodity ETF',
    '리츠/부동산': 'REIT / Real Estate',
    '현금성 자산': 'Cash & Cash Equivalents',
    '디지털 자산': 'Digital Assets',
    대체자산: 'Alternative Assets',
    '기타 자산': 'Other Assets',
    미분류: 'Unclassified',
  },
  ko: {
    us: '미국',
    unitedstates: '미국',
    america: '미국',
    korea: '한국',
    southkorea: '한국',
    global: '글로벌',
    developedmarkets: '선진국',
    japan: '일본',
    hongkong: '홍콩',
    canada: '캐나다',
    highrisk: '고위험',
    mediumrisk: '중위험',
    lowrisk: '저위험',
    growth: '성장주',
    value: '가치주',
    dividend: '배당주',
    defensive: '방어형',
    diversified: '분산형',
    singlestock: '개별주식',
    equityetf: '주식 ETF',
    bondetf: '채권 ETF',
    commodityetf: '원자재 ETF',
    technology: '기술',
    internetplatform: '인터넷 플랫폼',
    semiconductors: '반도체',
    semiconductorselectronics: '반도체/전자',
    steelmaterials: '철강/소재',
    automobiles: '자동차',
    batteries: '배터리',
    financials: '금융',
    biotech: '바이오',
    aerospaceindustrials: '방산/산업재',
    platformconsumer: '플랫폼/소비재',
    ev: '전기차',
    diversifiedfinancials: '복합금융',
    consumerstaples: '필수소비재',
    energy: '에너지',
    largecaptech: '대형 기술주',
    broadmarket: '광범위 시장',
    internationalequities: '국제 주식',
    bonds: '채권',
    commodities: '원자재',
    gold: '금',
    realestate: '부동산',
    globalequities: '전세계 주식',
    dividendetf: '배당 ETF',
    koreanstocks: '국내 주식',
    domesticstocks: '국내 주식',
    usstocks: '미국 주식',
    internationalstocks: '해외 주식',
    koreanequityetf: '국내 주식 ETF',
    domesticequityetf: '국내 주식 ETF',
    usequityetf: '미국 주식 ETF',
    globalequityetf: '글로벌 주식 ETF',
    goldcommodityetf: '금/원자재 ETF',
    reitrealestate: '리츠/부동산',
    cashcashequivalents: '현금성 자산',
    digitalassets: '디지털 자산',
    alternativeassets: '대체자산',
    otherassets: '기타 자산',
    unclassified: '미분류',
    shares: '주',
    sh: '주',
  },
};

export function translateDisplayValue(value, language = 'ko') {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return value;
  }

  if (language === 'en') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*주$/);
    if (sharesMatch) {
      return `${sharesMatch[1]} sh`;
    }
  }

  if (language === 'ko') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:shares?|sh)$/i);
    if (sharesMatch) {
      return `${sharesMatch[1]}주`;
    }
  }

  const normalized = normalizeDisplayKey(trimmed);
  return META_VALUE_TRANSLATIONS[language]?.[normalized] ?? META_VALUE_TRANSLATIONS[language]?.[trimmed] ?? value;
}
