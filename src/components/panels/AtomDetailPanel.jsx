// Pure presentational panel — App.jsx computes `fields`/`returnValue`/`returnToneClass` via its
// existing buildAtomInfoFields/getSignedValueToneClass/formatFieldLabel/translateDisplayValue
// helpers (kept local to App.jsx, not duplicated here) and passes the already-formatted result.
// This is the eventual cross-fade target for the Stage D black-hole transition — not a copy of
// HoverCard (a cursor-following tooltip unrelated to selection state).
export function AtomDetailPanel({ atom, fields, returnValue, returnToneClass, text, onClose }) {
  if (!atom) {
    return null;
  }

  return (
    <aside className="atom-detail-panel" role="dialog" aria-label={atom.label}>
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
