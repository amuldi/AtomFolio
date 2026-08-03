import { enrichPortfolioItem, resolveExactSecurityReferenceCode } from './securityKnowledge.js';

const HEADER_KEYWORDS = [
  'ticker',
  'symbol',
  'code',
  'name',
  'security',
  'asset',
  'assetclass',
  'assettype',
  'assetname',
  'securityname',
  'productname',
  'weight',
  'allocation',
  'ratio',
  'share',
  'quantity',
  'date',
  'day',
  'price',
  'buyprice',
  'buydate',
  'region',
  'country',
  'sector',
  'industry',
  'style',
  'strategy',
  'risk',
  'acct',
  'acctid',
  'accountid',
  'accountnumber',
  'ordertype',
  'buysell',
  'account',
  'accounttype',
  'accountkind',
  'currency',
  'benchmark',
  '종목',
  '종목명',
  '자산명',
  '상품명',
  '보유',
  '비중',
  '수량',
  '매수',
  '매입',
  '현재가',
  '손익',
  '평가손익',
  '시가총액',
  '지역',
  '분야',
  '스타일',
  '위험',
  '자산',
  '계좌',
  '계좌유형',
  '계좌종류',
  '통화',
  '금액',
  'return',
  'dailyreturn',
  'cumulativereturn',
];
const KNOWN_CURRENCY_CODES = new Set([
  'USD',
  'KRW',
  'EUR',
  'JPY',
  'CNY',
  'HKD',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
]);
const NON_STOCK_LABEL_FIELD_KEYS = new Set([
  'accountId',
  'accountType',
  'buyDate',
  'buyPrice',
  'shares',
  'return',
  'region',
  'sector',
  'style',
  'risk',
  'assetClass',
  'currency',
  'marketCapClass',
  'volatility',
  'taxStatus',
  'benchmark',
]);
const ACCOUNT_TYPE_PATTERN =
  /^(isa|irp|ira|cma|cma-rp|mmf|rp|연금|연금저축|퇴직연금|개인연금|중개형isa|일반계좌|종합계좌|증권계좌|해외주식|국내주식|계좌)$/i;
const ACCOUNT_ID_PATTERN = /^[A-Z]{1,3}\d{5,12}$/i;
const TRADE_META_PATTERN =
  /^(buy|sell|nasdaq|nyse|arca|bats|iex|smart|mkt|lmt|stop|stp|market|limit|day|gtc|ioc|fok|open|close|o|c|a)$/i;
const SECURITY_BRAND_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|etf|etn|fund|trust)/i;
const COMPANY_NAME_HINT_PATTERN =
  /(inc|corp|corporation|co\.?|company|ltd|limited|plc|holdings?|group|pharma|therapeutics|bank|energy|systems|technologies|motors?|semiconductor|전자|화학|금융|은행|제약|바이오|홀딩스?|건설|증권|통신|식품|에너지|반도체)/i;
const GENERIC_META_EXACT_PATTERN =
  /^(high|medium|low|taxable|stock|stocks|equity|equities|etf|fund|bond|bonds|reit|cash|commodity|crypto|growth|value|dividend|defensive|blend|income|quality|momentum|미국|한국|국내|해외|글로벌|선진국(?:가)?|신흥국(?:가)?|유럽|일본|중국|홍콩|캐나다|기술|반도체|금융|에너지|바이오|헬스|소재|자동차|배터리|인터넷|플랫폼|부동산|소비재|산업재|주식|채권|리츠|원자재|펀드|현금|성장주|가치주|배당주|방어형|분산형|고위험|중위험|저위험|대형주|중형주|소형주|large\\s*cap|mid\\s*cap|small\\s*cap|mega\\s*cap|developed(?:\\s*markets?)?|emerging(?:\\s*markets?)?|europe|japan|china|hong\\s*kong|canada|technology|semiconductor|financials?|energy|biotech|health|materials?|automobile|battery|internet|platform|real\\s*estate|consumer|industrial)$/i;
const GENERIC_META_TOKEN_PATTERN =
  /(지역|국가|시장|분야|업종|산업|섹터|스타일|전략|팩터|위험|등급|변동성|자산군|자산구분|규모|시가총액|country|region|market|sector|industry|style|strategy|factor|risk|grade|volatility|asset\\s*class|asset\\s*type|market\\s*cap|cap\\s*class)/i;
const SECURITY_NAME_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|s&p|nasdaq|dow|russell|msci|kospi|kosdaq|etf|etn|fund|trust|미국|글로벌|반도체|배당|테크|성장|채권|금리|리츠|부동산)/i;
const STRATEGY_DESCRIPTOR_PATTERN =
  /^(월적립|정액적립|적립식|분할매수|분할매도|추가매수|장기보유|장기투자|현금대기|리밸런싱|단기매매|스윙|모멘텀|dca|rebalance|hold|buy\s*and\s*hold|buyandhold|accumulate|swing)$/i;
const SECURITY_EXCHANGE_SUFFIX_PATTERN = /\.(KS|KQ|BA|TO|V|DU|L|HK|SS|SZ|T)$/i;

function compactLabel(value, max = 18) {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDisplayKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

const LEGACY_ATOM_TERM_PATTERN = new RegExp(`원${'자'}(?!재)`, 'g');

function normalizePortfolioVocabulary(value) {
  return String(value ?? '').replace(LEGACY_ATOM_TERM_PATTERN, '포트폴리오');
}

function resolveFieldLabelKey(label) {
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

  if (['계좌id', '계좌번호', '계좌코드', '포트폴리오id', '포트폴리오번호', '포트폴리오코드', 'acctid', 'accountid', 'accountnumber'].map(normalizeDisplayKey).includes(normalized)) {
    return 'accountId';
  }

  if (['계좌유형', '계좌종류', '계좌구분', '계좌명', '포트폴리오 유형', '포트폴리오종류', '포트폴리오구분', '포트폴리오명', 'accounttype', 'accountkind', 'accountclass'].map(normalizeDisplayKey).includes(normalized)) {
    return 'accountType';
  }

  if (
    [
      '날짜',
      '일자',
      '기준일',
      '기준일자',
      '거래일',
      '거래일자',
      '거래일시',
      '매매일',
      '매매일자',
      '체결일',
      '체결일시',
      '평가일',
      '조회일',
      '조회일자',
      '매수일',
      '매입일',
      '취득일',
      'date',
      'day',
      'datetime',
      'timestamp',
      'tradedate',
      'tradingdate',
      'executiondate',
      'settlementdate',
      'orderdate',
      'recorddate',
      'valuedate',
      'valuationdate',
      'snapshotdate',
      'asofdate',
      'buydate',
      'purchasedate',
      'entrydate',
      'acquisitiondate',
    ]
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'buyDate';
  }

  if (['매수가', '매입가', 'buyprice', 'purchaseprice', 'entryprice'].map(normalizeDisplayKey).includes(normalized)) {
    return 'buyPrice';
  }

  if (['보유수량', '수량', 'shares', 'quantity'].map(normalizeDisplayKey).includes(normalized)) {
    return 'shares';
  }

  if (
    [
      '수익률',
      '수익율',
      '등락률',
      '변동률',
      '손익률',
      '손익율',
      '평가손익률',
      '일별수익률',
      '일일수익률',
      '일간수익률',
      '누적수익률',
      '총수익률',
      'return',
      'returns',
      'returnpct',
      'returnrate',
      'rateofreturn',
      'dailyreturn',
      'cumulativereturn',
      'totalreturn',
      'profitrate',
      'dailypnlrate',
      'performance',
      'change',
      'yield',
    ]
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
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

  if (['전략', '매수전략', '투자전략'].map(normalizeDisplayKey).includes(normalized)) {
    return 'style';
  }

  if (['위험등급', '위험', '리스크', 'risk', 'riskgrade', 'risklevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'risk';
  }

  if (['자산구분', 'assetclass', 'assettype', 'assetcategory'].map(normalizeDisplayKey).includes(normalized)) {
    return 'assetClass';
  }

  if (['통화', 'currency', 'fx', 'quotedcurrency'].map(normalizeDisplayKey).includes(normalized)) {
    return 'currency';
  }

  if (['규모분류', '시가총액분류', 'marketcap', 'marketcapclass', 'capstyle'].map(normalizeDisplayKey).includes(normalized)) {
    return 'marketCapClass';
  }

  if (['변동성', 'volatility', 'volatilitylevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'volatility';
  }

  if (['과세구분', 'taxstatus', 'taxtreatment', 'taxable'].map(normalizeDisplayKey).includes(normalized)) {
    return 'taxStatus';
  }

  if (['비교지수', '벤치마크', 'benchmark', 'referenceindex'].map(normalizeDisplayKey).includes(normalized)) {
    return 'benchmark';
  }

  return null;
}

function countCharacter(value, character) {
  return value.split(character).length - 1;
}

function detectDelimiter(text) {
  const candidates = [',', '\t', ';', '|'];
  const sample = String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 14)
    .join('\n');

  return candidates.reduce((best, candidate) => {
    const candidateScore = scoreDelimiterCandidate(sample, candidate);
    const bestScore = scoreDelimiterCandidate(sample, best);
    return candidateScore > bestScore ? candidate : best;
  });
}

function parseSeparatedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      const next = text[index + 1];

      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }

      row.push(cell);
      if (row.some((entry) => entry.trim())) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some((entry) => entry.trim())) {
    rows.push(row);
  }

  return rows;
}

