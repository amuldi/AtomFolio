import * as THREE from 'three';
import { noise, jitter, clamp, format } from '../../utils/math.js';
import { compactLabel } from '../../utils/format.js';
import {
  buildBondPath,
  buildLoopPath,
  generateAtomLayout,
  CENTER_BLOTS,
  CENTER_SPIN_LOOPS,
  DUST,
} from '../../utils/scene.js';

export function SketchAtom({
  atom,
  phase,
  inkBoost = 1,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onKeyboardSelect,
}) {
  // inkBoost mirrors --atom-ink-alpha-boost from styles.css (1 dark / 2.4 light): these path/node
  // opacities are plain SVG attributes, not part of the .stroke-*/.node-* rgba() color, so the
  // CSS-side boost never reached them on its own — a light-mode stroke color of near-opaque black
  // still rendered nearly invisible once one of these ~0.3-0.8 JS opacities was layered on top of
  // it. Applying the same boost here keeps the two systems in sync instead of only half-fixing it.
  const softOpacity = 0.1 + atom.depth * 0.19 + atom.hoverMix * 0.07;
  const shadowOpacity = 0.18 + atom.depth * 0.3 + atom.hoverMix * 0.08;
  const mainOpacity = 0.3 + atom.depth * 0.48 + atom.hoverMix * 0.08;
  const scale = atom.scale * (0.86 + atom.depth * 0.1);
  const nodeScale =
    scale *
    ((atom.isSelected ? 0.92 : atom.isGroupMatch ? 0.91 : 0.9) +
      atom.hoverMix * 0.055 +
      atom.dragMix * 0.085);
  const nodeRotation =
    atom.nodeTilt + atom.position.z * 0.045 + Math.sin(phase + atom.seed) * 1.4;
  const lineLayers = [
    buildBondPath(atom, 0, phase),
    buildBondPath(atom, 1, phase),
    buildBondPath(atom, 2, phase),
  ];
  const dimFactor = atom.dimmed ? 0.18 : 1;
  const focusBoost = atom.isSelected ? 1.08 : atom.isGroupMatch ? 1.04 : 1;

  return (
    <>
      <path
        className="stroke-soft"
        d={lineLayers[2]}
        opacity={Math.min(1, softOpacity * dimFactor * focusBoost * inkBoost)}
        strokeWidth={0.88 + scale * 0.3}
      />
      <path
        className="stroke-shadow"
        d={lineLayers[1]}
        opacity={Math.min(1, shadowOpacity * dimFactor * focusBoost * inkBoost)}
        strokeWidth={1.3 + scale * 0.58}
      />
      <path
        className="stroke-main"
        d={lineLayers[0]}
        opacity={Math.min(1, mainOpacity * dimFactor * focusBoost * inkBoost)}
        strokeWidth={0.98 + scale * 0.46}
      />

      <g
        className="node-shell"
        transform={`translate(${format(atom.x)} ${format(atom.y)}) rotate(${format(
          nodeRotation,
        )}) scale(${format(nodeScale)})`}
      >
        <path
          className="node-soft"
          d={atom.nodePaths[0]}
          opacity={Math.min(
            1,
            (0.3 + atom.depth * 0.26 + atom.hoverMix * 0.12) * dimFactor * focusBoost * inkBoost,
          )}
          strokeWidth={1.08}
        />
        <path
          className="node-main"
          d={atom.nodePaths[1]}
          opacity={Math.min(
            1,
            (0.48 + atom.depth * 0.38 + atom.hoverMix * 0.08) * dimFactor * focusBoost * inkBoost,
          )}
          strokeWidth={1.24}
        />
        <circle
          className="node-hit"
          cx="0"
          cy="0"
          r={atom.node * 2.85}
          role="button"
          tabIndex={0}
          aria-label={atom.detail ? `${atom.label} ${atom.detail}` : atom.label}
          aria-pressed={atom.isSelected ? 'true' : 'false'}
          onPointerDown={onPointerDown}
          onPointerEnter={onPointerEnter}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            onKeyboardSelect?.(event);
          }}
        />
      </g>
    </>
  );
}

export function SketchAura({ atom, phase, inkBoost = 1 }) {
  const dimFactor = atom.dimmed ? 0.12 : 1;
  const focusBoost = atom.isSelected ? 1.18 : atom.isGroupMatch ? 1.08 : 1;

  return (
    <path
      className="aura-line"
      d={buildBondPath(atom, 0, phase)}
      opacity={Math.min(
        0.22,
        (0.03 + atom.depth * 0.04 + atom.dragMix * 0.05) * dimFactor * focusBoost * inkBoost,
      )}
      strokeWidth={5.4 + atom.scale * 2.5}
    />
  );
}

