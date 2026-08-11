import { useState, useRef } from 'react';
import { clamp } from '../../utils/math.js';
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
                onPointerEnter={(event) => {
                  setSegmentHover?.(segment, event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  setSegmentHover?.(segment, event.clientX, event.clientY);
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
          <text className="allocation-chart__center-label" x={center} y="84" textAnchor="middle">
            {text.allocationTotalReturn}
          </text>
          <text
            className={`allocation-chart__center-value${
              allocation.hasReturnData && allocation.totalReturn > 0
                ? ' is-positive'
                : allocation.hasReturnData && allocation.totalReturn < 0
                  ? ' is-negative'
                  : ''
            }`}
            x={center}
            y="108"
            textAnchor="middle"
          >
            {allocation.hasReturnData ? formatHeatmapValue(allocation.totalReturn, 'percent') : '—'}
          </text>
        </>
      )}
    </svg>
  );
}

export function PortfolioAllocationCard({
  allocation,
  language,
  onInteract,
  onPointerDown,
  className = 'allocation-panel',
}) {
  const panelRef = useRef(null);
  const text = textFor(language);
  const [hoverInfo, setHoverInfo] = useState(null);

  const resolveHoverPosition = (clientX, clientY) => {
    const bounds = panelRef.current?.getBoundingClientRect();

    if (!bounds) {
      return { x: 96, y: 78 };
    }

    return {
      x: clamp(clientX - bounds.left, 84, bounds.width - 84),
      // The tooltip anchors here but then rises by its own full height plus 10px
      // (`.allocation-panel__tooltip`'s `translate(-50%, calc(-100% - 10px))`) — a 48px floor left
      // barely more than half the tooltip's actual rendered height (~55-65px) above it, so it could
      // clip through the panel's own top edge. 78px leaves real headroom for that upward shift.
      y: clamp(clientY - bounds.top - 16, 78, bounds.height - 24),
    };
  };

  const setSegmentHover = (segment, clientX, clientY) => {
    setHoverInfo({
      segmentId: segment.id,
      x: resolveHoverPosition(clientX, clientY).x,
      y: resolveHoverPosition(clientX, clientY).y,
    });
  };

  const clearSegmentHover = () => {
    setHoverInfo(null);
  };

  const hoveredSegment =
    allocation.segments.find((segment) => segment.id === hoverInfo?.segmentId) ?? null;
  const hoveredSegmentLabel = hoveredSegment
    ? hoveredSegment.isUnknown
      ? text.allocationUnknown
      : translateDisplayValue(hoveredSegment.label, language)
    : '';

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

      {hoveredSegment && hoverInfo ? (
        <div
          className="allocation-panel__tooltip"
          style={{
            left: `${hoverInfo.x}px`,
            top: `${hoverInfo.y}px`,
          }}
        >
          <strong className="allocation-panel__tooltip-title">{hoveredSegmentLabel}</strong>
          <span className="allocation-panel__tooltip-value">
            {text.allocationShareLabel} {formatAllocationPercent(hoveredSegment.weight)}
          </span>
        </div>
      ) : null}

      <div className="allocation-panel__legend">
        {allocation.segments.map((segment, index) => {
          const palette = ALLOCATION_SEGMENT_PALETTE[index % ALLOCATION_SEGMENT_PALETTE.length];
          const label = segment.isUnknown
            ? text.allocationUnknown
            : translateDisplayValue(segment.label, language);
          const isHovered = hoverInfo?.segmentId === segment.id;
          const isDimmed = hoverInfo?.segmentId && !isHovered;

          return (
            <div
              key={`legend-${segment.id}`}
              className={`allocation-panel__legend-row${isHovered ? ' is-active' : ''}${
                isDimmed ? ' is-dimmed' : ''
              }`}
              onPointerEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSegmentHover(segment, rect.left + rect.width * 0.5, rect.top);
              }}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSegmentHover(segment, rect.left + rect.width * 0.5, rect.top);
              }}
              onPointerLeave={clearSegmentHover}
            >
              <span
                className="allocation-panel__swatch"
                style={{ '--segment-color': palette.main, '--segment-shadow': palette.glow }}
                aria-hidden="true"
              />
              <span className="allocation-panel__legend-label">{label}</span>
              <span className="allocation-panel__legend-value">{formatAllocationPercent(segment.weight)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

