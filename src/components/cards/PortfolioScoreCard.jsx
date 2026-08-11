import { useState } from 'react';
import { format } from '../../utils/math.js';
import { textFor } from '../../utils/format.js';
import { buildScoreSketchPolygon, buildScoreAxisPath, buildLoopPath } from '../../utils/scene.js';

export function PortfolioScoreCard({
  scorecard,
  axes,
  language,
  className = 'score-panel',
  onPointerDown,
}) {
  const [hoveredMetricKey, setHoveredMetricKey] = useState(null);
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
  const scoreHintTransform = hoveredAxis
    ? hoveredAxis.outerY < center - 18
      ? 'translate(-50%, 0.9rem)'
      : hoveredAxis.outerY > center + 18
        ? 'translate(-50%, -115%)'
        : hoveredAxis.outerX > center + 18
          ? 'translate(-100%, -55%)'
          : hoveredAxis.outerX < center - 18
            ? 'translate(0, -55%)'
            : 'translate(-50%, -115%)'
    : '';

  return (
    <aside className={className} onPointerDown={onPointerDown} aria-label={text.heatmapChartAria}>
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
            className="score-hint"
            style={{
              left: `${(hoveredAxis.outerX / 208) * 100}%`,
              top: `${(hoveredAxis.outerY / 208) * 100}%`,
              transform: scoreHintTransform,
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
