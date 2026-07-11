import {
  buildKnowledgeLookupKey,
  enrichPortfolioItemsWithLiveKnowledge,
} from '../src/lib/securityKnowledge.js';

const SECURITY_ENRICHMENT_CACHE = new Map();
const SECURITY_ENRICHMENT_TTL_MS = 1000 * 60 * 60 * 12;
const STABLE_ENRICHMENT_FIELD_LABELS = new Set([
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

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRequestField(field) {
  const label = String(field?.label ?? '').trim();
  const value = String(field?.value ?? '').trim();

  if (!label || !value) {
    return null;
  }

  return { label, value };
}

function normalizeRequestItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const fields = Array.isArray(item.fields)
    ? item.fields.map(normalizeRequestField).filter(Boolean)
    : [];

  const normalized = {
    label: String(item.label ?? '').trim(),
    ticker: String(item.ticker ?? '').trim(),
    code: String(item.code ?? '').trim(),
    name: String(item.name ?? '').trim(),
    companyName: String(item.companyName ?? '').trim(),
    detail: String(item.detail ?? '').trim(),
    region: String(item.region ?? '').trim(),
    sector: String(item.sector ?? '').trim(),
    style: String(item.style ?? '').trim(),
    risk: String(item.risk ?? '').trim(),
    assetClass: String(item.assetClass ?? '').trim(),
    metadataSource: String(item.metadataSource ?? '').trim(),
    metadataSourceByField:
      item.metadataSourceByField && typeof item.metadataSourceByField === 'object'
        ? Object.fromEntries(
            Object.entries(item.metadataSourceByField)
              .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
              .filter(([key, value]) => key && value),
          )
        : {},
    fields,
  };

  return normalized;
}

function buildIdentifierItem(identifier) {
  const trimmed = String(identifier ?? '').trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4,8}$/.test(trimmed) || /^[A-Z]{1,10}(?:\.[A-Z]{1,3})?$/i.test(trimmed)) {
    return normalizeRequestItem({
      label: trimmed,
      ticker: trimmed,
      code: trimmed,
      name: trimmed,
      fields: [],
    });
  }

  return normalizeRequestItem({
    label: trimmed,
    name: trimmed,
    companyName: trimmed,
    fields: [],
  });
}

function purgeExpiredEntries() {
  const now = Date.now();

  for (const [key, cached] of SECURITY_ENRICHMENT_CACHE.entries()) {
    if ((cached?.expiresAt ?? 0) <= now) {
      SECURITY_ENRICHMENT_CACHE.delete(key);
    }
  }
}

function readCachedItem(key) {
  const cached = SECURITY_ENRICHMENT_CACHE.get(key);

  if (!cached) {
    return null;
  }

  if ((cached.expiresAt ?? 0) <= Date.now()) {
    SECURITY_ENRICHMENT_CACHE.delete(key);
    return null;
  }

  return cloneSerializable(cached.item);
}

function writeCachedItem(key, item) {
  if (!key) {
    return;
  }

  SECURITY_ENRICHMENT_CACHE.set(key, {
    item: cloneSerializable(item),
    expiresAt: Date.now() + SECURITY_ENRICHMENT_TTL_MS,
  });
}

