import securitiesData from '../data/securities.json' with { type: 'json' };

function normalizeSecurityKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/&/g, 'and')
    .replace(/[\s._\-/%()[\]'":,]+/g, '');
}

function compactLabel(value, max = 18) {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const NON_SECURITY_DISPLAY_LABELS = new Set(
  securitiesData.nonSecurityDisplayLabels.map((value) => normalizeSecurityKey(value)),
);

const SECURITY_REFERENCE = securitiesData.securityReference;

const SECURITY_INDEX = SECURITY_REFERENCE.map((entry) => ({
  ...entry,
  normalizedKeys: [
    ...new Set(
      [entry.label, entry.code, entry.companyName, ...(entry.aliases ?? [])]
        .map((value) => normalizeSecurityKey(value))
        .filter(Boolean),
    ),
  ],
}));

const SECURITY_LOOKUP = new Map();

for (const entry of SECURITY_INDEX) {
  for (const normalized of entry.normalizedKeys) {
    if (normalized) {
      SECURITY_LOOKUP.set(normalized, entry);
    }
  }
}

function findContainsReference(normalizedIdentifiers) {
  for (const identifier of normalizedIdentifiers) {
    if (!identifier) {
      continue;
    }

    for (const entry of SECURITY_INDEX) {
      if (
        entry.normalizedKeys.some(
          (key) =>
            key.length >= 5 &&
            identifier.length >= 5 &&
            (identifier.includes(key) || key.includes(identifier)),
        )
      ) {
        return entry;
      }
    }
  }

  return null;
}

function findExactSecurityReference(identifiers) {
  const normalizedIdentifiers = identifiers.map((identifier) => normalizeSecurityKey(identifier)).filter(Boolean);

  for (const normalized of normalizedIdentifiers) {
    if (!normalized) {
      continue;
    }

    const direct = SECURITY_LOOKUP.get(normalized);
    if (direct) {
      return direct;
    }

    const strippedExchange = normalized.replace(/(ks|kq|ba|to|v|du|l|hk|ss|sz|t)$/, '');
    if (strippedExchange && SECURITY_LOOKUP.has(strippedExchange)) {
      return SECURITY_LOOKUP.get(strippedExchange);
    }
  }

  return null;
}

function findSecurityReference(identifiers) {
  const normalizedIdentifiers = identifiers.map((identifier) => normalizeSecurityKey(identifier)).filter(Boolean);
  const exact = findExactSecurityReference(identifiers);

  if (exact) {
    return exact;
  }

  return findContainsReference(normalizedIdentifiers);
}

export function resolveExactSecurityReferenceCode(identifiers) {
  return findExactSecurityReference(Array.isArray(identifiers) ? identifiers : [identifiers])?.code ?? '';
}

export function resolveSecurityReferenceCode(identifiers) {
  return findSecurityReference(Array.isArray(identifiers) ? identifiers : [identifiers])?.code ?? '';
}

function upsertField(fields, label, value, options = {}) {
  const { overwrite = false } = options;

  if (!value) {
    return fields;
  }

  const nextFields = [...fields];
  const canonicalizeFieldLabel = (fieldLabel) => {
    const normalized = normalizeSecurityKey(fieldLabel);

    if (
      [
        '종목코드',
        '종목티커',
        'stockcode',
        'securitycode',
        'ticker',
        'symbol',
      ].includes(normalized)
    ) {
      return '종목 티커';
    }

    if (
      [
        'sector',
        'industry',
        'theme',
        '업종',
        '산업',
        '섹터',
        '분야',
      ].includes(normalized)
    ) {
      return '분야';
    }

    return fieldLabel;
  };
  const displayLabel = canonicalizeFieldLabel(label);
  const target = normalizeSecurityKey(displayLabel);
  const existingIndex = nextFields.findIndex(
    (field) => normalizeSecurityKey(canonicalizeFieldLabel(field.label)) === target,
  );

  if (existingIndex >= 0) {
    nextFields[existingIndex] = {
      ...nextFields[existingIndex],
      label: displayLabel,
      value: overwrite ? value : nextFields[existingIndex].value || value,
    };
    return nextFields;
  }

  nextFields.push({ label: displayLabel, value });
  return nextFields;
}

const ETF_PROVIDER_PATTERN = /(kodex|tiger|arirang|ace|kosef|sol|hanaro|rise|timefolio|plus|etf)/i;

function buildSecuritySignalText(item) {
  const raw = [item.code, item.ticker, item.name, item.label, item.companyName]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    raw,
    normalized: normalizeSecurityKey(raw),
  };
}

function resolveProvidedValue(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? { value: trimmed, source: 'provided' } : null;
}

function resolveRegion(item, reference) {
  const provided = resolveProvidedValue(item.region);
  if (provided) {
    return provided;
  }

  if (reference?.region) {
    return { value: reference.region, source: 'reference' };
  }

  const { raw, normalized } = buildSecuritySignalText(item);
  const code = String(item.code ?? item.ticker ?? '').trim();

  if (/미국|usa|us\b|nyse|nasdaq|sandp500|russell|dow/.test(normalized)) {
    return { value: '미국', source: 'derived' };
  }

  if (/한국|국내|kospi|kosdaq|krx/.test(normalized) || /^\d{6}$/.test(code)) {
    return { value: '한국', source: 'derived' };
  }

  if (/일본|japan|tokyo|nikkei|topix/.test(normalized)) {
    return { value: '일본', source: 'derived' };
  }

  if (/중국|china|csi|shanghai|심천|선전/.test(normalized)) {
    return { value: '중국', source: 'derived' };
  }

  if (/홍콩|hongkong|hangseng/.test(normalized)) {
    return { value: '홍콩', source: 'derived' };
  }

  if (/베트남|vietnam/.test(normalized)) {
    return { value: '베트남', source: 'derived' };
  }

  if (/인도|india/.test(normalized)) {
    return { value: '인도', source: 'derived' };
  }

  if (/유럽|europe/.test(normalized)) {
    return { value: '유럽', source: 'derived' };
  }

  if (/선진국|developed/.test(normalized)) {
    return { value: '선진국', source: 'derived' };
  }

  if (/신흥국|emerging/.test(normalized)) {
    return { value: '신흥국', source: 'derived' };
  }

  if (/글로벌|world|global|allcountry|acwi/.test(normalized)) {
    return { value: '글로벌', source: 'derived' };
  }

  if (/[가-힣]/.test(raw)) {
    return { value: '한국', source: 'derived' };
  }

  if (/[a-z]/i.test(raw)) {
    return { value: '미국', source: 'generic' };
  }

  return { value: '', source: 'raw' };
}

function resolveAssetClass(item, reference) {
  const { normalized } = buildSecuritySignalText(item);
  const hasEtfSignal =
    ETF_PROVIDER_PATTERN.test(normalized) ||
    /etf|fund|index|trust|상장지수/.test(normalized);
  const provided = resolveProvidedValue(item.assetClass);
  if (provided && !(normalizeSecurityKey(provided.value) === '주식' && hasEtfSignal)) {
    return provided;
  }

  if (reference?.assetClass) {
    return { value: reference.assetClass, source: 'reference' };
  }

  if (/bond|treasury|fixedincome|credit|채권|국채/.test(normalized)) {
    return { value: hasEtfSignal ? '채권 ETF' : '채권', source: 'derived' };
  }

  if (/gold|commodity|원자재|금99|금괴|oil|crude|silver|metal/.test(normalized)) {
    return { value: hasEtfSignal ? '원자재 ETF' : '원자재', source: 'derived' };
  }

  if (/reit|realestate|부동산|리츠/.test(normalized)) {
    return { value: hasEtfSignal ? '리츠 ETF' : '리츠/부동산', source: 'derived' };
  }

  if (hasEtfSignal) {
    return { value: '주식 ETF', source: 'derived' };
  }

  if (item.code || item.label) {
    return { value: '개별주식', source: 'generic' };
  }

  return { value: '', source: 'raw' };
}

function resolveSector(item, reference, assetClass) {
  const provided = resolveProvidedValue(item.sector);
  if (provided) {
    return provided;
  }

  if (reference?.sector) {
    return { value: reference.sector, source: 'reference' };
  }

  const { normalized } = buildSecuritySignalText(item);

  if (/sandp500|sp500|totalstock|broadmarket|coreindex|msciworld/.test(normalized)) {
    return { value: '광범위 시장', source: 'derived' };
  }

  if (/developed|eafe|선진국/.test(normalized)) {
    return { value: '국제 주식', source: 'derived' };
  }

  if (/emerging|신흥국/.test(normalized)) {
    return { value: '신흥국 주식', source: 'derived' };
  }

  if (/semiconductor|반도체|memory|chip/.test(normalized)) {
    return { value: '반도체', source: 'derived' };
  }

  if (/nasdaq|technology|tech|테크|bigtech|대형기술|기술주/.test(normalized)) {
    return { value: '대형 기술주', source: 'derived' };
  }

  if (/platform|internet|portal|검색|카카오|naver|alphabet|google|meta/.test(normalized)) {
    return { value: '인터넷 플랫폼', source: 'derived' };
  }

  if (/bank|financial|금융|보험|증권/.test(normalized)) {
    return { value: '금융', source: 'derived' };
  }

  if (/auto|car|motor|자동차/.test(normalized)) {
    return { value: '자동차', source: 'derived' };
  }

  if (/battery|2차전지|배터리/.test(normalized)) {
    return { value: '배터리', source: 'derived' };
  }

  if (/bio|biotech|제약|바이오|헬스케어/.test(normalized)) {
    return { value: '바이오', source: 'derived' };
  }

  if (/steel|material|철강|소재/.test(normalized)) {
    return { value: '철강/소재', source: 'derived' };
  }

  if (/bond|treasury|채권|국채/.test(normalized)) {
    return { value: '채권', source: 'derived' };
  }

  if (/gold|금99|gold/.test(normalized)) {
    return { value: '금', source: 'derived' };
  }

  if (/commodity|원자재|oil|energy|crude|agriculture|metal/.test(normalized)) {
    return { value: /energy|oil|crude/.test(normalized) ? '에너지' : '원자재', source: 'derived' };
  }

  if (/reit|realestate|부동산|리츠/.test(normalized)) {
    return { value: '부동산', source: 'derived' };
  }

  if (/dividend|배당/.test(normalized) && assetClass?.includes('ETF')) {
    return { value: '배당 ETF', source: 'derived' };
  }

  if (assetClass?.includes('ETF')) {
    return { value: '혼합/분산', source: 'generic' };
  }

  if (item.code || item.ticker || item.name || item.label) {
    return { value: '기타', source: 'generic' };
  }

  return { value: '', source: 'raw' };
}

function resolveStyle(item, reference, assetClass, sector) {
  const provided = resolveProvidedValue(item.style);
  if (provided) {
    return provided;
  }

  if (reference?.style) {
    return { value: reference.style, source: 'reference' };
  }

  const { normalized } = buildSecuritySignalText(item);
  const sectorText = normalizeSecurityKey(sector);

  if (/dividend|income|배당/.test(normalized)) {
    return { value: '배당주', source: 'derived' };
  }

  if (/value|bank|financial|auto|steel|소재|금융|자동차/.test(normalized)) {
    return { value: '가치주', source: 'derived' };
  }

  if (/bond|gold|defensive|consumerstaples|채권|방어/.test(normalized)) {
    return { value: '방어형', source: 'derived' };
  }

  if (/semiconductor|technology|tech|테크|internet|battery|platform|growth|반도체|기술|성장/.test(normalized)) {
    return { value: '성장주', source: 'derived' };
  }

  if (
    assetClass?.includes('ETF') &&
    /(광범위시장|국제주식|신흥국주식|전세계주식|배당etf)/.test(sectorText)
  ) {
    return { value: '분산형', source: 'derived' };
  }

  if (assetClass?.includes('ETF')) {
    return { value: '분산형', source: 'generic' };
  }

  if (assetClass || item.code || item.ticker || item.name || item.label) {
    return { value: '혼합형', source: 'generic' };
  }

  return { value: '', source: 'raw' };
}

function resolveRisk(item, reference, assetClass, style, sector) {
  const provided = resolveProvidedValue(item.risk);
  if (provided) {
    return provided;
  }

  if (reference?.risk) {
    return { value: reference.risk, source: 'reference' };
  }

  const { normalized } = buildSecuritySignalText(item);
  const derivedText = normalizeSecurityKey([style, sector, assetClass].join(' '));

  if (assetClass === '채권 ETF' || assetClass === '채권') {
    return { value: '저위험', source: 'derived' };
  }

  if (assetClass?.includes('원자재') || /gold|commodity|원자재/.test(normalized)) {
    return { value: '중위험', source: 'derived' };
  }

  if (/growth|semiconductor|internet|battery|biotech|전기차|반도체|바이오|성장/.test(derivedText)) {
    return { value: '고위험', source: 'derived' };
  }

  if (/dividend|value|financial|auto|steel|배당|가치|금융|자동차|소재/.test(derivedText)) {
    return { value: '중위험', source: 'derived' };
  }

  if (/광범위시장|국제주식|신흥국주식|전세계주식/.test(derivedText)) {
    return { value: '중위험', source: 'derived' };
  }

  if (assetClass || item.code || item.ticker || item.name || item.label) {
    return { value: '중위험', source: 'generic' };
  }

  return { value: '', source: 'raw' };
}

function shouldPreferSecurityNameLabel(label, metadataValues = [], baseCode = '') {
  const trimmed = String(label ?? '').trim();
  const normalized = normalizeSecurityKey(trimmed);

  if (!normalized) {
    return true;
  }

  if (NON_SECURITY_DISPLAY_LABELS.has(normalized)) {
    return true;
  }

  if (/^(column|col|field|header|value|item|attribute|unnamed|untitled)\d*$/i.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]{1,3}\d{5,12}$/i.test(trimmed)) {
    return true;
  }

  if (baseCode && normalized === normalizeSecurityKey(baseCode)) {
    return true;
  }

  if (/^\d{4,8}$/.test(trimmed)) {
    return true;
  }

  return metadataValues.some((value) => normalized === normalizeSecurityKey(value));
}

