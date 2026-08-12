import { useEffect, useRef, useState } from 'react';
import { format } from '../../utils/math.js';
import { textFor } from '../../utils/format.js';
import { buildScoreSketchPolygon, buildScoreAxisPath, buildLoopPath } from '../../utils/scene.js';

// This card renders in very differently-sized places — a wide floating widget, and a narrow
// drawer sidebar column not much wider than the hint box itself. A fixed pixel margin from
// whichever edge the hint's box actually ends up clipped against, measured after it's rendered
// rather than guessed from the hexagon's geometry alone (see the clamp effect below for why the
// geometry-only anchor isn't enough on its own in the narrow case).
const SCORE_HINT_EDGE_MARGIN_PX = 8;

export function PortfolioScoreCard({
  scorecard,
  axes,
  language,
  className = 'score-panel',
  onPointerDown,
}) {
  const [hoveredMetricKey, setHoveredMetricKey] = useState(null);
  const cardRef = useRef(null);
  const hintRef = useRef(null);
  const [hintClamp, setHintClamp] = useState({ x: 0, y: 0 });
  const [hintMaxWidth, setHintMaxWidth] = useState(null);
  const center = 104;
  const radius = 74;
  const angleStep = (Math.PI * 2) / axes.length;
  const rings = [0.25, 0.5, 0.75, 1];
  const text = textFor(language);
  const axisPoints = axes.map((axis, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const outerX = center + Math.cos(angle) * radius;
    const outerY = center + Math.sin(angle) * radius;
    const labelRadius = radius + 8;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const verticalOffset = sin > 0.82 ? 4 : sin < -0.82 ? -3 : 0;
    const horizontalOffset = cos > 0.82 ? 2 : cos < -0.82 ? -2 : 0;

    return {
      ...axis,
      angle,
      outerX,
      outerY,
      labelX: center + cos * labelRadius + horizontalOffset,
      labelY: center + sin * labelRadius + verticalOffset,
      value: scorecard.metrics[axis.key],
    };
  });
  const ringPaths = rings.map((ring, ringIndex) => {
    const ringPoints = axisPoints.map((axis) => ({
      x: center + Math.cos(axis.angle) * radius * ring,
      y: center + Math.sin(axis.angle) * radius * ring,
    }));

    return {
      key: `ring-${ring}`,
      soft: buildScoreSketchPolygon(ringPoints, 901 + ringIndex * 17, 0.95 + ringIndex * 0.28),
      main: buildScoreSketchPolygon(ringPoints, 933 + ringIndex * 17, 0.74 + ringIndex * 0.22),
    };
  });
  const axisSketches = axisPoints.map((axis, index) => ({
    key: axis.key,
    soft: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      1101 + index * 23,
    ),
    main: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      1163 + index * 23,
    ),
  }));
  const radarPoints = axisPoints.map((axis) => {
    const scaledRadius = radius * (axis.value / 100);
    return {
      ...axis,
      x: center + Math.cos(axis.angle) * scaledRadius,
      y: center + Math.sin(axis.angle) * scaledRadius,
    };
  });
  const radarPathSoft = buildScoreSketchPolygon(
    radarPoints.map(({ x, y }) => ({ x, y })),
    1407,
    1.95,
  );
  const radarPathMain = buildScoreSketchPolygon(
    radarPoints.map(({ x, y }) => ({ x, y })),
    1459,
    1.08,
  );
  const hoveredAxis = axisPoints.find((axis) => axis.key === hoveredMetricKey) ?? null;
  // Direction must be decided from the same point the hint is actually anchored to (outerX/outerY,
  // used below in the `left`/`top` style) — deciding from labelX/labelY instead (a different point,
  // offset by the axis-label's own margin correction) let the two disagree near quadrant boundaries
  // and push the hint off the card's edge.
  //
  // Horizontal and vertical are each resolved independently (not as an either-or chain) — the
  // previous version checked vertical first and only fell through to a horizontal check when the
  // point was vertically near-center, so a point that was clearly *both* near the top *and* near
  // the right edge (a real axis position on a hexagon, not a corner case) only ever got the "near
  // top" treatment: centered horizontally, ignoring that it was also hard against the right edge.
  // In a wide floating panel that's harmless slack; in the drawer's narrow column it ran the hint
  // straight off the card. Each axis now gets both corrections it actually needs.
  const scoreHintOffsetX =
    hoveredAxis && hoveredAxis.outerX > center + 18
      ? '-100%'
      : hoveredAxis && hoveredAxis.outerX < center - 18
        ? '0%'
        : '-50%';
  const scoreHintOffsetY =
    hoveredAxis && hoveredAxis.outerY < center - 18
      ? '0.9rem'
      : hoveredAxis && hoveredAxis.outerY > center + 18
        ? '-115%'
        : '-55%';
  const scoreHintTransform = hoveredAxis ? `translate(${scoreHintOffsetX}, ${scoreHintOffsetY})` : '';

  // Belt-and-suspenders on top of the anchor logic above: in a container about as narrow as the
  // hint itself (the drawer case), edge-aligning to avoid overflowing *one* side can still overflow
  // the *other* — there's no anchor choice that fits a same-width box entirely inside a same-width
  // container. Rather than trying to out-guess every container this card might render in from pure
  // hexagon geometry, measure the hint against this card's own actual rendered bounds after each
  // hover and nudge it back in — cheap (only runs while a hint is actually showing) and correct
  // regardless of which context this card is mounted in.
  useEffect(() => {
    // Keyed on the metric *key* (a stable primitive), not hoveredAxis itself — axisPoints (and so
    // hoveredAxis) is rebuilt fresh every render, so depending on the object directly meant this
    // effect re-ran on every render, not just when the hovered axis actually changed. Each rerun
    // re-measured a rect that already included the previous run's own clamp correction and set a
    // fresh one on top without ever settling, which is how a plain few-pixel overflow correction
    // ran away to a many-thousand-pixel offset in testing instead of converging.
    if (!hoveredMetricKey || !hintRef.current || !cardRef.current) {
      setHintClamp({ x: 0, y: 0 });
      setHintMaxWidth(null);
      return;
    }

    const cardRect = cardRef.current.getBoundingClientRect();
    // Cap the box's own width to what the card can actually hold *before* measuring for the x/y
    // nudge below — found by testing, not by inspection: capping only the position (no width
    // change) fixed whichever edge the box happened to overflow at that moment, but a box wider
    // than the card minus both margins has no position that avoids overflowing the *other* edge
    // instead, so on a first pass that only ever overflowed left it "corrected" itself so far
    // right that it now overflowed right instead — genuinely worse than doing nothing, not just
    // insufficient. Applied imperatively first so the immediate remeasure below already reflects
    // it; setHintMaxWidth is what keeps it applied on the next real render.
    const maxWidth = Math.max(120, cardRect.width - SCORE_HINT_EDGE_MARGIN_PX * 2);
    hintRef.current.style.maxWidth = `${maxWidth}px`;

    const hintRect = hintRef.current.getBoundingClientRect();
    let x = 0;
    let y = 0;

    if (hintRect.right > cardRect.right - SCORE_HINT_EDGE_MARGIN_PX) {
      x = cardRect.right - SCORE_HINT_EDGE_MARGIN_PX - hintRect.right;
    } else if (hintRect.left < cardRect.left + SCORE_HINT_EDGE_MARGIN_PX) {
      x = cardRect.left + SCORE_HINT_EDGE_MARGIN_PX - hintRect.left;
    }

    if (hintRect.bottom > cardRect.bottom - SCORE_HINT_EDGE_MARGIN_PX) {
      y = cardRect.bottom - SCORE_HINT_EDGE_MARGIN_PX - hintRect.bottom;
    } else if (hintRect.top < cardRect.top + SCORE_HINT_EDGE_MARGIN_PX) {
      y = cardRect.top + SCORE_HINT_EDGE_MARGIN_PX - hintRect.top;
    }

    setHintMaxWidth(maxWidth);
    setHintClamp((current) => (current.x === x && current.y === y ? current : { x, y }));
  }, [hoveredMetricKey]);

  return (
    <aside ref={cardRef} className={className} onPointerDown={onPointerDown} aria-label={text.heatmapChartAria}>
      <div className="score-chart-wrap">
        <svg className="score-chart" viewBox="0 0 208 208" role="img" aria-label={text.scoreChartAria}>
          <g className="score-grid">
            {ringPaths.map((ring) => {
              return (
                <g key={ring.key}>
                  <path d={ring.soft} className="score-grid-ring-soft" />
                  <path d={ring.main} className="score-grid-ring" />
                </g>
              );
            })}

            {axisSketches.map((axis) => (
              <g key={`axis-${axis.key}`}>
                <path className="score-grid-axis-soft" d={axis.soft} />
                <path className="score-grid-axis" d={axis.main} />
              </g>
            ))}
          </g>

          <path className="score-shape-soft" d={radarPathSoft} />
          <path className="score-shape-main" d={radarPathMain} />
          <path className="score-shape-ghost" d={radarPathSoft} />

          {radarPoints.map((axis, index) => {
            return (
              <g key={`point-${axis.key}`} transform={`translate(${format(axis.x)} ${format(axis.y)})`}>
                <path className="score-point-soft" d={buildLoopPath(3.15, 1701 + index * 37)} />
                <path className="score-point-main" d={buildLoopPath(2.42, 1759 + index * 37)} />
                <circle className="score-point-core" cx="0" cy="0" r="1.3" />
                <circle
                  className="score-point-hit"
                  cx="0"
                  cy="0"
                  r="10"
                  onPointerEnter={() => setHoveredMetricKey(axis.key)}
                  onPointerLeave={() => setHoveredMetricKey((current) => (current === axis.key ? null : current))}
                />
              </g>
            );
          })}

          <text className="score-center-value" x={center} y={center + 4} textAnchor="middle">
            {scorecard.overall}
          </text>

          {axisPoints.map((axis) => (
            <text
              key={`label-${axis.key}`}
              className="score-axis-label"
              x={axis.labelX}
              y={axis.labelY}
              textAnchor={
                Math.abs(axis.labelX - center) < 8 ? 'middle' : axis.labelX > center ? 'start' : 'end'
              }
            >
              {axis.label}
            </text>
          ))}
        </svg>

        {hoveredAxis ? (
          <div
            ref={hintRef}
            className="score-hint"
            style={{
              left: `${(hoveredAxis.outerX / 208) * 100}%`,
              top: `${(hoveredAxis.outerY / 208) * 100}%`,
              // The clamp effect's correction is a second, independent translate rather than
              // folded into scoreHintTransform's own percentages — CSS applies space-separated
              // transform functions in sequence, so this nudges the *already-anchored* box by a
              // flat pixel amount instead of fighting over the same translate() call.
              transform: `${scoreHintTransform} translate(${hintClamp.x}px, ${hintClamp.y}px)`,
              ...(hintMaxWidth != null ? { maxWidth: `${hintMaxWidth}px` } : null),
            }}
          >
            <strong className="score-hint__title">
              {hoveredAxis.label} {hoveredAxis.value}
              {language === 'en' ? ` ${text.scorePointUnit}` : text.scorePointUnit}
            </strong>
            <p className="score-hint__body">{scorecard.explanations?.[hoveredAxis.key]}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