function mergeStableFields(baseFields, overlayFields) {
  const merged = Array.isArray(baseFields)
    ? baseFields.map((field) => normalizeRequestField(field)).filter(Boolean)
    : [];
  const indexByLabel = new Map(merged.map((field, index) => [field.label, index]));

  (overlayFields ?? []).forEach((rawField) => {
    const field = normalizeRequestField(rawField);
    if (!field || !STABLE_ENRICHMENT_FIELD_LABELS.has(field.label)) {
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

function applyCachedEnrichment(baseItem, overlayItem) {
  if (!baseItem) {
    return cloneSerializable(overlayItem);
  }

  if (!overlayItem) {
    return cloneSerializable(baseItem);
  }

  return {
    ...cloneSerializable(baseItem),
    label: String(overlayItem.label ?? '').trim() || String(baseItem.label ?? '').trim(),
    ticker: String(overlayItem.ticker ?? '').trim() || String(baseItem.ticker ?? '').trim(),
    code: String(overlayItem.code ?? '').trim() || String(baseItem.code ?? '').trim(),
    name: String(overlayItem.name ?? '').trim() || String(baseItem.name ?? '').trim(),
    companyName:
      String(overlayItem.companyName ?? '').trim() || String(baseItem.companyName ?? '').trim(),
    region: String(overlayItem.region ?? '').trim() || String(baseItem.region ?? '').trim(),
    sector: String(overlayItem.sector ?? '').trim() || String(baseItem.sector ?? '').trim(),
    style: String(overlayItem.style ?? '').trim() || String(baseItem.style ?? '').trim(),
    risk: String(overlayItem.risk ?? '').trim() || String(baseItem.risk ?? '').trim(),
    assetClass:
      String(overlayItem.assetClass ?? '').trim() || String(baseItem.assetClass ?? '').trim(),
    metadataSource: overlayItem.metadataSource ?? baseItem.metadataSource,
    metadataSourceByField: {
      ...(baseItem.metadataSourceByField ?? {}),
      ...(overlayItem.metadataSourceByField ?? {}),
    },
    fields: mergeStableFields(baseItem.fields, overlayItem.fields),
  };
}

function countLiveProfileItems(items) {
  return items.filter((item) => {
    const sources = Object.values(item?.metadataSourceByField ?? {}).map((value) =>
      String(value ?? '').trim().toLowerCase(),
    );
    const hasProfileFields = (item?.fields ?? []).some((field) =>
      ['종목 설명', '상장 시장', '증권 유형'].includes(String(field?.label ?? '').trim()),
    );

    return (
      ['wikidata', 'yahoo'].includes(String(item?.metadataSource ?? '').trim().toLowerCase()) ||
      sources.includes('wikidata') ||
      sources.includes('yahoo') ||
      hasProfileFields
    );
  }).length;
}

export async function enrichSecurityItems(items, options = {}) {
  purgeExpiredEntries();

  const { force = false } = options;
  const entries = Array.isArray(items)
    ? items.map((item, index) => ({
        index,
        item: normalizeRequestItem(item),
      }))
    : [];

  if (!entries.length) {
    return {
      items: [],
      requestedCount: 0,
      cacheHits: 0,
      enrichedCount: 0,
      cacheSize: SECURITY_ENRICHMENT_CACHE.size,
      source: 'security-enrichment-api',
    };
  }

  const results = new Array(entries.length);
  const pendingEntries = [];
  let cacheHits = 0;

  entries.forEach(({ item }, index) => {
    if (!item) {
      results[index] = null;
      return;
    }

    const key = buildKnowledgeLookupKey(item);
    if (!key) {
      results[index] = cloneSerializable(item);
      return;
    }

    const cachedItem = !force ? readCachedItem(key) : null;

    if (cachedItem) {
      results[index] = applyCachedEnrichment(item, cachedItem);
      cacheHits += 1;
      return;
    }

    pendingEntries.push({ index, key, item });
  });

  if (pendingEntries.length) {
    const enrichedPendingItems = await enrichPortfolioItemsWithLiveKnowledge(
      pendingEntries.map((entry) => entry.item),
      { force },
    );

    pendingEntries.forEach((entry, index) => {
      const enrichedItem = enrichedPendingItems[index] ?? entry.item;
      results[entry.index] = applyCachedEnrichment(entry.item, enrichedItem);
      writeCachedItem(entry.key, enrichedItem);
    });
  }

  return {
    items: results,
    requestedCount: entries.length,
    cacheHits,
    enrichedCount: countLiveProfileItems(results),
    cacheSize: SECURITY_ENRICHMENT_CACHE.size,
    source: 'security-enrichment-api',
  };
}

export async function enrichSecurityIdentifiers(identifiers, options = {}) {
  const items = Array.isArray(identifiers)
    ? identifiers.map(buildIdentifierItem).filter(Boolean)
    : [];

  return enrichSecurityItems(items, options);
}

export function getSecurityEnrichmentCacheStats() {
  purgeExpiredEntries();

  return {
    cacheSize: SECURITY_ENRICHMENT_CACHE.size,
    ttlMs: SECURITY_ENRICHMENT_TTL_MS,
  };
}