function scoreDelimiterCandidate(text, delimiter) {
  const rows = parseSeparatedText(text, delimiter);
  const multiColumnRows = rows.filter((row) => row.length > 1);

  if (!multiColumnRows.length) {
    return 0;
  }

  const columnCounts = multiColumnRows.map((row) => row.length);
  const countFrequencies = new Map();
  columnCounts.forEach((count) => {
    countFrequencies.set(count, (countFrequencies.get(count) ?? 0) + 1);
  });
  const mostCommonColumnCount = [...countFrequencies.entries()].sort(
    ([countA, frequencyA], [countB, frequencyB]) => frequencyB - frequencyA || countB - countA,
  )[0]?.[0] ?? 1;
  const consistency =
    columnCounts.filter((count) => count === mostCommonColumnCount).length / columnCounts.length;
  const averageColumnCount =
    columnCounts.reduce((sum, count) => sum + count, 0) / Math.max(1, columnCounts.length);
  const headerScore = rows.reduce((best, row, index) => {
    const values = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
    if (values.length < 2) {
      return best;
    }

    const recognizedCount = values.filter(looksLikeRecognizedHeaderCell).length;
    const recognizedRatio = recognizedCount / values.length;
    const rowLooksLikeHeader =
      looksLikeHeader(row) || looksLikeExplicitHeaderRow(row) || recognizedCount >= 2;

    if (!rowLooksLikeHeader) {
      return best;
    }

    return Math.max(
      best,
      60 + recognizedRatio * 30 + Math.min(values.length, 12) - Math.min(index, 6),
    );
  }, 0);

  return (
    headerScore +
    multiColumnRows.length * 4 +
    consistency * 20 +
    Math.min(averageColumnCount, 12) +
    Math.min(countCharacter(text, delimiter), 40) * 0.1
  );
}

function looksLikeHeader(row) {
  return row
    .map((cell) => normalizeHeader(cell))
    .some((cell) => HEADER_KEYWORDS.some((keyword) => cell.includes(keyword)));
}

function isPlaceholderHeaderLabel(label) {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]:]+/g, '');

  if (!normalized) {
    return true;
  }

  return /^(?:column|col|field|header|value|item|attribute|unnamed|untitled)(?:[a-z]+)?\d*$/i.test(normalized);
}

function looksLikeRecognizedHeaderCell(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return false;
  }

  if (isPlaceholderHeaderLabel(trimmed) || resolveFieldLabelKey(trimmed)) {
    return true;
  }

  const normalized = normalizeHeader(trimmed);
  return HEADER_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function matchRatio(values, predicate) {
  if (!values.length) {
    return 0;
  }

  return values.filter((value) => predicate(value)).length / values.length;
}

function looksLikeExplicitHeaderRow(row) {
  const values = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
  if (values.length < 2) {
    return false;
  }

  return matchRatio(values, looksLikeRecognizedHeaderCell) >= 0.45;
}

function looksLikePlaceholderHeaderRow(row) {
  const values = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
  if (values.length < 2) {
    return false;
  }

  return matchRatio(values, isPlaceholderHeaderLabel) >= 0.6;
}

function pickColumnIndex(headers, candidates) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate)),
  );
}

function pickResolvedFieldIndex(fieldKeys, fallbackHeaders, key, candidates = []) {
  const resolvedIndex = fieldKeys.findIndex((fieldKey) => fieldKey === key);
  if (resolvedIndex >= 0) {
    return resolvedIndex;
  }

  return pickColumnIndex(fallbackHeaders, candidates);
}

function distinctValueCount(values, normalize = normalizeDisplayKey) {
  return new Set(values.map((value) => normalize(value)).filter(Boolean)).size;
}

function createStrictDateParts(yearValue, monthValue, dayValue) {
  const year = Number.parseInt(String(yearValue), 10);
  const month = Number.parseInt(String(monthValue), 10);
  const day = Number.parseInt(String(dayValue), 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatDateParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function parseDateParts(value, options = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^\ufeff/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]\s*$/g, '')
    .trim();
  const localizedDateMatch = normalized.match(
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/,
  );
  if (localizedDateMatch) {
    return createStrictDateParts(localizedDateMatch[1], localizedDateMatch[2], localizedDateMatch[3]);
  }

  const compactMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const compactDate = createStrictDateParts(compactMatch[1], compactMatch[2], compactMatch[3]);
    if (compactDate) {
      return compactDate;
    }
  }

  if (options.allowExcelSerial && /^\d{5}(?:\.0+)?$/.test(normalized)) {
    const serial = Number.parseInt(normalized, 10);
    if (serial >= 25569 && serial <= 73050) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + serial * 86400000);
      return createStrictDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }

  const isoDateTimeMatch = normalized.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)?/i,
  );
  if (isoDateTimeMatch) {
    return createStrictDateParts(isoDateTimeMatch[1], isoDateTimeMatch[2], isoDateTimeMatch[3]);
  }

  const shortDateMatch = normalized.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]+(?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)?/i,
  );
  if (shortDateMatch) {
    const [, first, second, rawYear] = shortDateMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const firstNumber = Number.parseInt(first, 10);
    const secondNumber = Number.parseInt(second, 10);
    const dayFirst = firstNumber > 12 && secondNumber <= 12;
    return dayFirst
      ? createStrictDateParts(year, second, first)
      : createStrictDateParts(year, first, second);
  }

  return null;
}

function formatAtomDateLabel(value) {
  const parsed = parseDateParts(value, { allowExcelSerial: true });
  if (parsed) {
    return formatDateParts(parsed);
  }

  return String(value ?? '').trim();
}

function isTickerLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (KNOWN_CURRENCY_CODES.has(trimmed.toUpperCase())) {
    return false;
  }

  if (/^\d{8}$/.test(trimmed) && isDateLikeValue(trimmed)) {
    return false;
  }

  return /^([A-Z]{1,5}(?:\.[A-Z])?|[A-Z]{1,6}|[0-9]{4,8})$/.test(trimmed);
}

function isAlphabeticTickerLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || KNOWN_CURRENCY_CODES.has(trimmed.toUpperCase()) || isDateLikeValue(trimmed)) {
    return false;
  }

  return /^[A-Z]{1,10}(?:[.-][A-Z]{1,4})?$/i.test(trimmed);
}

function isNumericSecurityCodeLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isDateLikeValue(trimmed)) {
    return false;
  }

  return /^\d{6}(?:\.(?:KS|KQ))?$/i.test(trimmed);
}

function isDateLikeValue(value) {
  return Boolean(parseDateParts(value));
}

function isNumericLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric);
}

function isShareLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  return /^\d+(?:\.\d+)?(?:\s*(?:주|shares?|sh))?$/i.test(trimmed);
}

function isPriceLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || !isNumericLikeValue(trimmed)) {
    return false;
  }

  return /[$₩€¥]|krw|usd|eur|jpy|원|달러/i.test(trimmed) || Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, '')) >= 1;
}

function isAccountTypeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (ACCOUNT_ID_PATTERN.test(trimmed) || ACCOUNT_TYPE_PATTERN.test(trimmed)) {
    return true;
  }

  return /(account|brokerage|pension|retirement|taxable|deferred|절세계좌|퇴직|연금|계좌)/i.test(trimmed);
}

function hasSecurityNameContext(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  return (
    isTickerLikeValue(trimmed) ||
    SECURITY_BRAND_HINT_PATTERN.test(trimmed) ||
    COMPANY_NAME_HINT_PATTERN.test(trimmed)
  );
}

function isGenericMetaValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (STRATEGY_DESCRIPTOR_PATTERN.test(trimmed)) {
    return true;
  }

  if (GENERIC_META_EXACT_PATTERN.test(trimmed)) {
    return true;
  }

  if (hasSecurityNameContext(trimmed)) {
    return false;
  }

  return GENERIC_META_TOKEN_PATTERN.test(trimmed);
}

function looksLikeFreeTextName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (
    isTickerLikeValue(trimmed) ||
    isDateLikeValue(trimmed) ||
    KNOWN_CURRENCY_CODES.has(trimmed.toUpperCase()) ||
    ACCOUNT_ID_PATTERN.test(trimmed) ||
    TRADE_META_PATTERN.test(trimmed)
  ) {
    return false;
  }

  if (STRATEGY_DESCRIPTOR_PATTERN.test(trimmed)) {
    return false;
  }

  if (/(s&p|nasdaq|dow|russell|msci|kospi|kosdaq|benchmark|index)/i.test(trimmed)) {
    return false;
  }

  if (isGenericMetaValue(trimmed)) {
    return false;
  }

  if (
    /^(stock|stocks|equity|equities|etf|fund|bond|bonds|reit|cash|commodity|crypto|개별주식|주식\s*etf|채권\s*etf|채권|리츠|현금성\s*자산|원자재|디지털\s*자산)$/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  return /[a-z]/i.test(trimmed) || /[가-힣]/.test(trimmed);
}

function isLikelySecurityName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isAccountTypeValue(trimmed) || TRADE_META_PATTERN.test(trimmed)) {
    return false;
  }

  if (STRATEGY_DESCRIPTOR_PATTERN.test(trimmed)) {
    return false;
  }

  if (isGenericMetaValue(trimmed)) {
    return false;
  }

  if (looksLikeFreeTextName(trimmed) || isTickerLikeValue(trimmed)) {
    return true;
  }

  return SECURITY_NAME_HINT_PATTERN.test(trimmed);
}

function findBestSecurityNameColumnIndex(headerLabels, fieldKeys, bodyRows) {
  const columnCount = Math.max(headerLabels.length, ...bodyRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows.map((row) => String(row[columnIndex] ?? '').trim()).filter(Boolean);
    return {
      columnIndex,
      values,
      headerLabel: headerLabels[columnIndex] ?? `Column ${columnIndex + 1}`,
      fieldKey: fieldKeys[columnIndex] ?? resolveFieldLabelKey(headerLabels[columnIndex] ?? ''),
    };
  }).filter(({ values }) => values.length > 0);

  const bestColumn = columns
    .map((column) => ({
      ...column,
      score: scoreSecurityNameColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)[0];

  return bestColumn && bestColumn.score >= 0.5 ? bestColumn.columnIndex : -1;
}

function inferHeaderLabels(headerLabels, bodyRows) {
  const labels = [...headerLabels];
  const columnCount = Math.max(labels.length, ...bodyRows.map((row) => row.length));
  const candidateDefinitions = [
    { key: 'stockCode', label: '종목 티커', minScore: 0.72, score: (values) => matchRatio(values, isTickerLikeValue) },
    { key: 'accountType', label: '포트폴리오 유형', minScore: 0.74, score: (values) => matchRatio(values, isAccountTypeValue) },
    { key: 'buyDate', label: '날짜', minScore: 0.8, score: (values) => matchRatio(values, isDateLikeValue) },
    { key: 'buyPrice', label: '매수가', minScore: 0.76, score: (values) => matchRatio(values, isPriceLikeValue) },
    { key: 'shares', label: '보유수량', minScore: 0.78, score: (values) => matchRatio(values, isShareLikeValue) },
    {
      key: 'return',
      label: '수익률',
      minScore: 0.72,
      score: (values) =>
        matchRatio(values, (value) => {
          const trimmed = String(value ?? '').trim();
          const parsed = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
          return (
            Number.isFinite(parsed) &&
            !isDateLikeValue(trimmed) &&
            (trimmed.includes('%') || /^[+-]/.test(trimmed) || Math.abs(parsed) <= 100)
          );
        }),
    },
  ];

  const scoredMatches = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const values = bodyRows.map((row) => String(row[columnIndex] ?? '').trim()).filter(Boolean);
    if (!values.length) {
      continue;
    }

    candidateDefinitions.forEach((candidate) => {
      const score = candidate.score(values);
      if (score >= candidate.minScore) {
        scoredMatches.push({ columnIndex, key: candidate.key, label: candidate.label, score });
      }
    });
  }

  scoredMatches
    .sort((left, right) => right.score - left.score)
    .forEach(({ columnIndex, key, label }) => {
      const alreadyAssignedKey = labels.some((currentLabel) => resolveFieldLabelKey(currentLabel) === key);
      if (alreadyAssignedKey) {
        return;
      }

      const currentLabel = labels[columnIndex] ?? '';
      if (!isPlaceholderHeaderLabel(currentLabel)) {
        return;
      }

      labels[columnIndex] = label;
    });

  const inferredNameColumnIndex = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows.map((row) => String(row[columnIndex] ?? '').trim()).filter(Boolean);
    return { columnIndex, score: matchRatio(values, isLikelySecurityName), values };
  })
    .filter(({ values }) => values.length > 0)
    .sort((left, right) => right.score - left.score)
    .find(({ columnIndex, score }) => {
      const currentLabel = labels[columnIndex] ?? '';
      return isPlaceholderHeaderLabel(currentLabel) && score >= 0.68;
    });

  const hasAssignedStockName = labels.some((currentLabel) => resolveFieldLabelKey(currentLabel) === 'stockName');
  if (inferredNameColumnIndex && !hasAssignedStockName) {
    labels[inferredNameColumnIndex.columnIndex] = '종목명';
  }

  return Array.from({ length: columnCount }, (_, index) => labels[index] || `Column ${index + 1}`);
}

function scoreSecurityNameColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const securityRatio = matchRatio(values, isLikelySecurityName);
  const securityContextRatio = matchRatio(values, hasSecurityNameContext);
  const accountRatio = matchRatio(values, isAccountTypeValue);
  const dateRatio = matchRatio(values, isDateLikeValue);
  const numericRatio = matchRatio(
    values,
    (value) => isNumericLikeValue(value) && !isTickerLikeValue(value),
  );
  const shortNumericRatio = matchRatio(values, (value) => /^\d{1,3}(?:\.\d+)?$/.test(String(value ?? '').trim()));
  const metaValueRatio = matchRatio(
    values,
    (value) => isGenericMetaValue(value),
  );
  const strategyRatio = matchRatio(values, (value) => STRATEGY_DESCRIPTOR_PATTERN.test(String(value ?? '').trim()));
  const numericOnlyRatio = matchRatio(values, (value) => /^[+-]?\d+(?:\.\d+)?$/.test(String(value ?? '').trim()));
  let bonus = 0;

  if (fieldKey === 'stockName') {
    bonus += 0.18;
  }

  if (fieldKey === 'stockCode') {
    bonus -= 1.6;
  }

  if (/(assetname|securityname|productname|자산명|상품명)/.test(normalizedHeader)) {
    bonus += 0.24;
  }

  if (/(name|security|company|종목명)/.test(normalizedHeader)) {
    bonus += 0.14;
  }

  if (
    fieldKey === 'accountId' ||
    fieldKey === 'accountType' ||
    /(acctid|accountid|accountnumber|accounttype|accountkind|accountclass|계좌id|계좌번호|계좌유형|계좌종류|계좌)/.test(
      normalizedHeader,
    )
  ) {
    bonus -= 0.9;
  }

  if (
    fieldKey &&
    [
      'accountId',
      'accountType',
      'buyDate',
      'buyPrice',
      'shares',
      'return',
      'region',
      'sector',
      'style',
      'risk',
      'assetClass',
      'currency',
      'marketCapClass',
      'volatility',
      'taxStatus',
      'benchmark',
    ].includes(fieldKey)
  ) {
    bonus -= 0.9;
  }

  if (
    /(date|day|buydate|tradedate|recorddate|valuedate|매수일|날짜|일자|계좌|account|region|country|market|분야|sector|industry|style|risk|assetclass|currency|marketcap|volatility|tax|benchmark|return|performance|change|shares|quantity|buyprice|price)/.test(
      normalizedHeader,
    )
  ) {
    bonus -= 0.82;
  }

  if (/(comment|memo|note|description|remark|코멘트|메모|비고|설명)/.test(normalizedHeader)) {
    bonus -= 1.25;
  }

  if (/(ticker|symbol|stockcode|securitycode|assetcode|productcode|종목코드|종목티커|티커)/.test(normalizedHeader)) {
    bonus -= 1.1;
  }

  if (/(volume|거래량|체결량|수량|shares|quantity|price|현재가|매수가|매입가|평가금액|금액|amount|value)/.test(normalizedHeader)) {
    bonus -= 1.35;
  }

  if (/(strategy|investmentstyle|tradestyle|매수전략|투자전략|전략)/.test(normalizedHeader)) {
    bonus -= 1.04;
  }

  return (
    securityRatio -
    strategyRatio * 1.24 +
    securityContextRatio * 0.92 -
    accountRatio * 1.25 -
    dateRatio * 1.1 -
    numericRatio * 0.95 -
    numericOnlyRatio * 0.9 -
    shortNumericRatio * 1.35 -
    metaValueRatio * 1.2 +
    bonus
  );
}

function scoreAccountTypeColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const securityRatio = matchRatio(values, isLikelySecurityName);
  const accountRatio = matchRatio(
    values,
    (value) => isAccountTypeValue(value) && !ACCOUNT_ID_PATTERN.test(String(value ?? '').trim()),
  );
  let bonus = 0;

  if (fieldKey === 'accountType') {
    bonus += 0.24;
  }

  if (/(accounttype|accountkind|accountclass|계좌유형|계좌종류|계좌)/.test(normalizedHeader)) {
    bonus += 0.28;
  }

  return accountRatio - securityRatio * 1.15 + bonus;
}

function scoreAccountIdColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const idRatio = matchRatio(values, (value) => ACCOUNT_ID_PATTERN.test(String(value ?? '').trim()));
  let bonus = 0;

  if (fieldKey === 'accountId') {
    bonus += 0.28;
  }

  if (/(acctid|accountid|accountnumber|계좌id|계좌번호|계좌코드)/.test(normalizedHeader)) {
    bonus += 0.3;
  }

  if (fieldKey === 'stockName' || fieldKey === 'stockCode') {
    bonus -= 0.4;
  }

  return idRatio + bonus;
}