function findSecurityNameFieldValue(fields) {
  for (const field of fields ?? []) {
    const label = normalizeSecurityKey(field.label);
    if (
      [
        '종목명',
        '자산명',
        '상품명',
        'companyname',
        'securityname',
        'assetname',
        'productname',
        'name',
      ]
        .map((value) => normalizeSecurityKey(value))
        .includes(label)
    ) {
      const value = String(field.value ?? '').trim();
      if (value) {
        return value;
      }
    }
  }

  return '';
}

const WIKIDATA_ACTION_API_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const YAHOO_FINANCE_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const LIVE_KNOWLEDGE_CACHE = new Map();
const WIKIDATA_SEARCH_CACHE = new Map();
const WIKIDATA_TICKER_CACHE = new Map();
const WIKIDATA_ENTITY_CACHE = new Map();
const YAHOO_FINANCE_SEARCH_CACHE = new Map();
const LIVE_KNOWLEDGE_TIMEOUT_MS = 4200;
const LIVE_KNOWLEDGE_CONCURRENCY = 4;
const STABLE_ENRICHED_FIELD_LABELS = new Set([
  '종목 티커',
  '종목코드',
  '종목명',
  '종목 설명',
  '상장 시장',
  '증권 유형',
  '투자 지역',
  '분야',
  '투자 스타일',
  '위험 등급',
  '자산 구분',
]);

