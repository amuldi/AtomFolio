import { useState, useRef } from 'react';
import {
  textFor,
  formatHeatmapValue,
  formatAllocationPercent,
  translateDisplayValue,
} from '../../utils/format.js';
import {
  buildAllocationArcPath,
  buildBlotPath,
  buildLoopPath,
} from '../../utils/scene.js';
import { ALLOCATION_SEGMENT_PALETTE } from '../../constants/ui.js';

export function PortfolioAllocationRing({
  allocation,
  language,
  hoverInfo = null,
  setSegmentHover,
  clearSegmentHover,
  interactive = false,
  className = 'allocation-chart',
  decorative = false,
  compact = false,
}) {
  const text = textFor(language);
  const hoveredSegment =
    interactive && hoverInfo?.segmentId
      ? (allocation.segments.find((segment) => segment.id === hoverInfo.segmentId) ?? null)
      : null;
  const center = 96;
  const radius = 58;
  const segmentGapAngle = allocation.segments.length > 1 ? 0.068 : 0;
  const trackPathSoft = buildAllocationArcPath({
    centerX: center,
    centerY: center,
    radius,
    startAngle: 0.02,
    endAngle: Math.PI * 2 - 0.04,
    seed: 9123,
    wobble: 2.8,
  });
  const trackPathMain = buildAllocationArcPath({
    centerX: center,
    centerY: center,
    radius: radius - 0.6,
    startAngle: 0.04,
    endAngle: Math.PI * 2 - 0.02,
    seed: 9277,
    wobble: 2.1,
  });
  let offset = 0;

  return (
    <svg
      className={className}
      viewBox="0 0 192 192"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : text.allocationChartAria}
      aria-hidden={decorative || undefined}
    >
      <g className="allocation-chart__base">
        <circle className="allocation-chart__glow" cx={center} cy={center} r="72" />
        <path className="allocation-chart__track-soft" d={trackPathSoft} />
        <path className="allocation-chart__track" d={trackPathMain} />
      </g>

      {allocation.segments.map((segment, index) => {
        const palette = ALLOCATION_SEGMENT_PALETTE[index % ALLOCATION_SEGMENT_PALETTE.length];
        const isHovered = interactive && hoverInfo?.segmentId === segment.id;
        const isDimmed = interactive && hoverInfo?.segmentId && !isHovered;
        const startAngle = -Math.PI / 2 + offset * Math.PI * 2 + segmentGapAngle * 0.5;
        const endAngle =
          -Math.PI / 2 + (offset + segment.weight) * Math.PI * 2 - segmentGapAngle * 0.5;
        const softPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius: radius + 0.8,
          startAngle,
          endAngle,
          seed: 1103 + index * 79,
          wobble: 3.3,
        });
        const mainPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius,
          startAngle,
          endAngle,
          seed: 1277 + index * 79,
          wobble: 2.6,
        });
        const highlightPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius: radius - 1.6,
          startAngle: startAngle + 0.006,
          endAngle: endAngle - 0.006,
          seed: 1411 + index * 79,
          wobble: 2.1,
        });

        offset += segment.weight;

        if (!mainPath) {
          return null;
        }

        return (
          <g
            key={segment.id}
            className={`allocation-chart__segment-group${isHovered ? ' is-active' : ''}${
              isDimmed ? ' is-dimmed' : ''
            }`}
          >
            {compact ? null : (
              <>
                <circle
                  className="allocation-chart__segment-cap"
                  cx={center + Math.cos(startAngle) * radius}
                  cy={center + Math.sin(startAngle) * radius}
                  r="1.5"
                  fill={palette.main}
                />
                <circle
                  className="allocation-chart__segment-cap"
                  cx={center + Math.cos(endAngle) * radius}
                  cy={center + Math.sin(endAngle) * radius}
                  r="1.35"
                  fill={palette.highlight}
                />
              </>
            )}
            <path
              className="allocation-chart__segment-soft"
              d={softPath}
              stroke={palette.soft}
            />
            <path
              className="allocation-chart__segment"
              d={mainPath}
              stroke={palette.main}
            />
            <path
              className="allocation-chart__segment-highlight"
              d={highlightPath}
              stroke={palette.highlight}
            />
            {interactive ? (
              <path
                className="allocation-chart__segment-hit"
                d={softPath || mainPath}
                onPointerEnter={() => {
                  setSegmentHover?.(segment);
                }}
                onPointerLeave={() => {
                  clearSegmentHover?.();
                }}
              />
            ) : null}
          </g>
        );
      })}

      <g transform={`translate(${center} ${center})`}>
        {compact ? (
          <>
            <path className="allocation-chart__core-soft" d={buildBlotPath(28.8, 8801)} />
            <path className="allocation-chart__core-main" d={buildBlotPath(25.2, 8947)} />
            <path className="allocation-chart__core-ring" d={buildLoopPath(24.1, 9193)} />
          </>
        ) : (
          <>
            <path className="allocation-chart__core-soft" d={buildBlotPath(41.5, 8801)} />
            <path className="allocation-chart__core-main" d={buildBlotPath(38.2, 8947)} />
            <path className="allocation-chart__core-ring-soft" d={buildLoopPath(39.6, 9061)} />
            <path className="allocation-chart__core-ring" d={buildLoopPath(34.8, 9193)} />
          </>
        )}
      </g>
      {compact ? null : (
        <>
          {/* Hovering a segment/legend row swaps this center text to that segment's own
              name+share instead of popping a floating tooltip box over the chart — same
              information, no element that can cover other content on screen. */}
          <text className="allocation-chart__center-label" x={center} y="84" textAnchor="middle">
            {hoveredSegment
              ? hoveredSegment.isUnknown
                ? text.allocationUnknown
                : translateDisplayValue(hoveredSegment.label, language)
              : text.allocationTotalReturn}
          </text>
          <text
            className={`allocation-chart__center-value${
              hoveredSegment
                ? ''
                : allocation.hasReturnData && allocation.totalReturn > 0
                  ? ' is-positive'
                  : allocation.hasReturnData && allocation.totalReturn < 0
                    ? ' is-negative'
                    : ''
            }`}
            x={center}
            y="108"
            textAnchor="middle"
          >
            {hoveredSegment
              ? formatAllocationPercent(hoveredSegment.weight)
              : allocation.hasReturnData
                ? formatHeatmapValue(allocation.totalReturn, 'percent')
                : '—'}
          </text>
        </>
      )}
    </svg>
  );
}