function normalizePortfolioFieldLabels(headerLabels, bodyRows) {
  const labels = [...headerLabels];
  const columnCount = Math.max(labels.length, ...bodyRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows.map((row) => String(row[columnIndex] ?? '').trim()).filter(Boolean);
    return {
      columnIndex,
      values,
      headerLabel: labels[columnIndex] ?? `Column ${columnIndex + 1}`,
      fieldKey: resolveFieldLabelKey(labels[columnIndex] ?? ''),
    };
  }).filter(({ values }) => values.length > 0);

  const bestTickerColumn = [...columns]
    .map((column) => ({
      ...column,
      score: scoreTickerColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.82);

  if (bestTickerColumn) {
    labels[bestTickerColumn.columnIndex] = '종목 티커';
  }

  const bestSecurityColumn = [...columns]
    .filter((column) => column.columnIndex !== bestTickerColumn?.columnIndex)
    .map((column) => ({
      ...column,
      score: scoreSecurityNameColumn(
        labels[column.columnIndex] ?? column.headerLabel,
        resolveFieldLabelKey(labels[column.columnIndex] ?? column.headerLabel) ?? column.fieldKey,
        column.values,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.5);

  if (bestSecurityColumn) {
    labels[bestSecurityColumn.columnIndex] = '종목명';
  }

  const bestAccountIdColumn = [...columns]
    .filter((column) => column.columnIndex !== bestSecurityColumn?.columnIndex)
    .map((column) => ({
      ...column,
      score: scoreAccountIdColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.78);

  if (bestAccountIdColumn) {
    labels[bestAccountIdColumn.columnIndex] = '포트폴리오 ID';
  }

  const bestAccountColumn = [...columns]
    .filter(
      (column) =>
        column.columnIndex !== bestSecurityColumn?.columnIndex &&
        column.columnIndex !== bestAccountIdColumn?.columnIndex,
    )
    .map((column) => ({
      ...column,
      score: scoreAccountTypeColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.7);

  if (bestAccountColumn) {
    labels[bestAccountColumn.columnIndex] = '포트폴리오 유형';
  }

  return labels;
}

function selectPortfolioLabelStrategy({ bodyRows, headers, fieldKeys, dateIndex, nameIndex, tickerIndex }) {
  if (dateIndex < 0 || bodyRows.length < 8) {
    return 'security';
  }

  const dateValues = bodyRows.map((row) => String(row[dateIndex] ?? '').trim()).filter(Boolean);
  if (dateValues.length < 8) {
    return 'security';
  }

  const dateDistinctCount = distinctValueCount(dateValues, formatAtomDateLabel);
  if (dateDistinctCount / dateValues.length < 0.45) {
    return 'security';
  }

  const securityIndex = nameIndex >= 0 ? nameIndex : tickerIndex;
  const securityValues =
    securityIndex >= 0
      ? bodyRows.map((row) => String(row[securityIndex] ?? '').trim()).filter(Boolean)
      : [];
  const securityDistinctCount = securityValues.length ? distinctValueCount(securityValues) : Number.POSITIVE_INFINITY;
  const hasDailySeriesHeaders = headers.some(
    (header) =>
      header.includes('일별수익률') ||
      header.includes('일간수익률') ||
      header.includes('일일수익률') ||
      header.includes('누적수익률') ||
      header.includes('dailyreturn') ||
      header.includes('dailypnlrate') ||
      header.includes('cumulativereturn'),
  );
  const hasTimeSeriesMetricHeaders = headers.some(
    (header) =>
      header.includes('초기금액') ||
      header.includes('평가금액') ||
      header.includes('initialamount') ||
      header.includes('marketvalue') ||
      header.includes('valuation'),
  );
  const hasGenericDateHeader =
    fieldKeys[dateIndex] === 'buyDate' ||
    headers[dateIndex]?.includes('날짜') ||
    headers[dateIndex]?.includes('일자') ||
    headers[dateIndex]?.includes('거래일') ||
    headers[dateIndex]?.includes('매매일') ||
    headers[dateIndex]?.includes('체결일') ||
    headers[dateIndex]?.includes('date');

  if (
    hasGenericDateHeader &&
    (hasDailySeriesHeaders || hasTimeSeriesMetricHeaders) &&
    securityDistinctCount <= Math.max(8, Math.round(dateDistinctCount * 0.35)) &&
    dateDistinctCount >= securityDistinctCount * 2
  ) {
    return 'date';
  }

  return 'security';
}

function formatReturnDetail(value, label = '') {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/[−–—]/g, '-');
  const numeric = Number.parseFloat(normalized.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return '';
  }
  const signedNumeric =
    (/^\(.*\)$/.test(normalized) || /(?:손실|loss|▼|↓)/i.test(normalized)) && numeric > 0
      ? -numeric
      : numeric;

  const labelText = String(label ?? '').trim();
  const explicitPercent =
    /%|pct|percent|수익률\(%\)|수익율\(%\)|손익률\(%\)|손익율\(%\)|등락률\(%\)|변동률\(%\)/i.test(
      labelText,
    );
  const percentValue =
    explicitPercent || normalized.includes('%') || Math.abs(signedNumeric) > 1
      ? signedNumeric
      : signedNumeric * 100;
  const fixed = percentValue
    .toFixed(Math.abs(percentValue) >= 10 ? 1 : 2)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0$/, '');
  return `${percentValue > 0 ? '+' : ''}${fixed}%`;
}

function findPortfolioFieldValue(item, predicate) {
  for (const field of item.fields ?? []) {
    const label = String(field.label ?? '').trim();
    if (!label || !predicate(label, resolveFieldLabelKey(label))) {
      continue;
    }

    const value = String(field.value ?? '').trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function stripSecurityExchangeSuffix(value) {
  return String(value ?? '').trim().replace(SECURITY_EXCHANGE_SUFFIX_PATTERN, '');
}

function resolveCanonicalSecurityIdentityCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  return normalizeDisplayKey(resolveExactSecurityReferenceCode([raw, stripSecurityExchangeSuffix(raw)]));
}

function normalizeSecurityIdentityValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  const canonicalCode = resolveCanonicalSecurityIdentityCode(raw);
  if (canonicalCode) {
    return canonicalCode;
  }

  return normalizeDisplayKey(stripSecurityExchangeSuffix(raw) || raw);
}

function formatPortfolioSecurityIdentity(type, value) {
  const normalized = normalizeSecurityIdentityValue(value);
  return normalized ? `${type}:${normalized}` : '';
}

function extractPortfolioItemDateValue(item) {
  return findPortfolioFieldValue(
    item,
    (label, key) =>
      key === 'buyDate' ||
      /(날짜|일자|기준일|거래일|매매일|체결일|평가일|조회일|date|day|datetime|timestamp|tradedate|tradingdate|executiondate|recorddate|valuedate|valuationdate|snapshotdate)/i.test(label),
  );
}

function extractPortfolioItemCumulativeReturnValue(item) {
  return findPortfolioFieldValue(
    item,
    (label) =>
      /(누적수익률|총수익률|cumulativereturn|totalreturn|accumulatedreturn)/i.test(label),
  );
}

function isMeaningfulSecurityIdentity(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isDateLikeValue(trimmed) || isAccountTypeValue(trimmed)) {
    return false;
  }

  if (isTickerLikeValue(trimmed) || looksLikeFreeTextName(trimmed)) {
    return true;
  }

  return /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|s&p|nasdaq|dow|russell|msci|kospi|kosdaq)/i.test(
    trimmed,
  );
}

function resolvePortfolioGroupingName(item) {
  const directName = String(item.name ?? '').trim();
  if (isMeaningfulSecurityIdentity(directName)) {
    return directName;
  }

  const fieldName = findPortfolioFieldValue(
    item,
    (label, key) =>
      key === 'stockName' ||
      /(종목명|자산명|상품명|name|securityname|assetname|productname|companyname)/i.test(label),
  );
  if (isMeaningfulSecurityIdentity(fieldName)) {
    return fieldName;
  }

  const code = String(item.code ?? item.ticker ?? '').trim();
  if (isMeaningfulSecurityIdentity(code)) {
    return code;
  }

  const label = String(item.label ?? '').trim();
  if (isMeaningfulSecurityIdentity(label)) {
    return label;
  }

  return '';
}

function resolvePortfolioSecurityIdentity(item) {
  const directCode = String(item.code ?? item.ticker ?? '').trim();
  if (isMeaningfulSecurityIdentity(directCode)) {
    return formatPortfolioSecurityIdentity('code', directCode);
  }

  const fieldCode = findPortfolioFieldValue(
    item,
    (label, key) =>
      key === 'stockCode' ||
      /(종목코드|종목\s*티커|티커|ticker|symbol|securitycode|assetcode|productcode)/i.test(label),
  );
  if (isMeaningfulSecurityIdentity(fieldCode)) {
    return formatPortfolioSecurityIdentity('code', fieldCode);
  }

  const groupingName = resolvePortfolioGroupingName(item);
  if (isMeaningfulSecurityIdentity(groupingName)) {
    const canonicalCode = resolveCanonicalSecurityIdentityCode(groupingName);
    return canonicalCode ? `code:${canonicalCode}` : formatPortfolioSecurityIdentity('name', groupingName);
  }

  return '';
}

function pickRepresentativePortfolioItem(items) {
  if (!items.length) {
    return null;
  }

  return items.reduce((best, candidate) => {
    const bestDate = extractPortfolioItemDateValue(best);
    const candidateDate = extractPortfolioItemDateValue(candidate);
    if (candidateDate && !bestDate) {
      return candidate;
    }

    if (candidateDate && bestDate && candidateDate > bestDate) {
      return candidate;
    }

    return best;
  }, items[items.length - 1]);
}

function collapsePortfolioItemsForDisplay(items) {
  if (items.length <= 1) {
    return items;
  }

  const groupedItems = new Map();
  items.forEach((item, index) => {
    const securityIdentity = resolvePortfolioSecurityIdentity(item) || `row:${index}`;
    const key = normalizeDisplayKey(securityIdentity);
    if (!key) {
      groupedItems.set(`row:${index}`, [item]);
      return;
    }

    const bucket = groupedItems.get(key);
    if (bucket) {
      bucket.push(item);
      return;
    }

    groupedItems.set(key, [item]);
  });

  const hasDuplicateSecurities = [...groupedItems.values()].some((group) => group.length > 1);
  if (!hasDuplicateSecurities) {
    return items;
  }

  return [...groupedItems.values()]
    .map((group) => {
      const representative = pickRepresentativePortfolioItem(group);
      if (!representative) {
        return null;
      }

      const groupingName = resolvePortfolioGroupingName(representative);
      const cumulativeReturnValue = extractPortfolioItemCumulativeReturnValue(representative);
      const detail = cumulativeReturnValue ? formatReturnDetail(cumulativeReturnValue) : representative.detail;

      return enrichPortfolioItem({
        ...representative,
        label: compactLabel(groupingName || representative.label, 18),
        name: groupingName || representative.name,
        detail,
      });
    })
    .filter(Boolean);
}

function inspectPortfolioTable(text) {
  const normalizedText = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(normalizedText);
  const rows = parseSeparatedText(normalizedText, delimiter);

  if (!rows.length) {
    return {
      delimiter,
      rows: [],
      bodyRows: [],
      headerLabels: [],
      fieldKeys: [],
      headers: [],
      hasDetectedHeader: false,
      skippedPreambleRowCount: 0,
      indexes: {
        dateIndex: -1,
        tickerIndex: -1,
        nameIndex: -1,
        returnIndex: -1,
        regionIndex: -1,
        sectorIndex: -1,
        styleIndex: -1,
        riskIndex: -1,
        assetClassIndex: -1,
      },
    };
  }

  const detectedHeaderIndex = rows.findIndex((row) => {
    if (row.length < 2) {
      return false;
    }

    return looksLikeHeader(row) || looksLikePlaceholderHeaderRow(row) || looksLikeExplicitHeaderRow(row);
  });
  const tableRows = detectedHeaderIndex > 0 ? rows.slice(detectedHeaderIndex) : rows;
  const firstRow = tableRows[0].map((label) => String(label ?? '').trim().replace(/^\uFEFF/, ''));
  const hasDetectedHeader =
    looksLikeHeader(firstRow) ||
    looksLikePlaceholderHeaderRow(firstRow) ||
    looksLikeExplicitHeaderRow(firstRow);
  const rawHeaderLabels = (hasDetectedHeader
    ? firstRow
    : firstRow.map((_, index) => `Column ${index + 1}`)).map((label, index) =>
    label.trim().replace(/^\uFEFF/, '') || `Column ${index + 1}`,
  );
  const bodyRows = hasDetectedHeader ? tableRows.slice(1) : tableRows;
  const headerLabels = normalizePortfolioFieldLabels(inferHeaderLabels(rawHeaderLabels, bodyRows), bodyRows);
  const headers = headerLabels.map(normalizeHeader);
  const fieldKeys = headerLabels.map(resolveFieldLabelKey);

  return {
    delimiter,
    rows,
    bodyRows,
    headerLabels,
    fieldKeys,
    headers,
    hasDetectedHeader,
    skippedPreambleRowCount: detectedHeaderIndex > 0 ? detectedHeaderIndex : 0,
    indexes: {
      dateIndex: pickResolvedFieldIndex(fieldKeys, headers, 'buyDate', [
        'date',
        'day',
        'datetime',
        'timestamp',
        'recorddate',
        'valuedate',
        'valuationdate',
        'tradedate',
        'tradingdate',
        'executiondate',
        'settlementdate',
        'orderdate',
        'snapshotdate',
        'asofdate',
        '날짜',
        '일자',
        '기준일',
        '기준일자',
        '거래일',
        '거래일자',
        '거래일시',
        '매매일',
        '매매일자',
        '체결일',
        '체결일시',
        '평가일',
        '조회일',
        '조회일자',
      ]),
      tickerIndex: pickResolvedFieldIndex(fieldKeys, headers, 'stockCode', ['ticker', 'symbol', 'stockcode', 'securitycode', '종목코드', '종목티커', '티커']),
      nameIndex: findBestSecurityNameColumnIndex(headerLabels, fieldKeys, bodyRows),
      returnIndex: pickResolvedFieldIndex(fieldKeys, headers, 'return', [
        'return',
        'returns',
        'returnpct',
        'returnrate',
        'rateofreturn',
        'dailyreturn',
        'cumulativereturn',
        'totalreturn',
        'profitrate',
        'dailypnlrate',
        'performance',
        'change',
        'yield',
        'gain',
        '수익률',
        '수익율',
        '등락률',
        '변동률',
        '손익률',
        '손익율',
        '평가손익률',
        '일별수익률',
        '일일수익률',
        '일간수익률',
        '누적수익률',
        '총수익률',
      ]),
      regionIndex: pickResolvedFieldIndex(fieldKeys, headers, 'region', ['region', 'geography', 'market', 'country', 'locale', 'area', '투자지역', '지역', '국가']),
      sectorIndex: pickResolvedFieldIndex(fieldKeys, headers, 'sector', ['sector', 'industry', 'theme', '업종', '산업', '섹터', '분야']),
      styleIndex: pickResolvedFieldIndex(fieldKeys, headers, 'style', ['style', 'factor', 'strategy', 'investmentstyle', '스타일', '전략', '투자스타일', '팩터']),
      riskIndex: pickResolvedFieldIndex(fieldKeys, headers, 'risk', ['risk', 'risklevel', 'riskgrade', 'volatility', 'grade', '위험', '위험등급', '리스크']),
      assetClassIndex: pickResolvedFieldIndex(fieldKeys, headers, 'assetClass', ['assetclass', 'assettype', 'assetcategory', '자산구분', '자산군', '자산유형']),
    },
  };
}

function buildParsedItems(inspection) {
  const { bodyRows, headerLabels, fieldKeys, headers, indexes } = inspection;
  const {
    tickerIndex,
    nameIndex,
    returnIndex,
    regionIndex,
    sectorIndex,
    styleIndex,
    riskIndex,
    assetClassIndex,
  } = indexes;

  return bodyRows
    .map((row) => {
      const cells = headers.map((_, columnIndex) => (row[columnIndex] ?? '').trim());
      const ticker = tickerIndex >= 0 ? cells[tickerIndex] : '';
      const name = nameIndex >= 0 ? cells[nameIndex] : '';
      const tickerLooksLikeCode = /^\d{4,8}$/.test(ticker);
      const fallbackLabelCandidate =
        cells.find((value, columnIndex) => {
          if (!value || NON_STOCK_LABEL_FIELD_KEYS.has(fieldKeys[columnIndex])) {
            return false;
          }

          return looksLikeFreeTextName(value) || isTickerLikeValue(value);
        }) ?? '';
      let extraFieldCount = 0;
      const fields = headerLabels
        .map((header, columnIndex) => {
          const value = (row[columnIndex] ?? '').trim();
          if (!value) {
            return null;
          }

          const fieldKey = fieldKeys[columnIndex];
          const shouldTreatAsExtra =
            isPlaceholderHeaderLabel(header) ||
            (fieldKey === 'stockName' && columnIndex !== nameIndex);

          if (shouldTreatAsExtra) {
            extraFieldCount += 1;
            return { label: `추가 정보 ${extraFieldCount}`, value };
          }

          return {
            label:
              fieldKey === 'stockName' && columnIndex === nameIndex
                ? '종목명'
                : fieldKey === 'stockCode' && columnIndex === tickerIndex
                  ? '종목 티커'
                  : header,
            value,
          };
        })
        .filter(Boolean);
      const label =
        compactLabel(name, 18) ||
        compactLabel(!tickerLooksLikeCode && ticker && ticker.length <= 18 ? ticker : '', 18) ||
        compactLabel(fallbackLabelCandidate, 18) ||
        '';

      return enrichPortfolioItem({
        label,
        ticker,
        code: ticker,
        name,
        detail: returnIndex >= 0 ? formatReturnDetail(cells[returnIndex], headerLabels[returnIndex]) : '',
        region: regionIndex >= 0 ? compactLabel(cells[regionIndex], 22) : '',
        sector: sectorIndex >= 0 ? compactLabel(cells[sectorIndex], 22) : '',
        style: styleIndex >= 0 ? compactLabel(cells[styleIndex], 22) : '',
        risk: riskIndex >= 0 ? compactLabel(cells[riskIndex], 22) : '',
        assetClass: assetClassIndex >= 0 ? compactLabel(cells[assetClassIndex], 22) : '',
        fields,
      });
    })
    .filter((item) => item.label);
}

function scoreTickerColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const tickerRatio = matchRatio(values, isTickerLikeValue);
  const alphaTickerRatio = matchRatio(values, isAlphabeticTickerLikeValue);
  const numericSecurityCodeRatio = matchRatio(values, isNumericSecurityCodeLikeValue);
  const numericOnlyRatio = matchRatio(values, (value) => /^[+-]?\d+(?:\.\d+)?$/.test(String(value ?? '').trim()));
  const hasExplicitCodeHeader = /(ticker|symbol|stockcode|securitycode|assetcode|productcode|종목코드|종목티커|티커)/.test(
    normalizedHeader,
  );
  let score = tickerRatio;

  if (fieldKey === 'stockCode') {
    score += 0.18;
  }

  if (hasExplicitCodeHeader) {
    score += 0.24;
  }

  if (/(asset|security|product|instrument|holding|자산|종목|상품|보유)/.test(normalizedHeader)) {
    score += 0.12;
  }

  if (alphaTickerRatio >= 0.55) {
    score += 0.35;
  }

  if (numericSecurityCodeRatio >= 0.72) {
    score += 0.2;
  }

  if (
    /(volume|거래량|체결량|수량|shares|quantity|price|현재가|매수가|매입가|평가금액|금액|amount|value)/.test(
      normalizedHeader,
    )
  ) {
    score -= 1.12;
  }

  if (
    numericOnlyRatio >= 0.9 &&
    alphaTickerRatio < 0.05 &&
    numericSecurityCodeRatio < 0.72 &&
    !hasExplicitCodeHeader
  ) {
    score -= 0.8;
  }

  if (fieldKey === 'stockName' && !hasExplicitCodeHeader) {
    score -= 1.15;
  } else if (fieldKey === 'stockName') {
    score -= 0.3;
  }

  return score;
}

function scoreDateColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  let score = matchRatio(values, isDateLikeValue);

  if (fieldKey === 'buyDate') {
    score += 0.18;
  }

  if (
    /(date|day|datetime|timestamp|buydate|tradedate|tradingdate|executiondate|recorddate|valuedate|valuationdate|snapshotdate|날짜|일자|기준일|거래일|매매일|체결일|평가일|조회일|매수일)/.test(
      normalizedHeader,
    )
  ) {
    score += 0.22;
  }

  if (fieldKey === 'stockName' || fieldKey === 'stockCode') {
    score -= 0.34;
  }

  return score;
}

function scoreReturnColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  let score = matchRatio(values, (value) => {
    const trimmed = String(value ?? '').trim();
    const parsed = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));

    return (
      Number.isFinite(parsed) &&
      !isDateLikeValue(trimmed) &&
      (trimmed.includes('%') || /^[+-]/.test(trimmed) || Math.abs(parsed) <= 100)
    );
  });

  if (fieldKey === 'return') {
    score += 0.16;
  }

  if (
    /(return|returns|returnpct|yield|performance|change|profitrate|dailypnlrate|dailyreturn|cumulativereturn|totalreturn|수익률|수익율|등락률|변동률|손익률|손익율|평가손익률|일별수익률|일일수익률|일간수익률|누적수익률|총수익률)/.test(
      normalizedHeader,
    )
  ) {
    score += 0.2;
  }

  return score;
}

