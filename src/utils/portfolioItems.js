const NON_STOCK_ASSET_CLASS_PATTERN =
  /(bond|bonds|fixedincome|treasury|cash|money|commodity|commodities|gold|silver|metal|crypto|digitalasset|realestate|reit|채권|국채|현금|현금성자산|원자재|금99|금괴|금현물|디지털자산|부동산|리츠)/i;
const STOCK_ASSET_CLASS_PATTERN =
  /(stock|stocks|equity|equities|equityetf|single stock|common stock|주식|개별주식|국내주식|미국주식|해외주식|글로벌주식|주식etf)/i;
const SECURITY_CODE_PATTERN = /^(?:[A-Z]{1,6}(?:[.\-][A-Z0-9]{1,4})?|\d{5,6}(?:\.(?:KS|KQ))?)$/i;
const SECURITY_NAME_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|s&p|nasdaq|dow|russell|msci|kospi|kosdaq|etf|etn|fund|trust|inc|corp|corporation|company|ltd|limited|plc|holdings?|group|전자|화학|금융|은행|제약|바이오|홀딩스?|건설|증권|통신|식품|에너지|반도체|자동차|배터리|테크|배당|성장)/i;
const GENERIC_NON_SECURITY_PATTERN =
  /^(isa|irp|ira|cma|mmf|rp|연금|연금저축|퇴직연금|개인연금|중개형isa|일반계좌|종합계좌|증권계좌|계좌|포트폴리오|월적립|분할매수|장기보유|현금대기|리밸런싱|매수전략|코멘트|메모|비고|날짜|일자|return|수익률)$/i;

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

function isNonStockAssetClass(value) {
  const normalized = normalizePortfolioItemKey(value);

  return NON_STOCK_ASSET_CLASS_PATTERN.test(normalized) && !STOCK_ASSET_CLASS_PATTERN.test(normalized);
}

function isStockAssetClass(value) {
  const normalized = normalizePortfolioItemKey(value);

  return STOCK_ASSET_CLASS_PATTERN.test(normalized) && !isNonStockAssetClass(normalized);
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

  const assetClass =
    String(item.assetClass ?? '').trim() ||
    readPortfolioField(item, ['자산 구분', '자산군', '자산유형', 'assetClass', 'assetType']);

  if (isNonStockAssetClass(assetClass)) {
    return false;
  }

  if (isStockAssetClass(assetClass)) {
    return hasStockLikeIdentity(item);
  }

  return hasStockLikeIdentity(item);
}

export function filterPortfolioItemsForAtomScene(items) {
  return Array.isArray(items) ? items.filter(isPortfolioAtomItem) : [];
}