export function AtomLabel({ atom, inkBoost = 1 }) {
  const length = Math.hypot(atom.x, atom.y) || 1;
  const direction = {
    x: atom.x / length,
    y: atom.y / length,
  };
  const anchor =
    direction.x > 0.24 ? 'start' : direction.x < -0.24 ? 'end' : 'middle';
  const baseX = direction.x > 0.24 ? 10 : direction.x < -0.24 ? -10 : 0;
  const noteX = atom.x + direction.x * atom.labelOffset;
  const noteY = atom.y + direction.y * atom.labelOffset + jitter(atom.seed + 601, 4);
  const opacity = Math.min(
    1,
    (0.48 + atom.depth * 0.32 + atom.hoverMix * 0.08) *
      (atom.dimmed ? 0.24 : atom.isSelected ? 1.06 : atom.isGroupMatch ? 1.03 : 1) *
      inkBoost,
  );

  return (
    <g
      className="label-note"
      transform={`translate(${format(noteX)} ${format(noteY)}) rotate(${format(
        atom.labelTilt + direction.x * 4,
      )})`}
      opacity={opacity}
    >
      <text className="label-main" textAnchor={anchor} x={baseX} y="-2">
        {atom.label}
      </text>
      {atom.detail ? (
        <text className="label-detail" textAnchor={anchor} x={baseX} y="13">
          {atom.detail}
        </text>
      ) : null}
    </g>
  );
}

export function PortfolioPreviewAtom({ entry, slot, onSelect, inkBoost = 1 }) {
  const atoms = generateAtomLayout(entry.items).slice(0, 9);
  const previewNodes = atoms.map((atom, index) => {
    const direction = new THREE.Vector3(...atom.direction).normalize();
    const radius = 34 + direction.z * 12 + noise(atom.seed + 71) * 9;
    const x = direction.x * radius;
    const y = direction.y * radius;
    const depth = clamp((direction.z + 1) * 0.5, 0, 1);
    const loopOuter = buildLoopPath(6.6 + depth * 2.5 + index * 0.12, atom.seed + 1100);
    const loopMid = buildLoopPath(5.4 + depth * 1.9 + index * 0.1, atom.seed + 1146);
    const loopInner = buildLoopPath(4.1 + depth * 1.5 + index * 0.08, atom.seed + 1180);
    const label = compactLabel(entry.fileName.replace(/\.[^.]+$/, ''), 16);

    return {
      id: atom.id,
      x,
      y,
      depth,
      seed: atom.seed,
      outer: loopOuter,
      mid: loopMid,
      inner: loopInner,
      label,
    };
  });

  return (
    <button
      type="button"
      className="portfolio-preview"
      onClick={() => onSelect?.(entry.id)}
      style={{
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        transform: `translate3d(-50%, -50%, ${slot.z ?? -180}px) scale(${slot.scale}) rotate(${slot.rotation}deg)`,
        '--preview-z': `${slot.z ?? -180}px`,
        '--preview-scale': `${slot.scale}`,
        '--preview-blur': `${slot.blur ?? 0.3}px`,
        '--preview-opacity': `${slot.opacity ?? 0.78}`,
        '--preview-shadow': `${slot.shadow ?? 10}px`,
        '--preview-twinkle-delay': slot.delay ?? '0s',
        '--preview-twinkle-duration': slot.duration ?? '6.8s',
        '--preview-shift-x': `${(0.5 - slot.x) * 420}px`,
        '--preview-shift-y': `${(0.5 - slot.y) * 420}px`,
        '--preview-rotate-from': `${slot.rotation}deg`,
        '--preview-rotate-to': `${slot.rotation * 0.18}deg`,
        '--preview-focus-scale': `${slot.scale * 4.15}`,
        '--preview-focus-z': `${clamp(Math.abs(slot.z ?? -180) * 0.28, 116, 228)}px`,
      }}
      aria-label={entry.fileName}
    >
      <svg className="portfolio-preview__svg" viewBox="-80 -80 160 160" aria-hidden="true">
        <g className="portfolio-preview__core">
          {previewNodes.map((node, index) => {
            const curve = 5 + jitter(node.seed + 33, 8) + (0.5 - node.depth) * 12;
            const midX = node.x * 0.48 + curve * 0.18;
            const midY = node.y * 0.48 - curve * 0.22;
            const midXTwo = node.x * 0.76 - curve * 0.1;
            const midYTwo = node.y * 0.76 + curve * 0.14;
            const path = `M ${format(jitter(node.seed + 41, 1.8))} ${format(
              jitter(node.seed + 57, 1.8),
            )} C ${format(midX)} ${format(midY)} ${format(midXTwo)} ${format(midYTwo)} ${format(
              node.x,
            )} ${format(node.y)}`;

            return (
              <g key={node.id} opacity={Math.min(1, (0.46 + node.depth * 0.38 + index * 0.02) * inkBoost)}>
                <path className="portfolio-preview__bond-ghost" d={path} />
                <path className="portfolio-preview__bond-soft" d={path} />
                <path className="portfolio-preview__bond-main" d={path} />
                <g transform={`translate(${format(node.x)} ${format(node.y)}) rotate(${format(jitter(node.seed + 88, 18))})`}>
                  <path className="portfolio-preview__node-soft" d={node.outer} />
                  <path className="portfolio-preview__node-mid" d={node.mid} />
                  <path className="portfolio-preview__node-main" d={node.inner} />
                </g>
              </g>
            );
          })}

          <g transform={`rotate(${format(slot.rotation * 0.8)})`}>
            <path
              className="portfolio-preview__orbit"
              d={buildLoopPath(14.8, 2101 + slot.rotation)}
              opacity="0.46"
            />
            <path
              className="portfolio-preview__orbit"
              d={buildLoopPath(11.4, 2197 + slot.rotation)}
              opacity="0.34"
              transform="scale(0.92 0.78) rotate(18)"
            />
            {CENTER_BLOTS.map((path, index) => (
              <path
                key={`preview-blot-${index}`}
                className="portfolio-preview__center"
                d={path}
                opacity={0.5 + index * 0.12}
              />
            ))}
            {DUST.slice(0, 6).map((dot, index) => (
              <circle
                key={`preview-dust-${index}`}
                className="portfolio-preview__dust"
                cx={dot.x * 0.82}
                cy={dot.y * 0.82}
                r={dot.r * 0.92}
                opacity={0.22 + index * 0.05}
              />
            ))}
          </g>
        </g>
      </svg>
      <span className="portfolio-preview__label">{previewNodes[0]?.label ?? entry.fileName}</span>
    </button>
  );
}