const COLLAPSED_ROWS = 5;

// Donut + legend. The legend opens in two steps: the top few rows first ("전체 N개 펼치기" shows
// the rest), and any row can be pressed to open what is behind that slice — its share, how it has
// done and what it is worth.
export function PortfolioAllocationCard({
  allocation,
  language,
  onInteract,
  onPointerDown,
  formatValue = null,
  collapsedRows = COLLAPSED_ROWS,
  className = 'allocation-panel',
}) {
  const panelRef = useRef(null);
  const text = textFor(language);
  const en = language === 'en';
  // Just which segment, no cursor position to track — the hover effect is the donut's own center
  // text swapping plus the segment/legend highlight (see PortfolioAllocationRing), not a
  // cursor-anchored floating box, so there's nothing here that needs a coordinate.
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState(null);

  const setSegmentHover = (segment) => {
    setHoverInfo({ segmentId: segment.id });
  };

  const clearSegmentHover = () => {
    setHoverInfo(null);
  };

  const total = allocation.segments.length;
  const canFold = total > collapsedRows + 1;
  const visible = canFold && !showAll ? allocation.segments.slice(0, collapsedRows) : allocation.segments;
  const hiddenWeight = canFold && !showAll
    ? allocation.segments.slice(collapsedRows).reduce((sum, segment) => sum + segment.weight, 0)
    : 0;
  const maxWeight = Math.max(0.0001, ...allocation.segments.map((segment) => segment.weight));

  return (
    <aside
      ref={panelRef}
      className={className}
      aria-label={text.allocationChartAria}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        onInteract?.();
      }}
    >
      <div className="allocation-panel__chart-wrap">
        <PortfolioAllocationRing
          allocation={allocation}
          language={language}
          hoverInfo={hoverInfo}
          setSegmentHover={setSegmentHover}
          clearSegmentHover={clearSegmentHover}
          interactive
        />
      </div>

      <div className="allocation-panel__legend">
        {visible.map((segment) => {
          const index = allocation.segments.indexOf(segment);
          const palette = ALLOCATION_SEGMENT_PALETTE[index % ALLOCATION_SEGMENT_PALETTE.length];
          const label = segment.isUnknown
            ? text.allocationUnknown
            : translateDisplayValue(segment.label, language);
          const isHovered = hoverInfo?.segmentId === segment.id;
          const isDimmed = hoverInfo?.segmentId && !isHovered;
          const isOpen = openId === segment.id;
          const hasReturn = Number.isFinite(segment.returnRate);
          const returnTone = !hasReturn || Math.abs(segment.returnRate) < 0.005 ? '' : segment.returnRate > 0 ? 'positive' : 'negative';

          return (
            <div
              key={`legend-${segment.id}`}
              className={`allocation-panel__legend-item${isOpen ? ' is-open' : ''}${isHovered ? ' is-active' : ''}${
                isDimmed ? ' is-dimmed' : ''
              }`}
              style={{ '--segment-color': palette.main, '--segment-shadow': palette.glow }}
              onPointerEnter={() => setSegmentHover(segment)}
              onPointerLeave={clearSegmentHover}
            >
              <button
                type="button"
                className="allocation-panel__legend-row"
                aria-expanded={isOpen}
                onClick={() => {
                  onInteract?.();
                  setOpenId(isOpen ? null : segment.id);
                }}
              >
                <span className="allocation-panel__swatch" aria-hidden="true" />
                <span className="allocation-panel__legend-label" title={label}>
                  {label}
                </span>
                <span className="allocation-panel__legend-value">{formatAllocationPercent(segment.weight)}</span>
                <i className="allocation-panel__chevron" aria-hidden="true" />
              </button>
              {isOpen ? (
                <dl className="allocation-panel__detail">
                  <div className="allocation-panel__detail-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, (segment.weight / maxWeight) * 100)}%` }} />
                  </div>
                  {Number.isFinite(segment.value) && formatValue ? (
                    <div>
                      <dt>{en ? 'Value' : '평가금액'}</dt>
                      <dd>{formatValue(segment.value)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{en ? 'Return' : '수익률'}</dt>
                    <dd className={returnTone}>
                      {hasReturn
                        ? `${segment.returnRate > 0.005 ? '▲' : segment.returnRate < -0.005 ? '▼' : ''}${Math.abs(segment.returnRate).toFixed(1)}%`
                        : '-'}
                    </dd>
                  </div>
                  {segment.count > 1 ? (
                    <div>
                      <dt>{en ? 'Holdings' : '포함 종목'}</dt>
                      <dd>{en ? segment.count : `${segment.count}개`}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          );
        })}
        {canFold ? (
          <button
            type="button"
            className="allocation-panel__more"
            aria-expanded={showAll}
            onClick={() => {
              onInteract?.();
              setShowAll((value) => !value);
            }}
          >
            {showAll
              ? en
                ? 'Show fewer'
                : '접기'
              : en
                ? `Show all ${total} · ${formatAllocationPercent(hiddenWeight)} more`
                : `전체 ${total}개 펼치기 · 나머지 ${formatAllocationPercent(hiddenWeight)}`}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
