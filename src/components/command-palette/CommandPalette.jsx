// Cmd+K / Ctrl+K command palette — search, add, move, delete holdings from one place instead of
// the rail → account → row-button chain the tool drawer requires for the same operations (see
// App.jsx's own trace of that flow). Deliberately does NOT reimplement live ticker/market lookup
// itself: "add" hands off to the existing manual-entry form (already has that pipeline, tested and
// working) via onAddNew, pre-filling its ticker field rather than duplicating async market-data
// fetching in a second place that could drift from the first.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildGroupedHoldingItems,
  resolveHoldingName,
  resolveHoldingTicker,
  resolveHoldingMetric,
} from '../../utils/holdings.js';

function portfolioLabel(entry) {
  return (
    String(entry?.fileName ?? '')
      .replace(/\.csv$/i, '')
      .trim() || '포트폴리오'
  );
}

function normalizeSearchKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Local rather than App.jsx's own getSignedValueToneClass/parseSignedDisplayValue — those parse
// several differently-formatted numeric strings across the whole app; here it's always exactly
// the same '+12.3%'/'-4%' shape already produced for display, so a plain sign check is enough.
function returnToneClass(returnRate) {
  const trimmed = String(returnRate ?? '').trim();
  if (trimmed.startsWith('-')) return 'is-down';
  if (trimmed.startsWith('+') || /^[0-9]/.test(trimmed)) return 'is-up';
  return '';
}

// Ticker-prefix matches first, then name-prefix, then substring anywhere — a plain filter+sort
// over a few dozen holdings is plenty fast without a fuzzy-match library.
function rankResult(row, key) {
  const ticker = normalizeSearchKey(row.ticker);
  const name = normalizeSearchKey(row.name);
  if (ticker && ticker.startsWith(key)) return 0;
  if (name.startsWith(key)) return 1;
  if (ticker.includes(key)) return 2;
  if (name.includes(key)) return 3;
  return -1;
}

const MAX_RESULTS = 30;

