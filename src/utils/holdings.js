// Holding-field resolvers shared between App.jsx (the atom scene + tool drawer) and any component
// that needs to read/search/group raw portfolio items without importing App.jsx itself — App.jsx
// already imports components from src/components/, so anything components need FROM App.jsx has
// to live somewhere both sides can import without a cycle. Moved out verbatim (not reimplemented)
// so App.jsx's existing detail-panel/drawer rendering and any new search/table UI stay looking at
// literally the same field-resolution rules, not two copies that can quietly drift apart.
import { collapsePortfolioItemsForDisplay as collapsePortfolioItemsForDisplayShared } from '../lib/portfolioIngestionCore.js';

export function normalizeDisplayKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

export function getItemFieldValue(item, labels) {
  const normalizedLabels = labels.map(normalizeDisplayKey);

  for (const field of item?.fields ?? []) {
    if (normalizedLabels.includes(normalizeDisplayKey(field?.label))) {
      return String(field?.value ?? '').trim();
    }
  }

  return '';
}

export function resolveHoldingName(item) {
  return (
    String(item?.companyName ?? item?.name ?? item?.stockName ?? item?.label ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name', 'companyName']) ||
    resolveHoldingTicker(item) ||
    '종목'
  );
}

export function resolveHoldingTicker(item) {
  return (
    String(item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim() ||
    getItemFieldValue(item, ['종목 티커', '종목코드', '티커', 'ticker', 'code', 'symbol'])
  );
}

export function resolveHoldingAccount(item) {
  return (
    String(item?.accountType ?? item?.accountName ?? '').trim() ||
    getItemFieldValue(item, ['포트폴리오 유형', '포트폴리오명', '계좌유형', '계좌명', 'accountType', 'accountName']) ||
    '포트폴리오'
  );
}

export function resolveHoldingGroupKey(item, index = 0) {
  const tickerKey = normalizeDisplayKey(resolveHoldingTicker(item));

  if (tickerKey) {
    return `code:${tickerKey}`;
  }

  const nameKey = normalizeDisplayKey(resolveHoldingName(item));

  if (nameKey) {
    return `name:${nameKey}`;
  }

  return `row:${index}`;
}

export function buildGroupedHoldingItems(items) {
  const sourceItems = Array.isArray(items) ? items : [];

  if (sourceItems.length <= 1) {
    return sourceItems.map((item, index) => ({
      ...item,
      holdingGroupKey: resolveHoldingGroupKey(item, index),
      groupedSourceItemIds: [String(item?.id ?? '').trim()].filter(Boolean),
      groupedSourceItemIndexes: [index],
      groupedRowCount: 1,
    }));
  }

  const groupedItems = new Map();
  sourceItems.forEach((item, index) => {
    const key = resolveHoldingGroupKey(item, index);
    const bucket = groupedItems.get(key);
    const nextEntry = { item, index };

    if (bucket) {
      bucket.push(nextEntry);
      return;
    }

    groupedItems.set(key, [nextEntry]);
  });

  return [...groupedItems.entries()].map(([key, group]) => {
    const groupItems = group.map((entry) => entry.item);
    const representative =
      collapsePortfolioItemsForDisplayShared(groupItems)[0] ?? groupItems[groupItems.length - 1];
    const groupedSourceItemIds = group
      .map((entry) => String(entry.item?.id ?? '').trim())
      .filter(Boolean);

    return {
      ...representative,
      holdingGroupKey: key,
      groupedSourceItemIds,
      groupedSourceItemIndexes: group.map((entry) => entry.index),
      groupedRowCount: group.length,
    };
  });
}

export function formatHoldingListMeta(item, language = 'ko') {
  const ticker = resolveHoldingTicker(item) || resolveHoldingAccount(item);
  const rowCount = Number(item?.groupedRowCount ?? 1);

  if (rowCount > 1) {
    const rowText = language === 'en' ? `${rowCount} rows` : `${rowCount}개 행`;
    return ticker ? `${ticker} · ${rowText}` : rowText;
  }

  return ticker;
}

export function resolveHoldingAtomId(atoms, item, itemIndex) {
  const itemId = String(item?.id ?? '').trim();
  const tickerKey = normalizeDisplayKey(resolveHoldingTicker(item));
  const nameKey = normalizeDisplayKey(resolveHoldingName(item));

  if (itemId) {
    const byId = atoms.find((atom) => String(atom.sourceItemId ?? '').trim() === itemId);
    if (byId) {
      return byId.id;
    }
  }

  if (tickerKey) {
    const byTicker = atoms.find((atom) =>
      [atom.ticker, atom.stockCode, atom.code].some((value) => normalizeDisplayKey(value) === tickerKey),
    );
    if (byTicker) {
      return byTicker.id;
    }
  }

  if (nameKey) {
    const byName = atoms.find((atom) =>
      [atom.stockName, atom.name, atom.label].some((value) => normalizeDisplayKey(value) === nameKey),
    );
    if (byName) {
      return byName.id;
    }
  }

  return atoms[itemIndex]?.id ?? null;
}

export function resolveHoldingMetric(item, labels) {
  return getItemFieldValue(item, labels) || '';
}
