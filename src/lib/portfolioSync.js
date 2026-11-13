// Pure helpers behind live-quote refresh and autosave, kept out of App.jsx so they can be tested.
// These sit on the two paths that write a user's holdings back to the server, which is where a
// silent bug costs real data (see applyEnrichedRowsToEntry).

// Writes quote-enriched rows back into a portfolio entry. Rows are matched by *object identity*
// with the rows that were sent for enrichment, never by position.
//
// An earlier version merged by index: a refresh seeded with the first 20 timeline rows was written
// over `entry.items` position by position whenever the timeline length differed (it does as soon
// as a daily snapshot pushes it past 20 rows). Unrelated rows landed in holding slots, duplicates
// collapsed, and real holdings disappeared from the portfolio and were then autosaved.
//
// `collapse` turns timeline rows into display holdings; `identityKey` names a holding.
export function applyEnrichedRowsToEntry(entry, seedItems, enrichedItems, { collapse, identityKey }) {
  const enrichedBySeed = new Map(
    (seedItems ?? []).map((seed, index) => [seed, enrichedItems?.[index] ?? seed]),
  );
  const swap = (row) => enrichedBySeed.get(row) ?? row;
  const timeline = Array.isArray(entry?.timelineItems) ? entry.timelineItems : [];
  const items = Array.isArray(entry?.items) ? entry.items : [];
  const timelineHits = timeline.filter((row) => enrichedBySeed.has(row)).length;
  const itemHits = items.filter((row) => enrichedBySeed.has(row)).length;

  let nextTimeline = timeline;
  let nextItems = items;
  if (timelineHits > 0) {
    nextTimeline = timeline.map(swap);
    nextItems = collapse(nextTimeline);
  } else if (itemHits > 0) {
    nextItems = collapse(items.map(swap));
  } else {
    // The entry changed while quotes were in flight; nothing to match safely.
    return entry;
  }

  // A price refresh must never change which holdings exist.
  const nextKeys = new Set(nextItems.map(identityKey));
  if (items.some((item) => !nextKeys.has(identityKey(item)))) {
    return entry;
  }

  return {
    ...entry,
    items: nextItems,
    timelineItems: timelineHits > 0 ? nextTimeline : entry.timelineItems,
  };
}

// The rows to refresh: the latest row of each holding. The first N rows of a long timeline are
// its oldest history, so seeding with them refreshed stale snapshots and skipped what's on screen.
export function selectLatestRowPerHolding(rows, identityKey, limit = Infinity) {
  const latest = new Map();
  (rows ?? []).forEach((row) => {
    const key = identityKey(row);
    // Re-insert so iteration order follows each holding's latest appearance.
    latest.delete(key);
    latest.set(key, row);
  });
  return [...latest.values()].slice(0, limit);
}

// Autosave: which entries differ from what the server last confirmed. `synced` maps
// `${workspaceId}|${entryId}` to the serialized JSON last known to match the server.
export function selectChangedEntries(entries, synced, workspaceId) {
  return (entries ?? [])
    .map((entry) => ({
      entry,
      key: `${workspaceId}|${entry.id}`,
      json: JSON.stringify(entry),
    }))
    .filter(({ key, json }) => synced.get(key) !== json);
}