export function buildKnowledgeLookupKey(item) {
  return [
    item.code,
    item.ticker,
    item.name,
    item.companyName,
    item.label,
  ]
    .map((value) => normalizeSecurityKey(value))
    .find(Boolean) ?? '';
}

function isStrongMetadataSource(source) {
  return ['provided', 'reference', 'wikidata', 'yahoo'].includes(
    String(source ?? '').trim().toLowerCase(),
  );
}

function needsLiveKnowledge(item) {
  const currentSources = item.metadataSourceByField ?? {};
  const hasLookupKey = Boolean(buildKnowledgeLookupKey(item));
  const hasExternalProfile = (item.fields ?? []).some((field) =>
    ['종목 설명', '상장 시장', '증권 유형']
      .map((label) => normalizeSecurityKey(label))
      .includes(normalizeSecurityKey(field.label)),
  );
  const hasCompleteStrongCoreMetadata = ['region', 'sector', 'style', 'risk', 'assetClass'].every(
    (field) => {
      const value = String(item[field] ?? '').trim();
      const source = String(currentSources[field] ?? item.metadataSource ?? 'raw').trim().toLowerCase();

      return value && isStrongMetadataSource(source);
    },
  );

  if (hasCompleteStrongCoreMetadata) {
    return false;
  }

  if (hasLookupKey && !hasExternalProfile) {
    return true;
  }

  return ['region', 'sector', 'style', 'risk', 'assetClass'].some((field) => {
    const value = String(item[field] ?? '').trim();
    const source = String(currentSources[field] ?? item.metadataSource ?? 'raw').trim().toLowerCase();

    if (!value) {
      return true;
    }

    return !isStrongMetadataSource(source);
  });
}

