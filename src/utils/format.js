import { UI_TEXT, GROUP_OPTION_KEYS, SCORE_AXIS_KEYS } from '../constants/ui.js';
import { noise } from './math.js';

export function textFor(language) {
  return UI_TEXT[language] ?? UI_TEXT.ko;
}

export function groupOptionsFor(language) {
  const labels = textFor(language).groupLabels;
  return GROUP_OPTION_KEYS.map((key) => ({ key, label: labels[key] }));
}

export function scoreAxesFor(language) {
  const labels = textFor(language).scoreAxisLabels;
  return SCORE_AXIS_KEYS.map((key) => ({ key, label: labels[key] }));
}

export function compactLabel(value, max = 18) {
  const text = String(value ?? '');
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1)}…`;
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
    .replace(/^﻿/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

const LEGACY_ATOM_TERM_PATTERN = new RegExp(`원${'자'}(?!재)`, 'g');

export function normalizePortfolioVocabulary(value) {
  return String(value ?? '').replace(LEGACY_ATOM_TERM_PATTERN, '포트폴리오');
}

export function canHighlightGroupField(atom, groupKey) {
  if (!atom || !groupKey) {
    return false;
  }

  const value = String(atom[groupKey] ?? '').trim();
  if (!value) {
    return false;
  }

  const source = String(atom.metadataSourceByField?.[groupKey] ?? '').trim().toLowerCase();
  return source === 'provided' || source === 'reference' || source === 'derived' || source === 'wikidata';
}

export function resolveFieldLabelKey(label) {
  const normalized = normalizeDisplayKey(normalizePortfolioVocabulary(label));

  if (
    ['종목 티커', '종목코드', '티커', 'ticker', 'symbol', 'stockcode', 'securitycode']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'stockCode';
  }

  if (
    ['종목명', '자산명', '상품명', 'name', 'security', 'securityname', 'assetname', 'productname', 'company'].map(
      normalizeDisplayKey,
    ).includes(normalized)
  ) {
    return 'stockName';
  }

  if (
    ['계좌id', '계좌번호', '계좌코드', '포트폴리오id', '포트폴리오번호', '포트폴리오코드', 'acctid', 'accountid', 'accountnumber']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'accountId';
  }

  if (
    ['계좌유형', '계좌종류', '계좌구분', '계좌명', '포트폴리오 유형', '포트폴리오종류', '포트폴리오구분', '포트폴리오명', 'accounttype', 'accountkind', 'accountclass']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'accountType';
  }

  if (['매수일', '매입일', '취득일', 'buydate', 'purchasedate'].map(normalizeDisplayKey).includes(normalized)) {
    return 'buyDate';
  }

  if (['매수가', '매입가', 'buyprice', 'purchaseprice', 'entryprice'].map(normalizeDisplayKey).includes(normalized)) {
    return 'buyPrice';
  }

  if (['보유수량', '수량', 'shares', 'quantity'].map(normalizeDisplayKey).includes(normalized)) {
    return 'shares';
  }

  if (['수익률', '등락률', 'return', 'returns', 'performance', 'change'].map(normalizeDisplayKey).includes(normalized)) {
    return 'return';
  }

  if (['투자지역', '지역', 'region', 'market', 'country'].map(normalizeDisplayKey).includes(normalized)) {
    return 'region';
  }

  if (['분야', '업종', '산업', '섹터', 'sector', 'industry', 'theme'].map(normalizeDisplayKey).includes(normalized)) {
    return 'sector';
  }

  if (['투자스타일', '스타일', 'style', 'strategy', 'factor'].map(normalizeDisplayKey).includes(normalized)) {
    return 'style';
  }

  if (['위험등급', '위험', '리스크', 'risk', 'riskgrade', 'risklevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'risk';
  }

  if (['자산구분', 'assetclass', 'assettype'].map(normalizeDisplayKey).includes(normalized)) {
    return 'assetClass';
  }

  if (['통화', 'currency', 'fx'].map(normalizeDisplayKey).includes(normalized)) {
    return 'currency';
  }

  if (['규모분류', '시가총액분류', 'marketcap', 'marketcapclass'].map(normalizeDisplayKey).includes(normalized)) {
    return 'marketCapClass';
  }

  if (['변동성', 'volatility'].map(normalizeDisplayKey).includes(normalized)) {
    return 'volatility';
  }

  if (['과세구분', 'taxstatus', 'taxtreatment'].map(normalizeDisplayKey).includes(normalized)) {
    return 'taxStatus';
  }

  if (['비교지수', '벤치마크', 'benchmark'].map(normalizeDisplayKey).includes(normalized)) {
    return 'benchmark';
  }

  return null;
}

export function formatFieldLabel(label, language = 'ko') {
  const key = resolveFieldLabelKey(label);
  if (!key) {
    return normalizePortfolioVocabulary(label);
  }

  return textFor(language).fieldLabels[key] ?? label;
}

const CORE_ATOM_INFO_FIELDS = [
  { key: 'region', label: '투자 지역' },
  { key: 'sector', label: '분야' },
  { key: 'style', label: '투자 스타일' },
  { key: 'risk', label: '위험 등급' },
];
const HIDDEN_ATOM_INFO_FIELD_KEYS = new Set(['assetClass']);
const HIDDEN_ATOM_INFO_FIELD_LABELS = [
  '날짜',
  '일자',
  'date',
  'day',
  '전일대비',
  '전일 대비',
  'previousChange',
  'changeAmount',
  '시세시각',
  '시세 시각',
  'marketUpdatedAt',
  'quoteTime',
  '시세출처',
  '시세 출처',
  'marketSource',
  'quoteSource',
  '자산군',
  '자산 구분',
  '자산구분',
  '자산 유형',
  'assetClass',
  'assetType',
].map(normalizeDisplayKey);

export function atomInfoFallbackValue(language = 'ko') {
  return language === 'en' ? 'Checking' : '확인 중';
}

export function buildAtomInfoFields(atom, language = 'ko') {
  if (!atom) {
    return [];
  }

  const fields = Array.isArray(atom.fields) ? atom.fields : [];
  const resolvedFields = [];
  const seenKeys = new Set();
  const seenLabels = new Set();
  const fallbackValue = atomInfoFallbackValue(language);

  const pushField = (label, value) => {
    const trimmedLabel = normalizePortfolioVocabulary(label).trim();
    const trimmedValue = String(value ?? '').trim();

    if (!trimmedLabel || !trimmedValue) {
      return;
    }

    const resolvedKey = resolveFieldLabelKey(trimmedLabel);
    if (
      HIDDEN_ATOM_INFO_FIELD_KEYS.has(resolvedKey) ||
      HIDDEN_ATOM_INFO_FIELD_LABELS.includes(normalizeDisplayKey(trimmedLabel))
    ) {
      return;
    }

    const dedupeKey = resolvedKey || normalizeDisplayKey(trimmedLabel);
    if (dedupeKey && seenKeys.has(dedupeKey)) {
      return;
    }

    if (seenLabels.has(trimmedLabel)) {
      return;
    }

    if (dedupeKey) {
      seenKeys.add(dedupeKey);
    }
    seenLabels.add(trimmedLabel);
    resolvedFields.push({ label: trimmedLabel, value: trimmedValue });
  };

  CORE_ATOM_INFO_FIELDS.forEach(({ key, label }) => {
    const matchedField = fields.find((field) => resolveFieldLabelKey(field?.label) === key);
    const matchedValue = String(matchedField?.value ?? '').trim();
    const atomValue = String(atom[key] ?? '').trim();

    pushField(label, matchedValue || atomValue || fallbackValue);
  });

  fields.forEach((field) => {
    pushField(field?.label, field?.value);
  });

  return resolvedFields;
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

export function normalizeMetaValue(value, max = 22) {
  return compactLabel(value.trim(), max);
}

export function createContributionPreview(items) {
  const columns = 4;
  const rows = 4;
  const total = columns * rows;
  const baseSeed = items.reduce(
    (accumulator, item, index) => {
      let hash = 0;
      const str = String(item.label ?? '');
      for (let i = 0; i < str.length; i++) hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
      let hash2 = 0;
      const str2 = String(item.detail ?? '');
      for (let i = 0; i < str2.length; i++) hash2 = (Math.imul(31, hash2) + str2.charCodeAt(i)) | 0;
      return accumulator + Math.abs(hash) * (index + 1) + Math.abs(hash2);
    },
    17,
  );

  const cells = Array.from({ length: total }, (_, index) => {
    const signal = noise(baseSeed + index * 19);
    const intensitySignal = noise(baseSeed + 401 + index * 13);
    const positive = signal > 0.42;
    const hasData = signal > 0.22;
    return {
      key: `contribution-${index}`,
      hasData,
      positive: hasData ? positive : false,
      intensity: hasData ? 0.22 + intensitySignal * 0.78 : 0,
    };
  });

  return { cells, columns, rows };
}
