// "관리 모드" — a plain spreadsheet-style table over the active portfolio's holdings, the
// batch-edit counterpart to "탐색 모드" (the atom scene). Every cell is a bound input; edits
// commit on blur (or Enter), matching ordinary spreadsheet muscle memory rather than requiring a
// separate "edit" step per row the way the tool drawer's row-by-row form does. Plain React + the
// app's existing style tokens — no table/grid library, this is exactly the kind of UI a <table>
// already does well.
import { useEffect, useMemo, useState } from 'react';
import {
  buildGroupedHoldingItems,
  resolveHoldingName,
  resolveHoldingTicker,
  resolveHoldingMetric,
} from '../../utils/holdings.js';

function draftFromItem(entryId, item, itemIndex) {
  return {
    key: `${entryId}:${item.holdingGroupKey ?? itemIndex}`,
    entryId,
    itemId: item.id ?? '',
    itemIds: item.groupedSourceItemIds ?? [],
    itemIndex,
    itemIndexes: item.groupedSourceItemIndexes ?? [],
    stockName: resolveHoldingName(item),
    ticker: resolveHoldingTicker(item),
    buyPrice: resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']),
    shares: resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']),
    returnRate:
      String(item?.detail ?? item?.return ?? '').trim() ||
      resolveHoldingMetric(item, ['수익률', 'return']),
    assetClass: String(item?.assetClass ?? '').trim() || '주식',
  };
}

const EMPTY_NEW_ROW = { stockName: '', ticker: '', buyPrice: '', shares: '', returnRate: '', assetClass: '주식' };

const COLUMNS = [
  { key: 'stockName', labelKo: '종목명', labelEn: 'Name', width: '1.4fr' },
  { key: 'ticker', labelKo: '티커', labelEn: 'Ticker', width: '0.8fr' },
  { key: 'buyPrice', labelKo: '매수가', labelEn: 'Buy price', width: '0.9fr' },
  { key: 'shares', labelKo: '수량', labelEn: 'Shares', width: '0.7fr' },
  { key: 'returnRate', labelKo: '수익률', labelEn: 'Return', width: '0.7fr' },
  { key: 'assetClass', labelKo: '자산군', labelEn: 'Asset class', width: '0.8fr' },
];

export function HoldingsManagementTable({
  activePortfolio,
  language,
  onUpdateHolding,
  onDeleteHolding,
  onAppendHolding,
}) {
  const sourceItems = useMemo(
    () =>
      (activePortfolio?.timelineItems?.length
        ? activePortfolio.timelineItems
        : activePortfolio?.items) ?? [],
    [activePortfolio],
  );
  const groupedItems = useMemo(() => buildGroupedHoldingItems(sourceItems), [sourceItems]);

  const [rows, setRows] = useState(() =>
    groupedItems.map((item, index) => draftFromItem(activePortfolio?.id, item, index)),
  );
  const [newRow, setNewRow] = useState(EMPTY_NEW_ROW);

  // Re-seed local drafts whenever the underlying data actually changes (switched portfolio, a
  // holding added/removed elsewhere, a poll-tick price refresh) — but not on every render, or an
  // in-progress edit would get stomped by its own not-yet-committed value round-tripping back in.
  useEffect(() => {
    setRows(groupedItems.map((item, index) => draftFromItem(activePortfolio?.id, item, index)));
  }, [activePortfolio?.id, groupedItems]);

  const updateCell = (rowIndex, field, value) => {
    setRows((current) =>
      current.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)),
    );
  };

  const commitRow = (row) => {
    onUpdateHolding?.({
      entryId: row.entryId,
      itemId: row.itemId,
      itemIndex: row.itemIndex,
      row: {
        stockName: row.stockName,
        ticker: row.ticker,
        buyPrice: row.buyPrice,
        shares: row.shares,
        returnRate: row.returnRate,
        assetClass: row.assetClass,
      },
    });
  };

  const commitNewRow = () => {
    if (!newRow.stockName.trim() && !newRow.ticker.trim()) {
      return;
    }
    onAppendHolding?.({ entryId: activePortfolio?.id, rows: [newRow] });
    setNewRow(EMPTY_NEW_ROW);
  };

  if (!activePortfolio) {
    return (
      <div className="holdings-table__empty">
        {language === 'en' ? 'Select a portfolio to manage its holdings.' : '먼저 포트폴리오를 선택하세요.'}
      </div>
    );
  }

  return (
    <div className="holdings-table">
      <div className="holdings-table__grid" style={{ gridTemplateColumns: `${COLUMNS.map((c) => c.width).join(' ')} auto` }}>
        <div className="holdings-table__head-row">
          {COLUMNS.map((column) => (
            <div className="holdings-table__head-cell" key={column.key}>
              {language === 'en' ? column.labelEn : column.labelKo}
            </div>
          ))}
          <div className="holdings-table__head-cell" aria-hidden="true" />
        </div>

        {rows.map((row, rowIndex) => (
          // display: contents rows can't carry their own background/border (they don't generate a
          // box at all — only their children do), so the odd/even read has to reach the cells some
          // other way. A data attribute on this element still cascades a CSS custom property down
          // to its children (custom-property inheritance follows the DOM tree, not the box tree —
          // display: contents doesn't interrupt it), so .holdings-table__cell can just read
          // --row-tint per row without any specificity fight against :hover/:focus, which set their
          // own background directly and keep working unchanged.
          <div
            className="holdings-table__row"
            data-row-parity={rowIndex % 2 === 0 ? 'even' : 'odd'}
            key={row.key}
          >
            {COLUMNS.map((column) => (
              <input
                key={column.key}
                className="holdings-table__cell"
                type="text"
                value={row[column.key]}
                onChange={(event) => updateCell(rowIndex, column.key, event.target.value)}
                onBlur={() => commitRow(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            ))}
            <button
              type="button"
              className="holdings-table__delete"
              onClick={() =>
                onDeleteHolding?.({
                  entryId: row.entryId,
                  itemId: row.itemId,
                  itemIds: row.itemIds,
                  itemIndex: row.itemIndex,
                  itemIndexes: row.itemIndexes,
                })
              }
              aria-label={language === 'en' ? 'Delete holding' : '종목 삭제'}
            >
              ×
            </button>
          </div>
        ))}

        <div
          className="holdings-table__row holdings-table__row--new"
          data-row-parity={rows.length % 2 === 0 ? 'even' : 'odd'}
        >
          {COLUMNS.map((column) => (
            <input
              key={column.key}
              className="holdings-table__cell"
              type="text"
              value={newRow[column.key]}
              placeholder={
                column.key === 'stockName'
                  ? language === 'en'
                    ? 'New holding…'
                    : '새 종목…'
                  : ''
              }
              onChange={(event) => setNewRow((current) => ({ ...current, [column.key]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitNewRow();
                }
              }}
            />
          ))}
          <button
            type="button"
            className="holdings-table__add"
            onClick={commitNewRow}
            aria-label={language === 'en' ? 'Add holding' : '종목 추가'}
          >
            {language === 'en' ? 'Add' : '추가'}
          </button>
        </div>
      </div>
    </div>
  );
}