function buildColumnDescriptors(headerLabels, fieldKeys, bodyRows) {
  const columnCount = Math.max(headerLabels.length, ...bodyRows.map((row) => row.length), 0);

  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows.map((row) => String(row[columnIndex] ?? '').trim()).filter(Boolean);

    return {
      columnIndex,
      headerLabel: headerLabels[columnIndex] ?? `Column ${columnIndex + 1}`,
      fieldKey: fieldKeys[columnIndex] ?? resolveFieldLabelKey(headerLabels[columnIndex] ?? ''),
      values,
      sampleValues: values.slice(0, 3),
    };
  }).filter(({ values }) => values.length > 0);
}

function rankColumnCandidates(columns, scoreColumn, limit = 3) {
  return [...columns]
    .map((column) => {
      const score = scoreColumn(column.headerLabel, column.fieldKey, column.values);

      return {
        index: column.columnIndex,
        label: column.headerLabel,
        fieldKey: column.fieldKey || null,
        score: Number(score.toFixed(3)),
        confidence: Number(clamp(score, 0, 1).toFixed(3)),
        sampleValues: column.sampleValues,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function buildMappedColumn(index, candidates) {
  if (index < 0) {
    return null;
  }

  const candidate = candidates.find((entry) => entry.index === index) ?? null;

  return {
    index,
    label: candidate?.label ?? `Column ${index + 1}`,
    fieldKey: candidate?.fieldKey ?? null,
    confidence: candidate?.confidence ?? 0,
    sampleValues: candidate?.sampleValues ?? [],
  };
}

const FIELD_ROLE_DEFINITIONS = [
  {
    key: 'snapshotDate',
    pattern:
      /snapshotdate|valuationdate|valuedate|recorddate|asofdate|date|day|기준일|평가일|조회일|날짜|일자/,
    valueScore: (values) => matchRatio(values, isDateLikeValue),
  },
  {
    key: 'buyDate',
    pattern: /buydate|purchasedate|entrydate|acquisitiondate|매수일|매입일|취득일/,
    valueScore: (values) => matchRatio(values, isDateLikeValue),
  },
  {
    key: 'securityName',
    pattern: /stockname|securityname|assetname|productname|companyname|종목명|상품명|자산명/,
    valueScore: (values) => matchRatio(values, isLikelySecurityName),
  },
  {
    key: 'securityCode',
    pattern: /ticker|symbol|stockcode|securitycode|종목코드|티커|코드/,
    valueScore: (values) => matchRatio(values, isTickerLikeValue),
  },
  {
    key: 'quantity',
    pattern: /shares|quantity|holding|units|보유수량|잔고수량|수량/,
    valueScore: (values) => matchRatio(values, isShareLikeValue),
  },
  {
    key: 'buyPrice',
    pattern: /buyprice|purchaseprice|entryprice|averageprice|costbasis|매수가|매입가|취득가|평균단가/,
    valueScore: (values) => matchRatio(values, isPriceLikeValue),
  },
  {
    key: 'currentPrice',
    pattern: /currentprice|marketprice|lastprice|현재가|평가가|기준가/,
    valueScore: (values) => matchRatio(values, isPriceLikeValue),
  },
  {
    key: 'marketValue',
    pattern: /marketvalue|currentvalue|evaluationamount|valuation|평가금액|평가액|현재가치|보유금액/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'returnRate',
    pattern: /returnrate|profitrate|returnpct|yield|수익률|수익율|손익률|손익율|평가손익률/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'dailyReturnRate',
    pattern: /dailyreturn|dailypnlrate|dayreturn|일별수익률|일일수익률|일간수익률|일수익률/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'cumulativeReturnRate',
    pattern: /cumulativereturn|totalreturn|accumulatedreturn|누적수익률|총수익률/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'realizedPnl',
    pattern: /realizedpnl|realizedprofit|realizedgain|실현손익|실현수익|확정손익/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'unrealizedPnl',
    pattern: /unrealizedpnl|valuationpnl|evaluationpnl|평가손익|미실현손익/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
  {
    key: 'currency',
    pattern: /currency|통화|화폐/,
    valueScore: (values) => matchRatio(values, (value) => KNOWN_CURRENCY_CODES.has(String(value).trim().toUpperCase())),
  },
  {
    key: 'fxRate',
    pattern: /fxrate|exchangerate|환율/,
    valueScore: (values) => matchRatio(values, isNumericLikeValue),
  },
];

function buildFieldRoleDiagnostics(columns) {
  const roles = {};
  const byColumn = {};

  for (const column of columns) {
    const normalizedHeader = normalizeHeader(column.headerLabel);
    const candidates = FIELD_ROLE_DEFINITIONS.map((definition) => {
      const headerScore = definition.pattern.test(normalizedHeader) ? 0.68 : 0;
      const valueScore = definition.valueScore(column.values) * 0.42;
      const fieldKeyScore =
        definition.key === column.fieldKey ||
        (definition.key === 'securityName' && column.fieldKey === 'stockName') ||
        (definition.key === 'securityCode' && column.fieldKey === 'stockCode') ||
        (definition.key === 'snapshotDate' && column.fieldKey === 'buyDate') ||
        (definition.key === 'returnRate' && column.fieldKey === 'return')
          ? 0.18
          : 0;

      return {
        role: definition.key,
        score: headerScore + valueScore + fieldKeyScore,
      };
    }).sort((left, right) => right.score - left.score);
    const best = candidates[0];

    if (!best || best.score < 0.38) {
      continue;
    }

    const descriptor = {
      index: column.columnIndex,
      label: column.headerLabel,
      fieldKey: column.fieldKey || null,
      confidence: Number(clamp(best.score, 0, 1).toFixed(3)),
      sampleValues: column.sampleValues,
    };

    if (!roles[best.role] || descriptor.confidence > roles[best.role].confidence) {
      roles[best.role] = descriptor;
    }

    byColumn[column.columnIndex] = {
      ...descriptor,
      role: best.role,
      alternatives: candidates
        .filter((candidate) => candidate.score >= 0.38 && candidate.role !== best.role)
        .slice(0, 2)
        .map((candidate) => ({
          role: candidate.role,
          confidence: Number(clamp(candidate.score, 0, 1).toFixed(3)),
        })),
    };
  }

  return {
    roles,
    byColumn,
  };
}

function buildSnapshotQualityDiagnostics(inspection, roleDiagnostics) {
  const { bodyRows, indexes } = inspection;
  const firstValidIndex = (...values) =>
    values.find((value) => Number.isInteger(value) && value >= 0) ?? -1;
  const dateIndex = firstValidIndex(
    roleDiagnostics.roles.snapshotDate?.index,
    roleDiagnostics.roles.buyDate?.index,
    indexes.dateIndex,
  );
  const securityIndex = firstValidIndex(
    roleDiagnostics.roles.securityCode?.index,
    roleDiagnostics.roles.securityName?.index,
    indexes.tickerIndex,
    indexes.nameIndex,
  );
  const dateKeys = bodyRows
    .map((row) => (dateIndex >= 0 ? formatAtomDateLabel(row[dateIndex]) : ''))
    .filter(Boolean);
  const securityKeys = bodyRows
    .map((row) => (securityIndex >= 0 ? normalizeSecurityIdentityValue(row[securityIndex]) : ''))
    .filter(Boolean);
  const rowsByDate = {};
  const rowsBySecurity = {};

  dateKeys.forEach((key) => {
    rowsByDate[key] = (rowsByDate[key] ?? 0) + 1;
  });
  securityKeys.forEach((key) => {
    rowsBySecurity[key] = (rowsBySecurity[key] ?? 0) + 1;
  });

  const sortedDates = [...new Set(dateKeys)].sort();

  return {
    dateDistinctCount: new Set(dateKeys).size,
    securityDistinctCount: new Set(securityKeys).size,
    latestSnapshotDate: sortedDates.at(-1) ?? null,
    rowsByDate: Object.fromEntries(Object.entries(rowsByDate).slice(0, 12)),
    rowsBySecurity: Object.fromEntries(Object.entries(rowsBySecurity).slice(0, 12)),
  };
}

function buildParserWarnings(inspection, items, candidates) {
  const warnings = [];
  const { bodyRows, headerLabels, hasDetectedHeader, indexes, fieldKeys, headers } = inspection;
  const placeholderHeaderCount = headerLabels.filter(isPlaceholderHeaderLabel).length;

  if (!bodyRows.length) {
    warnings.push({
      code: 'no-data-rows',
      severity: 'error',
      message: '파일에 해석 가능한 데이터 행이 없습니다.',
      source: 'parser',
    });
  }

  if (indexes.nameIndex < 0 && indexes.tickerIndex < 0) {
    warnings.push({
      code: 'missing-security-column',
      severity: 'error',
      message: '종목명 또는 종목 티커 열을 확실하게 찾지 못했습니다.',
      source: 'parser',
    });
  }

  if (!items.length && bodyRows.length) {
    warnings.push({
      code: 'no-items-parsed',
      severity: 'error',
      message: '행은 읽었지만 화면에 표시할 종목을 만들지 못했습니다.',
      source: 'parser',
    });
  }

  if (!hasDetectedHeader) {
    warnings.push({
      code: 'header-inferred',
      severity: 'warning',
      message: '명시적인 헤더를 찾지 못해 컬럼 이름을 자동 추론했습니다.',
      source: 'parser',
    });
  }

  if (placeholderHeaderCount >= Math.max(2, Math.round(headerLabels.length * 0.4))) {
    warnings.push({
      code: 'placeholder-headers',
      severity: 'warning',
      message: '여러 컬럼명이 비어 있거나 일반 이름으로 표시되어 검토가 필요할 수 있습니다.',
      source: 'parser',
    });
  }

  if (indexes.dateIndex < 0) {
    warnings.push({
      code: 'missing-date-column',
      severity: 'info',
      message: '날짜 열을 찾지 못해 시계열 히트맵 정보가 약할 수 있습니다.',
      source: 'parser',
    });
  }

  if (indexes.returnIndex < 0) {
    warnings.push({
      code: 'missing-return-column',
      severity: 'info',
      message: '수익률 열을 찾지 못해 수익 상세가 비어 있을 수 있습니다.',
      source: 'parser',
    });
  }

  const stockNameConfidence = candidates.stockName[0]?.confidence ?? 0;
  if (indexes.nameIndex >= 0 && stockNameConfidence < 0.62) {
    warnings.push({
      code: 'low-stock-name-confidence',
      severity: 'warning',
      message: '종목명 열을 찾았지만 신뢰도가 낮아 다른 메타 컬럼일 가능성이 있습니다.',
      source: 'parser',
    });
  }

  if (selectPortfolioLabelStrategy({
    bodyRows,
    headers,
    fieldKeys,
    dateIndex: indexes.dateIndex,
    nameIndex: indexes.nameIndex,
    tickerIndex: indexes.tickerIndex,
  }) === 'date') {
    warnings.push({
      code: 'time-series-shape',
      severity: 'info',
      message: '이 파일은 종목 목록보다 날짜 중심 시계열 데이터일 가능성이 높습니다.',
      source: 'parser',
    });
  }

  return warnings;
}

function buildPortfolioParseDiagnostics(inspection, items) {
  const {
    delimiter,
    rows,
    bodyRows,
    headerLabels,
    fieldKeys,
    hasDetectedHeader,
    skippedPreambleRowCount,
    indexes,
  } = inspection;
  const columns = buildColumnDescriptors(headerLabels, fieldKeys, bodyRows);
  const fieldRoles = buildFieldRoleDiagnostics(columns);
  const snapshotQuality = buildSnapshotQualityDiagnostics(inspection, fieldRoles);
  const candidates = {
    stockName: rankColumnCandidates(columns, scoreSecurityNameColumn),
    stockCode: rankColumnCandidates(columns, scoreTickerColumn),
    buyDate: rankColumnCandidates(columns, scoreDateColumn),
    return: rankColumnCandidates(columns, scoreReturnColumn),
    accountId: rankColumnCandidates(columns, scoreAccountIdColumn),
    accountType: rankColumnCandidates(columns, scoreAccountTypeColumn),
  };
  const warnings = buildParserWarnings(inspection, items, candidates);
  const reviewStatus = warnings.some((warning) => warning.severity === 'error')
    ? 'blocked'
    : warnings.some((warning) => warning.severity === 'warning')
      ? 'needs-review'
      : 'ok';

  return {
    reviewStatus,
    summary: `${bodyRows.length}개 행에서 ${items.length}개 종목을 만들었습니다.`,
    delimiter,
    hasDetectedHeader,
    skippedPreambleRowCount,
    rowCount: rows.length,
    bodyRowCount: bodyRows.length,
    parsedItemCount: items.length,
    headerLabels,
    mappedColumns: {
      stockName: buildMappedColumn(indexes.nameIndex, candidates.stockName),
      stockCode: buildMappedColumn(indexes.tickerIndex, candidates.stockCode),
      buyDate: buildMappedColumn(indexes.dateIndex, candidates.buyDate),
      return: buildMappedColumn(indexes.returnIndex, candidates.return),
      accountId: buildMappedColumn(
        fieldKeys.findIndex((fieldKey) => fieldKey === 'accountId'),
        candidates.accountId,
      ),
      accountType: buildMappedColumn(
        fieldKeys.findIndex((fieldKey) => fieldKey === 'accountType'),
        candidates.accountType,
      ),
    },
    fieldRoles,
    snapshotQuality,
    candidates,
    warnings,
  };
}

export function parsePortfolioText(text) {
  return parsePortfolioTextDetailed(text).items;
}

export function parsePortfolioTextDetailed(text) {
  const inspection = inspectPortfolioTable(text);
  const items = buildParsedItems(inspection);

  return {
    items,
    diagnostics: buildPortfolioParseDiagnostics(inspection, items),
  };
}

function countTimelineDistinctDates(items) {
  return new Set(
    (items ?? [])
      .map((item) => formatAtomDateLabel(extractPortfolioItemDateValue(item)))
      .filter(Boolean),
  ).size;
}

export function shouldFallbackToLocalTimeline(apiPayload, localItems) {
  const apiTimelineItems = Array.isArray(apiPayload?.timelineItems) ? apiPayload.timelineItems : [];
  const apiDateCount = countTimelineDistinctDates(apiTimelineItems);
  const localDateCount = countTimelineDistinctDates(localItems);

  if (localDateCount < 2) {
    return false;
  }

  return apiDateCount <= 1 && localDateCount >= Math.max(7, apiDateCount + 3);
}

export { collapsePortfolioItemsForDisplay };
