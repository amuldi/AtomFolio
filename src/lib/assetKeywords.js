// One place that decides what kind of asset a holding is, from its text. The 모의 tab
// (digitalTwin.js) and the 요약 tab (portfolioAnalyticsSummary.js) each had their own copy of
// these rules and drifted: one of them read "평가금액" (a field name every holding has) as the
// word 금 and filed every holding under 금/현금.
//
// Two rules keep that from coming back:
//   1. Only a holding's own values are searched — never its field labels (평가금액, 매수가 …).
//   2. Short Latin tokens (us, ai, bil …) must be whole words, so "Business" is not "us" and
//      "Hair" is not "ai"; Korean 금 must stand alone, so 금융/금액/자금 do not count.

// Label, name, code, grouping fields and every field *value* — lower-cased, joined.
export function searchableText(item) {
  return [
    item?.label,
    item?.name,
    item?.code,
    item?.region,
    item?.sector,
    item?.assetClass,
    item?.style,
    item?.risk,
    item?.riskLevel,
    ...(item?.fields ?? []).map((field) => field?.value),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(' ');
}

const word = (tokens) => `(?<![a-z0-9])(?:${tokens})(?![a-z0-9])`;

export const ASSET_PATTERNS = {
  us: new RegExp(
    `미국|united states|${word('us|usa|usd|nasdaq|nyse|qqq|spy|voo|vti|schd|soxx|aapl|msft')}`,
  ),
  tech: new RegExp(
    `기술|테크|반도체|소프트웨어|technology|semiconductor|software|cloud|nasdaq|${word('ai|tech|qqq|soxx|smh|aapl|msft|nvda')}`,
  ),
  goldCash: new RegExp(
    `(?<![가-힣])금(?![가-힣])|골드|현금|예수금|단기|원자재|money market|${word('gold|cash|deposit|iau|gld|sgov|bil')}`,
  ),
  reit: /리츠|부동산|reit|real estate|property/,
  dividend: new RegExp(`배당|인컴|dividend|income|${word('schd|dgro|vym')}`),
  highRisk: new RegExp(
    `고위험|공격|성장|기술|반도체|코인|crypto|leverage|growth|technology|semiconductor|${word('2x|3x')}`,
  ),
  stock: new RegExp(`주식|stock|equity|etf|fund|nasdaq|s&p|${word('qqq|spy|voo|vti')}`),
};

export const matches = (name, text) => ASSET_PATTERNS[name].test(text);

// Same order everywhere: REIT first, then gold/cash, dividend, plain stock, everything else.
export function classifyBucketFromText(text) {
  if (matches('reit', text)) return 'reit';
  if (matches('goldCash', text)) return 'goldCash';
  if (matches('dividend', text)) return 'dividend';
  if (matches('stock', text)) return 'stock';
  return 'other';
}