export function CommandPalette({
  open,
  onClose,
  portfolioEntries,
  language,
  onGoToHolding,
  onDeleteHolding,
  onMoveHolding,
  onAddNew,
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [moveMenuKey, setMoveMenuKey] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setActiveIndex(0);
    setMoveMenuKey(null);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const allRows = useMemo(() => {
    const rows = [];
    (portfolioEntries ?? []).forEach((entry) => {
      const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
      buildGroupedHoldingItems(sourceItems).forEach((item, itemIndex) => {
        rows.push({
          key: `${entry.id}:${item.holdingGroupKey ?? itemIndex}`,
          entryId: entry.id,
          entryLabel: portfolioLabel(entry),
          item,
          itemId: item.id ?? '',
          itemIds: item.groupedSourceItemIds ?? [],
          itemIndex,
          itemIndexes: item.groupedSourceItemIndexes ?? [],
          name: resolveHoldingName(item),
          ticker: resolveHoldingTicker(item),
          returnRate:
            String(item?.detail ?? item?.return ?? '').trim() ||
            resolveHoldingMetric(item, ['수익률', 'return']),
        });
      });
    });
    return rows;
  }, [portfolioEntries]);

  const results = useMemo(() => {
    const key = normalizeSearchKey(query);
    if (!key) {
      return allRows.slice(0, MAX_RESULTS);
    }
    return allRows
      .map((row) => ({ row, rank: rankResult(row, key) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name))
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.row);
  }, [allRows, query]);

  // The "add new" row is its own list item at the end — always reachable by arrow key, not a
  // separate keyboard path the user has to discover.
  const trimmedQuery = query.trim();
  const showAddRow = trimmedQuery.length > 0;
  const rowCount = results.length + (showAddRow ? 1 : 0);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(rowCount - 1, 0)));
  }, [rowCount]);

  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current
      ?.querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const otherPortfolios = (targetRow) =>
    (portfolioEntries ?? []).filter((entry) => entry.id !== targetRow.entryId);

  const activateRow = (index) => {
    if (index < results.length) {
      const row = results[index];
      onGoToHolding?.({ entryId: row.entryId, item: row.item, itemIndex: row.itemIndex });
      onClose?.();
      return;
    }
    if (showAddRow) {
      onAddNew?.(trimmedQuery);
      onClose?.();
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (moveMenuKey) {
        setMoveMenuKey(null);
        return;
      }
      onClose?.();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMoveMenuKey(null);
      setActiveIndex((current) => Math.min(current + 1, rowCount - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMoveMenuKey(null);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateRow(activeIndex);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-label={language === 'en' ? 'Command palette' : '커맨드 팔레트'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette__input-row">
          <span className="command-palette__input-icon" aria-hidden="true">
            ⌘K
          </span>
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setMoveMenuKey(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              language === 'en' ? 'Search or add a holding…' : '종목 검색 또는 추가…'
            }
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={
              rowCount ? `command-palette-row-${activeIndex}` : undefined
            }
          />
        </div>

        <div
          className="command-palette__list"
          id="command-palette-list"
          role="listbox"
          ref={listRef}
        >
          {results.length === 0 && !showAddRow ? (
            <div className="command-palette__empty">
              {language === 'en' ? 'No holdings yet' : '아직 등록된 종목이 없습니다'}
            </div>
          ) : null}

          {results.map((row, index) => (
            <div
              key={row.key}
              id={`command-palette-row-${index}`}
              data-row-index={index}
              role="option"
              aria-selected={index === activeIndex}
              className={`command-palette__row${index === activeIndex ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <button
                type="button"
                className="command-palette__row-main"
                onClick={() => activateRow(index)}
              >
                <span className="command-palette__row-name">{row.name}</span>
                <span className="command-palette__row-meta">
                  {row.ticker ? <em>{row.ticker}</em> : null}
                  <small>{row.entryLabel}</small>
                </span>
              </button>
              {row.returnRate ? (
                <span className={`command-palette__row-return ${returnToneClass(row.returnRate)}`}>
                  {row.returnRate}
                </span>
              ) : null}
              <div className="command-palette__row-actions">
                <button
                  type="button"
                  className="command-palette__row-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMoveMenuKey((current) => (current === row.key ? null : row.key));
                  }}
                  aria-label={language === 'en' ? 'Move to another portfolio' : '다른 포트폴리오로 이동'}
                  aria-expanded={moveMenuKey === row.key}
                >
                  {language === 'en' ? 'Move' : '이동'}
                </button>
                <button
                  type="button"
                  className="command-palette__row-action command-palette__row-action--danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteHolding?.({
                      entryId: row.entryId,
                      itemId: row.itemId,
                      itemIds: row.itemIds,
                      itemIndex: row.itemIndex,
                      itemIndexes: row.itemIndexes,
                    });
                    // Deleting doesn't close the palette (there may be more to do), but a mouse
                    // click on this button leaves focus sitting on a now-possibly-gone button
                    // instead of the search field — without this, the very next keystroke (e.g.
                    // typing to search for what to delete next) would silently go nowhere.
                    inputRef.current?.focus();
                  }}
                  aria-label={language === 'en' ? 'Delete holding' : '종목 삭제'}
                >
                  {language === 'en' ? 'Delete' : '삭제'}
                </button>
              </div>

              {moveMenuKey === row.key ? (
                <div className="command-palette__move-menu" role="menu">
                  {otherPortfolios(row).length ? (
                    otherPortfolios(row).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="menuitem"
                        className="command-palette__move-option"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveHolding?.({
                            sourceEntryId: row.entryId,
                            targetEntryId: entry.id,
                            item: row.item,
                            itemId: row.itemId,
                            itemIds: row.itemIds,
                            itemIndex: row.itemIndex,
                            itemIndexes: row.itemIndexes,
                          });
                          setMoveMenuKey(null);
                          onClose?.();
                        }}
                      >
                        {portfolioLabel(entry)}
                      </button>
                    ))
                  ) : (
                    <span className="command-palette__move-empty">
                      {language === 'en' ? 'No other portfolios' : '다른 포트폴리오가 없습니다'}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ))}

          {showAddRow ? (
            <div
              id={`command-palette-row-${results.length}`}
              data-row-index={results.length}
              role="option"
              aria-selected={results.length === activeIndex}
              className={`command-palette__row command-palette__row--add${
                results.length === activeIndex ? ' is-active' : ''
              }`}
              onMouseEnter={() => setActiveIndex(results.length)}
            >
              <button
                type="button"
                className="command-palette__row-main"
                onClick={() => activateRow(results.length)}
              >
                <span className="command-palette__row-name">
                  {language === 'en' ? `Add "${trimmedQuery}"` : `“${trimmedQuery}” 추가`}
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="command-palette__hints">
          <span>↑↓ {language === 'en' ? 'navigate' : '이동'}</span>
          <span>↵ {language === 'en' ? 'select' : '선택'}</span>
          <span>Esc {language === 'en' ? 'close' : '닫기'}</span>
        </div>
      </div>
    </div>
  );
}
