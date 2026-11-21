// The one detail card for a clicked electron. App.jsx resolves the holding's real numbers
// (resolveHoldingPosition: market value, P/L, return, shares, prices in the security's own
// currency, weight in the portfolio) and passes them as `metrics`; the raw CSV fields stay
// listed in full underneath (no folding). Draggable; remembers where it was dropped.
//
// The 유명인 tab opens this same card for an investor's holding, so the two look identical. It
// fills the same slots itself instead of `metrics`: `metricCells` (the four number tiles),
// `track` (a price track with its own end labels), `chips`, and `profitText` (the line beside
// the big return).
import { useCallback, useRef, useState } from 'react';

// Where the user last dragged the card, kept across selections so picking another holding
// doesn't snap it back.
let lastDragOffset = { x: 0, y: 0 };

function formatNumber(value, language, options = {}) {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString(language === 'en' ? 'en-US' : 'ko-KR', options);
}

function formatPrice(value, currency, language) {
  if (!Number.isFinite(value)) return '-';
  if (currency === 'KRW') return `₩${formatNumber(Math.round(value), language)}`;
  if (currency === 'USD') return `$${formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${formatNumber(value, language, { maximumFractionDigits: 2 })} ${currency ?? ''}`.trim();
}

// Buy price vs current price on one track: where you got in, where it is now.
function PriceTrack({ buy, current, currency, language, labels = null }) {
  if (!Number.isFinite(buy) || !Number.isFinite(current) || buy <= 0 || current <= 0) return null;
  const low = Math.min(buy, current) * 0.92;
  const high = Math.max(buy, current) * 1.08;
  const at = (value) => ((value - low) / (high - low)) * 100;
  const up = current >= buy;
  const en = language === 'en';
  return (
    <div className="atom-detail-panel__track" aria-label={en ? 'Buy price to current price' : '매수가에서 현재가까지'}>
      <div className="atom-detail-panel__track-bar">
        <span
          className={`atom-detail-panel__track-fill ${up ? 'is-positive' : 'is-negative'}`}
          style={{ left: `${Math.min(at(buy), at(current))}%`, width: `${Math.abs(at(current) - at(buy))}%` }}
        />
        <i className="is-buy" style={{ left: `${at(buy)}%` }} />
        <i className={`is-now ${up ? 'is-positive' : 'is-negative'}`} style={{ left: `${at(current)}%` }} />
      </div>
      <div className="atom-detail-panel__track-labels">
        <span>
          <em>{labels?.buy ?? (en ? 'Bought' : '매수가')}</em>
          {formatPrice(buy, currency, language)}
        </span>
        <span>
          <em>{labels?.current ?? (en ? 'Now' : '현재가')}</em>
          {formatPrice(current, currency, language)}
        </span>
      </div>
    </div>
  );
}

export function AtomDetailPanel({
  atom,
  fields,
  metrics = null,
  language = 'ko',
  formatMoney,
  returnValue,
  returnToneClass,
  issue,
  fix = null,
  onApplyFix,
  text,
  onClose,
  metricCells = null,
  track = null,
  chips: chipsOverride = null,
  profitText = null,
}) {
  const [offset, setOffset] = useState(lastDragOffset);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const panelRef = useRef(null);
  const en = language === 'en';

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0 || event.target.closest('button, summary, details')) {
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

  const money = (value, signed = false) =>
    Number.isFinite(value) && formatMoney ? formatMoney(value, { signed }) : '-';
  const weight = metrics?.weight;
  const chips =
    chipsOverride ??
    [metrics?.region, metrics?.sector, metrics?.style, metrics?.risk].filter(
      (value) => value && value !== '미분류' && value !== '-',
    );
  const cells =
    metricCells ??
    (metrics
      ? [
          { label: en ? 'Market value' : '평가금액', value: money(metrics.marketValue) },
          {
            label: en ? 'Weight' : '비중',
            value: Number.isFinite(weight) ? `${(weight * 100).toFixed(1)}%` : '-',
            bar: Number.isFinite(weight) ? weight : null,
          },
          {
            label: en ? 'Shares' : '보유수량',
            value: formatNumber(metrics.shares, language, { maximumFractionDigits: 4 }),
          },
          { label: en ? 'Cost' : '매입금액', value: money(metrics.buyAmount) },
        ]
      : null);
  const priceTrack =
    track ??
    (metrics
      ? { buy: metrics.buyPrice, current: metrics.currentPrice, currency: metrics.currency }
      : null);

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

      {returnValue || profitText || Number.isFinite(metrics?.profitAmount) ? (
        <div className="atom-detail-panel__hero">
          {returnValue ? (
            <span className={`atom-detail-panel__return${returnToneClass ? ` ${returnToneClass}` : ''}`}>
              {returnValue}
            </span>
          ) : null}
          {profitText ? (
            <span className="atom-detail-panel__profit atom-detail-panel__profit--note">{profitText}</span>
          ) : Number.isFinite(metrics?.profitAmount) ? (
            <span className={`atom-detail-panel__profit${returnToneClass ? ` ${returnToneClass}` : ''}`}>
              {money(metrics.profitAmount, true)}
            </span>
          ) : null}
        </div>
      ) : null}

      {issue ? (
        <div className="atom-detail-panel__issue" role="note">
          <p>⚠ {issue}</p>
          {fix ? (
            <>
              <p className="atom-detail-panel__fix-note">{fix.label}</p>
              <button type="button" className="atom-detail-panel__fix" onClick={() => onApplyFix?.()}>
                {fix.actionLabel}
              </button>
            </>
          ) : (
            <p className="atom-detail-panel__fix-note">{text?.holdingFixManual ?? '자동으로 맞출 값을 찾지 못했어요. 관리 탭에서 매수가와 수량을 직접 고쳐 주세요.'}</p>
          )}
        </div>
      ) : null}

      {cells?.length ? (
        <div className="atom-detail-panel__metrics">
          {cells.map((cell) => (
            <div key={cell.label}>
              <em>{cell.label}</em>
              <b className={cell.tone ? `is-${cell.tone}` : undefined}>{cell.value}</b>
              {Number.isFinite(cell.bar) ? (
                <i className="atom-detail-panel__weight" style={{ '--w': `${Math.min(100, cell.bar * 100)}%` }} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {priceTrack ? (
        <PriceTrack
          buy={priceTrack.buy}
          current={priceTrack.current}
          currency={priceTrack.currency}
          labels={priceTrack.labels}
          language={language}
        />
      ) : null}

      {chips.length ? (
        <div className="atom-detail-panel__chips">
          {chips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      ) : null}

      {fields.length ? (
        // Always open: every field is readable at a glance, nothing to unfold.
        <section className="atom-detail-panel__raw" aria-label={en ? 'All fields' : '전체 항목'}>
          <h4 className="atom-detail-panel__raw-title">
            {en ? 'All fields' : '전체 항목'}
            <em>{fields.length}</em>
          </h4>
          <dl className="atom-detail-panel__list">
            {fields.map((field, index) => (
              <div className="atom-detail-panel__row" key={`${atom.id}-${field.label}-${index}`}>
                <dt className="atom-detail-panel__label">{field.label}</dt>
                <dd className="atom-detail-panel__value">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
