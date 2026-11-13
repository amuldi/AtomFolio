// Pure presentational panel — App.jsx computes `fields`/`returnValue`/`returnToneClass` via its
// existing buildAtomInfoFields/getSignedValueToneClass/formatFieldLabel/translateDisplayValue
// helpers (kept local to App.jsx, not duplicated here) and passes the already-formatted result.
// This is the eventual cross-fade target for the Stage D black-hole transition — not a copy of
// HoverCard (a cursor-following tooltip unrelated to selection state).
import { useCallback, useRef, useState } from 'react';

// Where the user last dragged the card, kept across selections so picking another holding
// doesn't snap it back.
let lastDragOffset = { x: 0, y: 0 };

export function AtomDetailPanel({ atom, fields, returnValue, returnToneClass, issue, text, onClose }) {
  const [offset, setOffset] = useState(lastDragOffset);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const panelRef = useRef(null);

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0 || event.target.closest('button')) {
        return;
      }
      event.stopPropagation();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: offset,
        rect: panelRef.current?.getBoundingClientRect() ?? null,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragging(true);
    },
    [offset],
  );

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    let dx = event.clientX - drag.startX;
    let dy = event.clientY - drag.startY;
    // Keep at least part of the card on screen.
    if (drag.rect) {
      const margin = 24;
      dx = Math.min(Math.max(dx, margin - drag.rect.right), window.innerWidth - margin - drag.rect.left);
      dy = Math.min(Math.max(dy, margin - drag.rect.bottom), window.innerHeight - margin - drag.rect.top);
    }
    const next = { x: drag.origin.x + dx, y: drag.origin.y + dy };
    lastDragOffset = next;
    setOffset(next);
  }, []);

  const endDrag = useCallback((event) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  }, []);

  if (!atom) {
    return null;
  }

  return (
    <aside
      ref={panelRef}
      className={`atom-detail-panel${dragging ? ' is-dragging' : ''}`}
      role="dialog"
      aria-label={atom.label}
      style={{ '--drag-x': `${offset.x}px`, '--drag-y': `${offset.y}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        className="atom-detail-panel__close"
        onClick={onClose}
        aria-label={text.atomDetailCloseAria}
      >
        ×
      </button>

      <div className="atom-detail-panel__header">
        <strong className="atom-detail-panel__title">{atom.label}</strong>
        {atom.ticker || atom.stockCode ? (
          <span className="atom-detail-panel__code">{atom.ticker || atom.stockCode}</span>
        ) : null}
      </div>

      {returnValue ? (
        <span
          className={`atom-detail-panel__return${returnToneClass ? ` ${returnToneClass}` : ''}`}
        >
          {returnValue}
        </span>
      ) : null}

      {issue ? (
        <p className="atom-detail-panel__issue" role="note">
          ⚠ {issue}
        </p>
      ) : null}

      {fields.length ? (
        <div className="atom-detail-panel__list">
          {fields.map((field, index) => (
            <div className="atom-detail-panel__row" key={`${atom.id}-${field.label}-${index}`}>
              <span className="atom-detail-panel__label">{field.label}</span>
              <span className="atom-detail-panel__value">{field.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