function pickLocalizedEntityText(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  return (
    record.ko?.value ??
    record.en?.value ??
    Object.values(record).find((entry) => entry?.value)?.value ??
    ''
  );
}

function parseEntityIdFromUri(value) {
  const match = String(value ?? '').match(/\/(Q\d+)$/);
  return match?.[1] ?? '';
}

function escapeSparqlString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = LIVE_KNOWLEDGE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Remote metadata lookup failed: ${response.status}`);
    }

    return response.json();
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function searchWikidataByTicker(ticker) {
  const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
  if (!normalizedTicker) {
    return '';
  }

  const cacheKey = normalizeSecurityKey(normalizedTicker);
  if (WIKIDATA_TICKER_CACHE.has(cacheKey)) {
    return WIKIDATA_TICKER_CACHE.get(cacheKey);
  }

  const query = `
    PREFIX p: <http://www.wikidata.org/prop/>
    PREFIX ps: <http://www.wikidata.org/prop/statement/>
    PREFIX pq: <http://www.wikidata.org/prop/qualifier/>

    SELECT ?item WHERE {
      VALUES ?ticker { "${escapeSparqlString(normalizedTicker)}" }
      ?item p:P414 ?listing .
      ?listing ps:P414 ?exchange ;
               pq:P249 ?ticker .
    }
    LIMIT 3
  `;
  const url = `${WIKIDATA_SPARQL_URL}?format=json&query=${encodeURIComponent(query)}`;

  try {
    const response = await fetchJsonWithTimeout(url, {
      headers: {
        Accept: 'application/sparql-results+json',
      },
    });
    const itemId = parseEntityIdFromUri(response?.results?.bindings?.[0]?.item?.value);
    if (itemId) {
      WIKIDATA_TICKER_CACHE.set(cacheKey, itemId);
    }
    return itemId;
  } catch {
    return '';
  }
}

function scoreWikidataSearchHit(hit, identifiers) {
  const hitLabel = normalizeSecurityKey(hit.label);
  const hitDescription = normalizeSecurityKey(hit.description);
  const hitAlias = normalizeSecurityKey(hit.alias);
  let score = Number(hit.repository ?? 0) || 0;

  if (identifiers.some((identifier) => identifier === hitLabel || identifier === hitAlias)) {
    score += 4.5;
  }

  if (identifiers.some((identifier) => hitLabel.includes(identifier) || identifier.includes(hitLabel))) {
    score += 2.2;
  }

  if (
    /(company|corporation|business|stock|share|etf|fund|trust|index|holding|bank|기업|회사|펀드|주식|상장지수)/.test(
      hitDescription,
    )
  ) {
    score += 1.2;
  }

  if (/(givenname|surname|disambiguation|album|song|film|wikimedia|fictional)/.test(hitDescription)) {
    score -= 6;
  }

  return score;
}

async function searchWikidataByName(query, identifiers) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const language = /[가-힣]/.test(trimmed) ? 'ko' : 'en';
  const cacheKey = `${language}:${normalizeSecurityKey(trimmed)}`;
  if (WIKIDATA_SEARCH_CACHE.has(cacheKey)) {
    return WIKIDATA_SEARCH_CACHE.get(cacheKey);
  }

  const url = new URL(WIKIDATA_ACTION_API_URL);
  url.search = new URLSearchParams({
    action: 'wbsearchentities',
    search: trimmed,
    language,
    uselang: language,
    type: 'item',
    limit: '7',
    format: 'json',
    origin: '*',
  }).toString();

  try {
    const response = await fetchJsonWithTimeout(url.toString());
    const best = [...(response?.search ?? [])]
      .sort((left, right) => scoreWikidataSearchHit(right, identifiers) - scoreWikidataSearchHit(left, identifiers))
      .find((candidate) => scoreWikidataSearchHit(candidate, identifiers) > 0.5);
    const itemId = best?.id ?? '';
    if (itemId) {
      WIKIDATA_SEARCH_CACHE.set(cacheKey, itemId);
    }
    return itemId;
  } catch {
    return '';
  }
}

function extractClaimEntityIds(entity, propertyId) {
  return [
    ...new Set(
      (entity?.claims?.[propertyId] ?? [])
        .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
        .filter(Boolean),
    ),
  ];
}

async function getWikidataLabels(ids) {
  if (!ids.length) {
    return new Map();
  }

  const url = new URL(WIKIDATA_ACTION_API_URL);
  url.search = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'labels',
    languages: 'ko|en',
    languagefallback: '1',
    format: 'json',
    origin: '*',
  }).toString();
  const response = await fetchJsonWithTimeout(url.toString());
  const labelMap = new Map();

  Object.entries(response?.entities ?? {}).forEach(([id, entity]) => {
    labelMap.set(id, pickLocalizedEntityText(entity.labels));
  });

  return labelMap;
}

async function getWikidataEntitySnapshot(entityId) {
  if (!entityId) {
    return null;
  }

  if (WIKIDATA_ENTITY_CACHE.has(entityId)) {
    return WIKIDATA_ENTITY_CACHE.get(entityId);
  }

  const url = new URL(WIKIDATA_ACTION_API_URL);
  url.search = new URLSearchParams({
    action: 'wbgetentities',
    ids: entityId,
    props: 'labels|descriptions|claims',
    languages: 'ko|en',
    languagefallback: '1',
    format: 'json',
    origin: '*',
  }).toString();

  try {
    const response = await fetchJsonWithTimeout(url.toString());
    const entity = response?.entities?.[entityId];
    if (!entity) {
      return null;
    }

    const linkedEntityIds = [
      ...new Set(
        ['P452', 'P17', 'P495', 'P31', 'P414']
          .flatMap((propertyId) => extractClaimEntityIds(entity, propertyId)),
      ),
    ];
    const labelMap = await getWikidataLabels(linkedEntityIds);
    const toLabels = (propertyId) =>
      extractClaimEntityIds(entity, propertyId)
        .map((id) => labelMap.get(id))
        .filter(Boolean);

    const snapshot = {
      id: entityId,
      label: pickLocalizedEntityText(entity.labels),
      description: pickLocalizedEntityText(entity.descriptions),
      industries: toLabels('P452'),
      countries: [...new Set([...toLabels('P495'), ...toLabels('P17')])],
      instances: toLabels('P31'),
      exchanges: toLabels('P414'),
    };

    WIKIDATA_ENTITY_CACHE.set(entityId, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function collectSecurityIdentifiers(item) {
  return [
    item.code,
    item.ticker,
    item.name,
    item.companyName,
    item.label,
    ...(item.fields ?? []).map((field) => field.value),
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function collectYahooFinanceIdentifiers(item) {
  return [
    item.code,
    item.ticker,
    item.name,
    item.companyName,
    item.label,
    findSecurityNameFieldValue(item.fields),
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function buildYahooSearchCandidates(item) {
  const identifiers = collectYahooFinanceIdentifiers(item);
  const candidates = [];

  identifiers.forEach((identifier) => {
    candidates.push(identifier);

    if (/^\d{6}$/.test(identifier)) {
      candidates.push(`${identifier}.KS`, `${identifier}.KQ`);
    }
  });

  return [
    ...new Set(
      candidates
        .map((candidate) => String(candidate ?? '').trim())
        .filter((candidate) => candidate.length >= 2 && !NON_SECURITY_DISPLAY_LABELS.has(normalizeSecurityKey(candidate))),
    ),
  ].slice(0, 6);
}

function normalizeYahooSymbol(value) {
  return normalizeSecurityKey(String(value ?? '').replace(/\.(KS|KQ|TO|V|T|HK|SS|SZ)$/i, ''));
}

function scoreYahooFinanceQuote(quote, identifiers) {
  const symbol = normalizeSecurityKey(quote?.symbol);
  const baseSymbol = normalizeYahooSymbol(quote?.symbol);
  const longName = normalizeSecurityKey(quote?.longname ?? quote?.longName);
  const shortName = normalizeSecurityKey(quote?.shortname ?? quote?.shortName);
  const quoteType = normalizeSecurityKey(quote?.quoteType);
  const typeDisplay = normalizeSecurityKey(quote?.typeDisp);
  let score = Number(quote?.score ?? 0) / 100000;

  identifiers.forEach((identifier) => {
    if (identifier === symbol || identifier === baseSymbol) {
      score += 6;
      return;
    }

    if (
      (longName && (longName.includes(identifier) || identifier.includes(longName))) ||
      (shortName && (shortName.includes(identifier) || identifier.includes(shortName)))
    ) {
      score += 3;
    }
  });

  if (/equity|etf|fund|index/.test(`${quoteType}${typeDisplay}`)) {
    score += 1.2;
  }

  if (/currency|future|option|crypto/.test(`${quoteType}${typeDisplay}`)) {
    score -= 3;
  }

  return score;
}

function buildYahooFinanceSnapshot(quote) {
  if (!quote?.symbol) {
    return null;
  }

  return {
    symbol: String(quote.symbol ?? '').trim(),
    companyName: String(
      quote.longname ?? quote.longName ?? quote.shortname ?? quote.shortName ?? quote.symbol ?? '',
    ).trim(),
    exchange: String(quote.exchDisp ?? quote.exchange ?? quote.market ?? '').trim(),
    quoteType: String(quote.quoteType ?? quote.typeDisp ?? '').trim(),
    securityType: String(quote.typeDisp ?? quote.quoteType ?? '').trim(),
    sector: String(quote.sectorDisp ?? quote.sector ?? quote.industryDisp ?? quote.industry ?? '').trim(),
    industry: String(quote.industryDisp ?? quote.industry ?? '').trim(),
  };
}

async function searchYahooFinance(item) {
  const candidates = buildYahooSearchCandidates(item);
  if (!candidates.length) {
    return null;
  }

  const normalizedIdentifiers = collectYahooFinanceIdentifiers(item)
    .map((value) => normalizeYahooSymbol(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const cacheKey = normalizeSecurityKey(candidate);
    if (YAHOO_FINANCE_SEARCH_CACHE.has(cacheKey)) {
      return YAHOO_FINANCE_SEARCH_CACHE.get(cacheKey);
    }

    const url = new URL(YAHOO_FINANCE_SEARCH_URL);
    url.search = new URLSearchParams({
      q: candidate,
      quotesCount: '8',
      newsCount: '0',
      enableFuzzyQuery: 'true',
    }).toString();

    try {
      const response = await fetchJsonWithTimeout(url.toString(), {}, 3200);
      const bestQuote = [...(response?.quotes ?? [])]
        .filter((quote) => quote?.symbol)
        .sort(
          (left, right) =>
            scoreYahooFinanceQuote(right, normalizedIdentifiers) -
            scoreYahooFinanceQuote(left, normalizedIdentifiers),
        )
        .find((quote) => scoreYahooFinanceQuote(quote, normalizedIdentifiers) > 1.2);
      const snapshot = buildYahooFinanceSnapshot(bestQuote);

      if (snapshot?.companyName) {
        YAHOO_FINANCE_SEARCH_CACHE.set(cacheKey, snapshot);
        return snapshot;
      }
    } catch {
      // Live enrichment is opportunistic. Keep local metadata and let scheduled retries try again.
    }
  }

  return null;
}

function resolveYahooRegion(snapshot, signalItem) {
  const exchange = normalizeSecurityKey(
    [snapshot?.exchange, snapshot?.symbol].filter(Boolean).join(' '),
  );

  if (/nyse|nasdaq|nas|nms|nys|amex|americanstockexchange|pcx|bats|us/.test(exchange)) {
    return '미국';
  }

  if (/kospi|kosdaq|krx|ks|kq|korea|seoul/.test(exchange)) {
    return '한국';
  }

  if (/tokyo|jpx|tse|japan/.test(exchange)) {
    return '일본';
  }

  if (/hongkong|hkg|hkex|hk/.test(exchange)) {
    return '홍콩';
  }

  if (/shanghai|shenzhen|china|ss|sz/.test(exchange)) {
    return '중국';
  }

  if (/london|lse|uk|unitedkingdom/.test(exchange)) {
    return '영국';
  }

  if (/toronto|tsx|canada|to|vancouver/.test(exchange)) {
    return '캐나다';
  }

  if (/australia|asx/.test(exchange)) {
    return '호주';
  }

  return resolveRegion(signalItem, null).value;
}

function resolveYahooAssetClass(snapshot, signalItem) {
  const quoteType = normalizeSecurityKey(snapshot?.quoteType ?? snapshot?.securityType);

  if (/etf/.test(quoteType)) {
    return '주식 ETF';
  }

  if (/mutualfund|fund/.test(quoteType)) {
    return '펀드';
  }

  if (/index/.test(quoteType)) {
    return '지수';
  }

  if (/equity|stock/.test(quoteType)) {
    return '개별주식';
  }

  return resolveAssetClass(signalItem, null).value;
}

function buildYahooLiveKnowledge(item, snapshot) {
  if (!snapshot?.companyName) {
    return null;
  }

  const signalText = [
    item.label,
    item.name,
    item.code,
    snapshot.symbol,
    snapshot.companyName,
    snapshot.exchange,
    snapshot.quoteType,
    snapshot.securityType,
    snapshot.sector,
    snapshot.industry,
  ]
    .filter(Boolean)
    .join(' ');
  const signalItem = {
    ...item,
    label: signalText,
    name: snapshot.companyName,
    companyName: snapshot.companyName,
    sector: snapshot.sector || item.sector,
  };
  const region = resolveYahooRegion(snapshot, signalItem);
  const assetClass = resolveYahooAssetClass(snapshot, signalItem);
  const sector = snapshot.sector || resolveSector(signalItem, null, assetClass).value;
  const style = resolveStyle(signalItem, null, assetClass, sector).value;
  const risk = resolveRisk(signalItem, null, assetClass, style, sector).value;
  const description = [snapshot.sector, snapshot.industry].filter(Boolean).join(' · ');

  return {
    ticker: snapshot.symbol,
    companyName: snapshot.companyName,
    description,
    exchange: snapshot.exchange,
    securityType: snapshot.securityType,
    region,
    sector,
    style,
    risk,
    assetClass,
    source: 'yahoo',
  };
}

async function findWikidataEntityId(item) {
  const identifiers = collectSecurityIdentifiers(item);
  const normalizedIdentifiers = identifiers.map((value) => normalizeSecurityKey(value)).filter(Boolean);
  const tickerCandidates = [
    ...new Set(
      identifiers.filter((value) => /^[A-Z]{1,10}(?:\.[A-Z]{1,3})?$/i.test(value) || /^\d{4,8}$/.test(value)),
    ),
  ];

  for (const ticker of tickerCandidates) {
    const entityId = await searchWikidataByTicker(ticker);
    if (entityId) {
      return entityId;
    }
  }

  const nameCandidates = [
    ...new Set(
      identifiers.filter(
        (value) =>
          value.length >= 2 &&
          !/^\d{4,8}$/.test(value) &&
          !/^[A-Z]{1,10}(?:\.[A-Z]{1,3})?$/i.test(value),
      ),
    ),
  ];

  for (const name of nameCandidates) {
    const entityId = await searchWikidataByName(name, normalizedIdentifiers);
    if (entityId) {
      return entityId;
    }
  }

  return '';
}

function buildLiveKnowledge(item, snapshot) {
  if (!snapshot?.label) {
    return null;
  }

  const signalText = [
    item.label,
    item.name,
    item.code,
    snapshot.label,
    snapshot.description,
    ...snapshot.industries,
    ...snapshot.countries,
    ...snapshot.instances,
    ...snapshot.exchanges,
  ]
    .filter(Boolean)
    .join(' ');
  const signalItem = {
    ...item,
    label: signalText,
    name: `${snapshot.label} ${snapshot.description ?? ''}`.trim(),
    companyName: snapshot.label,
    sector: snapshot.industries[0] ?? item.sector,
    region: snapshot.countries[0] ?? item.region,
  };
  const region = resolveRegion(signalItem, null).value;
  const assetClass = resolveAssetClass(signalItem, null).value;
  const sector = resolveSector(signalItem, null, assetClass).value || snapshot.industries[0] || '';
  const style = resolveStyle(signalItem, null, assetClass, sector).value;
  const risk = resolveRisk(signalItem, null, assetClass, style, sector).value;

  return {
    companyName: snapshot.label,
    description: snapshot.description,
    exchange: snapshot.exchanges[0] ?? '',
    securityType: snapshot.instances[0] ?? '',
    region,
    sector,
    style,
    risk,
    assetClass,
    source: 'wikidata',
  };
}

function chooseKnowledgeValue(currentValue, currentSource, nextValue, nextSource) {
  const source = String(currentSource ?? 'raw').trim().toLowerCase();

  if (!nextValue) {
    return {
      value: currentValue ?? '',
      source: source || 'raw',
      overwritten: false,
    };
  }

  if (isStrongMetadataSource(source)) {
    return {
      value: currentValue ?? '',
      source,
      overwritten: false,
    };
  }

  return {
    value: nextValue,
    source: nextSource,
    overwritten: normalizeSecurityKey(currentValue) !== normalizeSecurityKey(nextValue),
  };
}

function mergeLiveKnowledge(item, liveKnowledge) {
  if (!liveKnowledge) {
    return item;
  }

  const liveSource =
    String(liveKnowledge.source ?? '').trim().toLowerCase() === 'yahoo' ? 'yahoo' : 'wikidata';
  const currentSources = item.metadataSourceByField ?? {};
  const regionMeta = chooseKnowledgeValue(item.region, currentSources.region, liveKnowledge.region, liveSource);
  const sectorMeta = chooseKnowledgeValue(item.sector, currentSources.sector, liveKnowledge.sector, liveSource);
  const styleMeta = chooseKnowledgeValue(item.style, currentSources.style, liveKnowledge.style, liveSource);
  const riskMeta = chooseKnowledgeValue(item.risk, currentSources.risk, liveKnowledge.risk, liveSource);
  const assetClassMeta = chooseKnowledgeValue(
    item.assetClass,
    currentSources.assetClass,
    liveKnowledge.assetClass,
    liveSource,
  );
  const shouldReplaceName =
    !String(item.name ?? '').trim() ||
    normalizeSecurityKey(item.name) === normalizeSecurityKey(item.code) ||
    normalizeSecurityKey(item.name) === normalizeSecurityKey(item.label);
  const shouldReplaceLabel =
    !String(item.label ?? '').trim() ||
    /^\d{4,8}$/.test(String(item.label ?? '').trim()) ||
    normalizeSecurityKey(item.label) === normalizeSecurityKey(item.code) ||
    shouldPreferSecurityNameLabel(item.label, [
      item.region,
      item.sector,
      item.style,
      item.risk,
      item.assetClass,
      liveKnowledge.region,
      liveKnowledge.sector,
      liveKnowledge.style,
      liveKnowledge.risk,
      liveKnowledge.assetClass,
    ], item.code || item.ticker);
  const nextName = shouldReplaceName && liveKnowledge.companyName ? liveKnowledge.companyName : item.name;
  const nextLabel =
    shouldReplaceLabel && liveKnowledge.companyName
      ? compactLabel(liveKnowledge.companyName, 18)
      : item.label;
  let fields = [...(item.fields ?? [])];

  fields = upsertField(fields, '종목 티커', liveKnowledge.ticker || item.code || item.ticker, {
    overwrite: !String(item.code ?? '').trim() && Boolean(item.ticker),
  });
  fields = upsertField(fields, '종목명', nextName, {
    overwrite: shouldReplaceName && Boolean(liveKnowledge.companyName),
  });
  fields = upsertField(fields, '종목 설명', liveKnowledge.description);
  fields = upsertField(fields, '상장 시장', liveKnowledge.exchange);
  fields = upsertField(fields, '증권 유형', liveKnowledge.securityType);
  fields = upsertField(fields, '투자 지역', regionMeta.value, { overwrite: regionMeta.overwritten });
  fields = upsertField(fields, '분야', sectorMeta.value, { overwrite: sectorMeta.overwritten });
  fields = upsertField(fields, '투자 스타일', styleMeta.value, { overwrite: styleMeta.overwritten });
  fields = upsertField(fields, '위험 등급', riskMeta.value, { overwrite: riskMeta.overwritten });
  fields = upsertField(fields, '자산 구분', assetClassMeta.value, {
    overwrite: assetClassMeta.overwritten,
  });

  return {
    ...item,
    label: nextLabel,
    name: nextName,
    region: regionMeta.value,
    sector: sectorMeta.value,
    style: styleMeta.value,
    risk: riskMeta.value,
    assetClass: assetClassMeta.value,
    metadataSource: liveSource,
    metadataSourceByField: {
      ...currentSources,
      region: regionMeta.source,
      sector: sectorMeta.source,
      style: styleMeta.source,
      risk: riskMeta.source,
      assetClass: assetClassMeta.source,
    },
    fields,
  };
}

function mergeStableEnrichedFields(baseFields, enrichedFields) {
  const normalizeField = (field) => {
    const label = String(field?.label ?? '').trim();
    const value = String(field?.value ?? '').trim();

    if (!label || !value) {
      return null;
    }

    return { label, value };
  };
  const merged = Array.isArray(baseFields)
    ? baseFields.map((field) => normalizeField(field)).filter(Boolean)
    : [];
  const indexByLabel = new Map(merged.map((field, index) => [field.label, index]));

  (enrichedFields ?? []).forEach((rawField) => {
    const field = normalizeField(rawField);
    if (!field || !STABLE_ENRICHED_FIELD_LABELS.has(field.label)) {
      return;
    }

    const existingIndex = indexByLabel.get(field.label);
    if (existingIndex === undefined) {
      indexByLabel.set(field.label, merged.length);
      merged.push(field);
      return;
    }

    merged[existingIndex] = field;
  });

  return merged;
}

function mergeResolvedKnowledgeItem(baseItem, resolvedItem) {
  if (!resolvedItem) {
    return baseItem;
  }

  return {
    ...baseItem,
    label: String(resolvedItem.label ?? '').trim() || baseItem.label,
    ticker: String(resolvedItem.ticker ?? '').trim() || baseItem.ticker,
    code: String(resolvedItem.code ?? '').trim() || baseItem.code,
    name: String(resolvedItem.name ?? '').trim() || baseItem.name,
    companyName: String(resolvedItem.companyName ?? '').trim() || baseItem.companyName,
    region: String(resolvedItem.region ?? '').trim() || baseItem.region,
    sector: String(resolvedItem.sector ?? '').trim() || baseItem.sector,
    style: String(resolvedItem.style ?? '').trim() || baseItem.style,
    risk: String(resolvedItem.risk ?? '').trim() || baseItem.risk,
    assetClass: String(resolvedItem.assetClass ?? '').trim() || baseItem.assetClass,
    metadataSource: resolvedItem.metadataSource ?? baseItem.metadataSource,
    metadataSourceByField: {
      ...(baseItem.metadataSourceByField ?? {}),
      ...(resolvedItem.metadataSourceByField ?? {}),
    },
    fields: mergeStableEnrichedFields(baseItem.fields, resolvedItem.fields),
  };
}

async function enrichPortfolioItemWithLiveKnowledge(item, options = {}) {
  const { force = false } = options;

  if (typeof fetch !== 'function' || !needsLiveKnowledge(item)) {
    return item;
  }

  const cacheKey = buildKnowledgeLookupKey(item);
  if (!cacheKey) {
    return item;
  }

  if (LIVE_KNOWLEDGE_CACHE.has(cacheKey) && !force) {
    return mergeLiveKnowledge(item, LIVE_KNOWLEDGE_CACHE.get(cacheKey));
  }

  try {
    let liveKnowledge = null;
    const entityId = await findWikidataEntityId(item);

    if (entityId) {
      const snapshot = await getWikidataEntitySnapshot(entityId);
      liveKnowledge = buildLiveKnowledge(item, snapshot);
    }

    if (!liveKnowledge) {
      liveKnowledge = buildYahooLiveKnowledge(item, await searchYahooFinance(item));
    }

    if (!liveKnowledge) {
      return item;
    }

    LIVE_KNOWLEDGE_CACHE.set(cacheKey, liveKnowledge);
    return mergeLiveKnowledge(item, liveKnowledge);
  } catch {
    return item;
  }
}

export async function enrichPortfolioItemsWithLiveKnowledge(items, options = {}) {
  if (!Array.isArray(items) || !items.length) {
    return items;
  }

  const queue = [...new Set(items.map(buildKnowledgeLookupKey).filter(Boolean))].map((key) => [
    key,
    items.find((item) => buildKnowledgeLookupKey(item) === key),
  ]);
  const resolved = new Map();

  const workers = Array.from(
    { length: Math.min(LIVE_KNOWLEDGE_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) {
          return;
        }

        const [key, item] = next;
        resolved.set(key, await enrichPortfolioItemWithLiveKnowledge(item, options));
      }
    },
  );

  await Promise.all(workers);

  return items.map((item) => {
    const cacheKey = buildKnowledgeLookupKey(item);
    if (!cacheKey || !resolved.has(cacheKey)) {
      return item;
    }

    return mergeResolvedKnowledgeItem(item, resolved.get(cacheKey));
  });
}

export function enrichPortfolioItem(item) {
  const reference = findSecurityReference([
    item.code,
    item.ticker,
    item.name,
    item.label,
    item.companyName,
  ]);
  const baseCode = reference?.code || item.ticker || item.code || '';
  const regionMeta = resolveRegion(item, reference);
  const assetClassMeta = resolveAssetClass(item, reference);
  const sectorMeta = resolveSector(item, reference, assetClassMeta.value);
  const styleMeta = resolveStyle(item, reference, assetClassMeta.value, sectorMeta.value);
  const riskMeta = resolveRisk(
    item,
    reference,
    assetClassMeta.value,
    styleMeta.value,
    sectorMeta.value,
  );
  const region = regionMeta.value;
  const assetClass = assetClassMeta.value;
  const sector = sectorMeta.value;
  const style = styleMeta.value;
  const risk = riskMeta.value;
  const metadataValues = [region, sector, style, risk, assetClass];
  const fieldDisplayNameCandidate = findSecurityNameFieldValue(item.fields);
  const fieldDisplayName = shouldPreferSecurityNameLabel(
    fieldDisplayNameCandidate,
    metadataValues,
    baseCode,
  )
    ? ''
    : fieldDisplayNameCandidate;
  const safeItemName = shouldPreferSecurityNameLabel(item.name, metadataValues, baseCode)
    ? ''
    : String(item.name ?? '').trim();
  const safeItemCompanyName = shouldPreferSecurityNameLabel(item.companyName, metadataValues, baseCode)
    ? ''
    : String(item.companyName ?? '').trim();
  const safeItemLabel = shouldPreferSecurityNameLabel(item.label, metadataValues, baseCode)
    ? ''
    : String(item.label ?? '').trim();
  const preferredDisplayName =
    reference?.companyName ||
    fieldDisplayName ||
    safeItemName ||
    safeItemCompanyName ||
    reference?.label ||
    safeItemLabel ||
    baseCode;
  const companyName = preferredDisplayName || baseCode;
  const displayLabel = compactLabel(companyName || preferredDisplayName || baseCode, 18);
  let fields = [...(item.fields ?? [])];

  fields = upsertField(fields, '종목 티커', baseCode, { overwrite: true });
  fields = upsertField(fields, '종목명', companyName, { overwrite: true });
  fields = upsertField(fields, '투자 지역', region);
  fields = upsertField(fields, '분야', sector);
  fields = upsertField(fields, '투자 스타일', style);
  fields = upsertField(fields, '위험 등급', risk);
  fields = upsertField(fields, '자산 구분', assetClass);

  return {
    ...item,
    label: displayLabel,
    code: baseCode,
    name: companyName,
    region,
    sector,
    style,
    risk,
    assetClass,
    metadataSource: reference
      ? 'reference'
      : [regionMeta, assetClassMeta, sectorMeta, styleMeta, riskMeta].some(
            (meta) => meta.source === 'derived',
          )
        ? 'derived'
        : [regionMeta, assetClassMeta, sectorMeta, styleMeta, riskMeta].some(
              (meta) => meta.source === 'generic',
            )
          ? 'generic'
          : 'raw',
    metadataSourceByField: {
      region: regionMeta.source,
      assetClass: assetClassMeta.source,
      sector: sectorMeta.source,
      style: styleMeta.source,
      risk: riskMeta.source,
    },
    fields,
  };
}