export function AtomSketch({
  atoms,
  pulse,
  centerMotion,
  centerClickBurst,
  standalone,
  svgRef,
  ariaLabel,
  highlightActive,
  inkBoost = 1,
  onCenterClick,
  onCenterPointerDown,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onKeyboardSelect,
}) {
  const phase = pulse * Math.PI * 2;
  const backAtoms = atoms
    .filter((atom) => atom.position.z < 0)
    .sort((left, right) => left.position.z - right.position.z);
  const frontAtoms = atoms
    .filter((atom) => atom.position.z >= 0)
    .sort((left, right) => left.position.z - right.position.z);
  const centerGlowDrift = standalone ? (Math.sin(centerMotion * 0.56 - 0.6) * 0.5 + 0.5) : 0;
  const centerBlinkWave = standalone ? (Math.sin(centerMotion * 1.74 - 0.85) * 0.5 + 0.5) : 0;
  const centerScale = standalone
    ? 1.4 + centerClickBurst * 0.22
    : 0.985 + Math.sin(phase * 0.5) * 0.012;
  const centerBlink = standalone
    ? 0.34 + centerBlinkWave * 0.88 + centerClickBurst * 0.2
    : 1;
  const centerAuraOpacity = standalone ? 0.04 + centerBlink * 0.92 : 0;
  const centerCoreOpacity = standalone ? 0.08 + centerBlink * 0.72 : 0;
  const centerHighlightOpacity = standalone ? 0.06 + centerBlink * 0.62 : 0;
  const centerAuraScale = standalone
    ? 1 + centerClickBurst * 0.24 + centerGlowDrift * 0.04 + centerBlinkWave * 0.015
    : 1;
  const centerCoreScale = standalone ? 1 + centerClickBurst * 0.1 + centerGlowDrift * 0.02 : 1;

  return (
    <svg
      ref={svgRef}
      className="sketch-svg"
      viewBox="-320 -320 640 640"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <filter id="smudge" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="0.52" />
        </filter>
        <filter id="glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="4.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="aura-layer" filter="url(#glow)">
        {standalone ? (
          <g
            className="center-aura"
            opacity={centerAuraOpacity}
            transform={`scale(${format(centerAuraScale)} ${format(
              0.95 + centerClickBurst * 0.08 + centerGlowDrift * 0.04 + centerBlinkWave * 0.02,
            )})`}
          >
            <ellipse
              className="center-glow-outer"
              cx="0"
              cy="0"
              rx="31"
              ry="24"
              transform="rotate(-18)"
            />
            <ellipse
              className="center-glow-mid"
              cx="3"
              cy="-2"
              rx="22"
              ry="17"
              transform="rotate(11)"
              opacity="0.92"
            />
            <ellipse
              className="center-glow-core"
              cx="-4"
              cy="-7"
              rx="9"
              ry="6"
              transform="rotate(-24)"
              opacity={centerHighlightOpacity}
            />
          </g>
        ) : null}

        {backAtoms.map((atom) => (
          <SketchAura key={`back-aura-${atom.id}`} atom={atom} phase={phase} inkBoost={inkBoost} />
        ))}
        {frontAtoms.map((atom) => (
          <SketchAura key={`front-aura-${atom.id}`} atom={atom} phase={phase} inkBoost={inkBoost} />
        ))}
      </g>

      <g className="sketch-core" filter="url(#smudge)">
        {backAtoms.map((atom) => (
          <SketchAtom
            key={`back-${atom.id}`}
            atom={atom}
            phase={phase}
            inkBoost={inkBoost}
            onPointerDown={(event) => onPointerDown(atom.id, event)}
            onPointerEnter={(event) => onPointerEnter(atom.id, event)}
            onPointerMove={(event) => onPointerMove(atom.id, event)}
            onPointerLeave={() => onPointerLeave(atom.id)}
            onKeyboardSelect={(event) => onKeyboardSelect?.(atom.id, event)}
          />
        ))}

        <g
          transform={`rotate(-12) scale(${format(centerScale * centerCoreScale)} ${format(
            centerScale * (0.98 + centerClickBurst * 0.04 + centerGlowDrift * 0.02),
          )})`}
        >
          {standalone ? (
            <g opacity={centerCoreOpacity}>
              <ellipse
                className="center-shell-shadow"
                cx="1"
                cy="2"
                rx="14.8"
                ry="12.3"
                transform="rotate(9)"
              />
              <ellipse
                className="center-shell-rim"
                cx="-1"
                cy="-1"
                rx="13.2"
                ry="10.9"
                transform="rotate(-13)"
              />
              <ellipse
                className="center-shell-highlight"
                cx="-5"
                cy="-7"
                rx="5.8"
                ry="4.1"
                transform="rotate(-26)"
                opacity={centerHighlightOpacity}
              />
            </g>
          ) : null}

          {standalone ? (
            <g
              opacity={0.08 + centerBlink * 0.68}
              transform={`scale(${format(1 + centerClickBurst * 0.06)} ${format(
                1.01 + centerClickBurst * 0.03 + centerGlowDrift * 0.02,
              )})`}
            >
              <path
                className="center-orbit"
                d={CENTER_SPIN_LOOPS[0]}
                transform="rotate(8) scale(0.72 1.06)"
              />
              <path
                className="center-orbit"
                d={CENTER_SPIN_LOOPS[1]}
                transform="rotate(-21) scale(1.08 0.52)"
                opacity="0.78"
              />
            </g>
          ) : null}

          <g transform={standalone ? `scale(${format(1 + centerClickBurst * 0.05)})` : undefined}>
            {CENTER_BLOTS.map((path, index) => (
              <path
                key={`blot-${index}`}
                className="center-blot"
                d={path}
                opacity={
                  (standalone
                    ? 0.46 + centerBlink * 0.78 + index * 0.02
                    : highlightActive
                      ? 0.86 + pulse * 0.08 + index * 0.015
                      : 0.68 + pulse * 0.08) * centerBlink
                }
              />
            ))}

            {DUST.map((dot, index) => (
              <circle
                key={`dust-${index}`}
                className="graphite-dust"
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                opacity={(dot.opacity + pulse * 0.04) * (standalone ? 0.34 + centerBlink * 1.18 : 1)}
              />
            ))}
          </g>

          {onCenterClick ? (
            <circle
              className="center-hit"
              cx="0"
              cy="0"
              r={standalone ? 60 : 56}
              onPointerDown={(event) => {
                // Optional escape hatch (unused by the web app — App.jsx never passes this prop,
                // so onCenterPointerDown?.(event) is always undefined there and this always falls
                // through to the capture/stopPropagation behavior below, unchanged). Returning
                // exactly `false` opts out of that default entirely and lets the event keep
                // bubbling — see desktop/src/renderer/atom-view.jsx's handleCenterPointerDown for
                // why: a ⌘-held pointerdown on the center needs to reach .atom-visual-stage's own
                // handler to start a window-move drag, the same as it already does for individual
                // node hits.
                if (onCenterPointerDown?.(event) === false) {
                  return;
                }
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onCenterClick?.();
              }}
            />
          ) : null}
        </g>

        {frontAtoms.map((atom) => (
          <SketchAtom
            key={`front-${atom.id}`}
            atom={atom}
            phase={phase}
            inkBoost={inkBoost}
            onPointerDown={(event) => onPointerDown(atom.id, event)}
            onPointerEnter={(event) => onPointerEnter(atom.id, event)}
            onPointerMove={(event) => onPointerMove(atom.id, event)}
            onPointerLeave={() => onPointerLeave(atom.id)}
            onKeyboardSelect={(event) => onKeyboardSelect?.(atom.id, event)}
          />
        ))}
      </g>

      <g className="label-layer">
        {atoms.map((atom) => (
          <AtomLabel key={`label-${atom.id}`} atom={atom} inkBoost={inkBoost} />
        ))}
      </g>
    </svg>
  );
}
