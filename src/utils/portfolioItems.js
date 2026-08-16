const SECURITY_CODE_PATTERN = /^(?:[A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?|\d{5,6}(?:\.(?:KS|KQ))?)$/i;
const SECURITY_NAME_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|s&p|nasdaq|dow|russell|msci|kospi|kosdaq|etf|etn|fund|trust|inc|corp|corporation|company|ltd|limited|plc|holdings?|group|전자|화학|금융|은행|제약|바이오|홀딩스?|건설|증권|통신|식품|에너지|반도체|자동차|배터리|테크|배당|성장)/i;
const GENERIC_NON_SECURITY_PATTERN =
  /^(isa|irp|ira|cma|mmf|rp|연금|연금저축|퇴직연금|개인연금|중개형isa|일반계좌|종합계좌|증권계좌|계좌|포트폴리오|월적립|분할매수|장기보유|현금대기|리밸런싱|매수전략|코멘트|메모|비고|날짜|일자|return|수익률|합계|총계|소계|잔액|잔고|total|subtotal|balance)$/i;

function normalizePortfolioItemKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]'":,]+/g, '');
}

function isDateLikePortfolioValue(value) {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.\s*$/g, '');

  if (!trimmed) {
    return false;
  }

  return (
    /^\d{8}$/.test(trimmed) ||
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(trimmed) ||
    /^\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?$/.test(trimmed)
  );
}

function readPortfolioField(item, labels) {
  const labelKeys = labels.map(normalizePortfolioItemKey);
  const field = (item?.fields ?? []).find((candidate) =>
    labelKeys.includes(normalizePortfolioItemKey(candidate?.label)),
  );

  return String(field?.value ?? '').trim();
}

function isGenericNonSecurityValue(value) {
  const trimmed = String(value ?? '').trim();
  const normalized = normalizePortfolioItemKey(trimmed);

  return (
    !trimmed ||
    GENERIC_NON_SECURITY_PATTERN.test(trimmed) ||
    isDateLikePortfolioValue(trimmed) ||
    /^[+-]?\d+(?:\.\d+)?%?$/.test(trimmed) ||
    ['accounttype', 'accountid', 'assetclass', 'region', 'sector', 'style', 'risk'].includes(normalized)
  );
}

function readSecurityCode(item) {
  return [
    item?.ticker,
    item?.stockCode,
    item?.code,
    readPortfolioField(item, ['종목 티커', '종목코드', '티커', 'ticker', 'symbol', 'stockCode', 'code']),
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) ?? '';
}

function readSecurityName(item) {
  return [
    item?.stockName,
    item?.name,
    item?.companyName,
    readPortfolioField(item, ['종목명', '자산명', '상품명', 'stockName', 'name', 'securityName', 'assetName']),
    item?.label,
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) ?? '';
}

// Labels/top-level properties that mean "this row already carries real holding numbers" —
// mirrors the field-label vocabulary already established in src/lib/portfolioAnalyticsSummary.js,
// src/lib/portfolioAllocation.js, and App.jsx's own resolveHoldingMetric calls, so a row counts as
// "has data" here exactly when those other places would also find something to show for it.
const BUY_PRICE_LABELS = ['매수가', '매입가', '취득가', '평균단가', 'buyPrice', 'purchasePrice', 'entryPrice', 'averagePrice'];
const SHARES_LABELS = ['보유수량', '수량', '잔고수량', 'shares', 'quantity', 'holding', 'holdings', 'units'];
const RETURN_LABELS = [
  '수익률',
  '수익율',
  '등락률',
  '변동률',
  '손익률',
  '손익율',
  '평가손익률',
  'return',
  'returns',
  'returnRate',
  'profitRate',
];
const MARKET_VALUE_LABELS = ['평가금액', '평가액', '현재가치', '보유금액', 'marketValue', 'currentValue', 'evaluationAmount', 'valuation'];
const WEIGHT_LABELS = ['비중', '편입비', '구성비', '보유비중', 'weight', 'allocation', 'ratio'];

function hasNumericLikeValue(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed || !/\d/.test(trimmed)) {
    return false;
  }

  // A bare zero ("0", "0%", "0.00%", "₩0", ...) is excluded on purpose, not just loosely allowed
  // through: App.jsx's createManualPortfolioItem defaults an unfilled 수익률 to exactly "0%" for
  // *every* manually-created item regardless of what the user actually typed (see its
  // `formatReturnDetail(...) || '0%'` fallback) — so "has a non-empty 수익률" is not reliable
  // evidence of real data for that field specifically. Treating zero as "no signal" everywhere
  // (not just for return) is the safer, uniform rule: a genuinely-flat real position that also
  // happens to have an unrecognizable name is a rare enough case that it's worth requiring the
  // user fill in a price/quantity too, versus the alternative of every blank-return manual entry
  // silently bypassing the name/code check entirely.
  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ''));

  return Number.isFinite(numeric) && numeric !== 0;
}

function fieldHasSubstantiveValue(item, topLevelValue, labels) {
  const raw = String(topLevelValue ?? '').trim() || readPortfolioField(item, labels);
  return hasNumericLikeValue(raw);
}

// An item that already has real holding data filled in — buy price, quantity, return, valuation,
// or an explicit weight — was already classified as "this is a security" once, either by the CSV
// parser's own column-role inference or by the user typing it into the manual-entry form. Making
// hasStockLikeIdentity's name/code pattern re-validate that a second time only serves to silently
// drop legitimate holdings whose name doesn't happen to match a known ETF/company keyword.
function hasSubstantiveHoldingData(item) {
  return (
    fieldHasSubstantiveValue(item, item?.buyPrice, BUY_PRICE_LABELS) ||
    fieldHasSubstantiveValue(item, item?.shares, SHARES_LABELS) ||
    fieldHasSubstantiveValue(item, item?.return, RETURN_LABELS) ||
    fieldHasSubstantiveValue(item, undefined, MARKET_VALUE_LABELS) ||
    fieldHasSubstantiveValue(item, undefined, WEIGHT_LABELS)
  );
}

function hasStockLikeIdentity(item) {
  const code = readSecurityCode(item);
  const name = readSecurityName(item);

  if (code && SECURITY_CODE_PATTERN.test(code) && !isGenericNonSecurityValue(code)) {
    return true;
  }

  return Boolean(
    name &&
      !isGenericNonSecurityValue(name) &&
      (SECURITY_CODE_PATTERN.test(name) || SECURITY_NAME_HINT_PATTERN.test(name)),
  );
}

export function isPortfolioAtomItem(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  // Asset class (주식/채권/리츠/금 등) no longer gates atom visibility — every recognizable
  // holding gets a node regardless of asset class, so a bond or REIT position doesn't just
  // vanish from the scene the moment its 자산군 dropdown is set to a non-stock value.

  // A row still needs *some* name before "it has holding numbers" is enough to admit it — a totals/
  // subtotal row in a real broker export (매수가 column holding a summed total, name column reading
  // "합계") also has "substantive holding data" by this same measure, but isGenericNonSecurityValue
  // already recognizes that class of label reliably, so it's excluded here rather than trusting the
  // presence of a number alone.
  const name = readSecurityName(item);

  if (hasSubstantiveHoldingData(item) && name && !isGenericNonSecurityValue(name)) {
    return true;
  }

  return hasStockLikeIdentity(item);
}

export function filterPortfolioItemsForAtomScene(items) {
  return Array.isArray(items) ? items.filter(isPortfolioAtomItem) : [];
}

// Lets callers explain *why* an item didn't make it into the atom scene (e.g. an accounts-drawer
// "N개 종목 중 M개만 원자로 표시됨" hint) without duplicating isPortfolioAtomItem's own logic.
// Returns null for items that ARE included.
export function explainExcludedPortfolioAtomItem(item) {
  if (isPortfolioAtomItem(item)) {
    return null;
  }

  if (!item || typeof item !== 'object') {
    return 'invalid-item';
  }

  return 'no-recognizable-identity';
}
