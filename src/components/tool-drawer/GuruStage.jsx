// While the 유명인 tab is open, the main stage shows the selected investor instead of my atom —
// drawn with the very same AtomSketch / generateAtomLayout / projectPoint the main view uses, so
// it looks exactly like the app's own atom. 비교하기 slides it right, eases my atom in on the left
// and joins every holding the two share with a bond that light keeps flowing along.
//
// Both atoms can be grabbed and turned (drag, with a little inertia, like the main atom); an
// electron can still be clicked, because a press that never moves counts as a click. Hovering an
// electron reports it to the panel, which shows the stock's quick card.
//
// Rendered through a portal over .stage-frame (whose own atom and name tag fade out via
// html.guru-stage-on); unmounting this restores the normal stage. The name tag is placed from the
// same measured rectangle, so it hangs above the atom exactly as it does on my own account.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { AtomSketch } from '../atom/index.jsx';
import { createAtomState, generateAtomLayout, projectPoint } from '../../utils/scene.js';
import { BOND_LENGTH, DEFAULT_SCENE_CAMERA } from '../../constants/scene.js';

// About one turn every two and a half minutes: slow enough to read labels as they pass.
const SPIN_RADIANS_PER_SECOND = 0.042;
const DRAG_RADIANS_PER_PIXEL = 0.0072;
const INERTIA_DECAY = 3.2; // per second
const MAX_INERTIA = 3; // radians per second
const CLICK_SLOP_PX = 6;
const COMPARE_SCALE = 0.56;
const COMPARE_SHIFT = 0.25; // fraction of the stage width each atom moves off center
const BONDS_START_MS = 1150; // after both atoms have settled

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

function buildAtoms(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return generateAtomLayout(items, {
    weightFor: (item) => item.weight,
    returnFor: (item) => item.returnRate,
  }).map((atom) => {
    const item = byId.get(atom.sourceItemId);
    // Only an investor's top holdings are drawn; their labels keep the share of the *whole*
    // filing (31.5%), not the share among the drawn electrons (which would read 40%).
    const withShare = Number.isFinite(item?.share) ? { ...atom, weightShare: item.share } : atom;
    return createAtomState(
      item?.labelExtra ? { ...withShare, labelExtra: item.labelExtra } : withShare,
    );
  });
}

function project(baseAtoms, rotation, highlighted, selectedTicker, hoverKey, hoverMixes, side) {
  return baseAtoms.map((atom) => {
    const position = atom.baseDirection
      .clone()
      .applyQuaternion(rotation)
      .multiplyScalar(BOND_LENGTH);
    const projection = projectPoint(position, DEFAULT_SCENE_CAMERA);
    // Ease the hover emphasis in and out instead of snapping it.
    const mixKey = `${side}:${atom.id}`;
    const target = hoverKey === mixKey ? 1 : 0;
    const previous = hoverMixes.get(mixKey) ?? 0;
    const mix = Math.abs(target - previous) < 0.01 ? target : previous + (target - previous) * 0.22;
    if (mix === 0) hoverMixes.delete(mixKey);
    else hoverMixes.set(mixKey, mix);
    return {
      ...atom,
      ...projection,
      position,
      isSelected: Boolean(selectedTicker && atom.ticker === selectedTicker),
      isGroupMatch: Boolean(highlighted?.has(atom.ticker)),
      dimmed: false,
      hoverMix: mix,
      dragMix: 0,
      dragging: false,
    };
  });
}

// SVG units (viewBox -320…320) of an atom inside a layer → 0…1000 overlay units, given the
// layer's own scale and horizontal shift.
const toOverlay = (atom, scale, shift) => ({
  x: 500 + (atom.x / 640) * 1000 * scale + shift * 1000,
  y: 500 + (atom.y / 640) * 1000 * scale,
});

function bondCurve(from, to, seed) {
  const control = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 22 - (seed % 5) * 7 };
  return {
    from,
    to,
    control,
    d: `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
  };
}

const pointOnCurve = ({ from, control, to }, t) => ({
  x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
  y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
});

function Sketch({
  atoms,
  pulse,
  burstKey,
  ariaLabel,
  side,
  onCenterClick,
  onAtomPointerDown,
  onAtomHover,
  onAtomLeave,
}) {
  return (
    <AtomSketch
      atoms={atoms}
      pulse={pulse}
      centerMotion={0}
      centerClickBurst={0}
      standalone={false}
      ariaLabel={ariaLabel}
      maxLabelLength={16}
      highlightActive={false}
      burstKey={burstKey}
      onCenterClick={onCenterClick}
      onPointerDown={onAtomPointerDown}
      onPointerEnter={(atomId, event) => onAtomHover(side, atomId, event)}
      onPointerMove={(atomId, event) => onAtomHover(side, atomId, event)}
      onPointerLeave={onAtomLeave}
      onKeyboardSelect={(atomId, event) => onAtomPointerDown(atomId, event, true)}
    />
  );
}

export function GuruStage({
  guruItems,
  myItems,
  captions,
  mode,
  sharedTickers,
  selectedTicker,
  hovered,
  burstKey,
  tag,
  ariaLabel,
  onCenterClick,
  onSelectAtom,
  onHoverAtom,
}) {
  const [rect, setRect] = useState(null);
  const [frame, setFrame] = useState(0);
  const guruRotation = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, 0.4, -0.08)),
  );
  const myRotation = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, -0.6, 0.06)));
  const spin = useRef({ guru: { x: 0, y: 0 }, mine: { x: 0, y: 0 } }); // inertia, radians per second
  const dragRef = useRef(null);
  const hoverMixes = useRef(new Map());
  const timeRef = useRef(0);
  const compareStartRef = useRef(null);
  const atomsRef = useRef({ guru: [], mine: [] });
  const callbacksRef = useRef({});
  callbacksRef.current = { onSelectAtom, onHoverAtom };

  // Hide my own atom and name tag while this stage owns the screen.
  useEffect(() => {
    document.documentElement.classList.add('guru-stage-on');
    return () => document.documentElement.classList.remove('guru-stage-on');
  }, []);

  // Follow .stage-frame (it resizes and shifts with the drawer) and keep the atoms turning.
  useEffect(() => {
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    let lastRectKey = '';
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const turn = new THREE.Quaternion();
    const step = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      timeRef.current = now;
      const frameEl = document.querySelector('.stage-frame');
      if (frameEl) {
        const box = frameEl.getBoundingClientRect();
        const key = `${Math.round(box.left)}|${Math.round(box.top)}|${Math.round(box.width)}`;
        if (key !== lastRectKey) {
          lastRectKey = key;
          setRect({ left: box.left, top: box.top, size: box.width });
        }
      }
      const wobble = reduced ? 0 : Math.sin(now * 0.0001) * delta * 0.012;
      for (const [side, ref, direction] of [
        ['guru', guruRotation, 1],
        ['mine', myRotation, -1],
      ]) {
        if (dragRef.current?.side === side) continue; // the hand is turning this one
        const momentum = spin.current[side];
        const idle = reduced ? 0 : SPIN_RADIANS_PER_SECOND * direction;
        ref.current
          .premultiply(turn.setFromAxisAngle(yAxis, delta * (idle + momentum.y)))
          .premultiply(turn.setFromAxisAngle(xAxis, wobble + delta * momentum.x));
        const decay = Math.exp(-INERTIA_DECAY * delta);
        momentum.x *= decay;
        momentum.y *= decay;
      }
      setFrame((value) => (value + 1) % 1_000_000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const guruBase = useMemo(() => buildAtoms(guruItems), [guruItems]);
  const myBase = useMemo(() => buildAtoms(myItems ?? []), [myItems]);
  const comparing = mode !== 'preview' && myBase.length > 0;
  if (comparing && compareStartRef.current == null) compareStartRef.current = performance.now();
  if (!comparing) compareStartRef.current = null;
  const highlight = comparing ? sharedTickers : null;
  // frame is read so each animation tick re-projects the turning atoms.
  void frame;
  const hoverKey = hovered ? `${hovered.side}:${hovered.atomId}` : null;
  const guruAtoms = project(
    guruBase,
    guruRotation.current,
    highlight,
    selectedTicker,
    hoverKey,
    hoverMixes.current,
    'guru',
  );
  const myAtoms = comparing
    ? project(
        myBase,
        myRotation.current,
        highlight,
        selectedTicker,
        hoverKey,
        hoverMixes.current,
        'mine',
      )
    : [];
  atomsRef.current = { guru: guruAtoms, mine: myAtoms };
  const now = timeRef.current || performance.now();
  const pulse = 0.5 + Math.sin(now * 0.00042) * 0.5;
  const sinceCompare = compareStartRef.current == null ? 0 : now - compareStartRef.current;
  const bondsLive = comparing && (prefersReducedMotion() || sinceCompare > BONDS_START_MS);

  const bonds = bondsLive
    ? [...(sharedTickers ?? [])]
        .map((ticker, index) => {
          const theirs = guruAtoms.find((atom) => atom.ticker === ticker);
          const mine = myAtoms.find((atom) => atom.ticker === ticker);
          if (!theirs || !mine) return null;
          const curve = bondCurve(
            toOverlay(mine, COMPARE_SCALE, -COMPARE_SHIFT),
            toOverlay(theirs, COMPARE_SCALE, COMPARE_SHIFT),
            index,
          );
          // Two sparks per bond, travelling from my electron to theirs.
          const sparks = [0, 0.5].map((offset) =>
            pointOnCurve(curve, (((now / 2600 + index * 0.13 + offset) % 1) + 1) % 1),
          );
          return { ticker, index, curve, sparks };
        })
        .filter(Boolean)
    : [];

  const describe = (side, atom, event) => ({
    side,
    atomId: atom.id,
    ticker: atom.ticker,
    label: atom.label,
    x: event?.clientX ?? 0,
    y: event?.clientY ?? 0,
  });

  // A press on an electron or on empty space starts a turn; if it never moves it was a click.
  const beginDrag = (side, atomId, event, fromKeyboard = false) => {
    event?.stopPropagation?.();
    if (fromKeyboard) {
      const atom = atomsRef.current[side].find((candidate) => candidate.id === atomId);
      if (atom) callbacksRef.current.onSelectAtom?.(describe(side, atom, null));
      return;
    }
    if (event.button != null && event.button !== 0) return;
    // No focus ring on click (keyboard focus still shows one).
    event.preventDefault?.();
    callbacksRef.current.onHoverAtom?.(null);
    const drag = {
      side,
      atomId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      moved: false,
    };
    dragRef.current = drag;
    spin.current[side].x = 0;
    spin.current[side].y = 0;
    const rotation = side === 'guru' ? guruRotation : myRotation;
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const turn = new THREE.Quaternion();
    const move = (moveEvent) => {
      if (
        !drag.moved &&
        Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) > CLICK_SLOP_PX
      ) {
        drag.moved = true;
        document.documentElement.classList.add('guru-stage-dragging');
      }
      if (!drag.moved) return;
      const dx = moveEvent.clientX - drag.lastX;
      const dy = moveEvent.clientY - drag.lastY;
      const at = performance.now();
      const seconds = Math.max(0.008, (at - drag.lastAt) / 1000);
      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;
      drag.lastAt = at;
      const spinY = dx * DRAG_RADIANS_PER_PIXEL;
      const spinX = dy * DRAG_RADIANS_PER_PIXEL;
      rotation.current
        .premultiply(turn.setFromAxisAngle(yAxis, spinY))
        .premultiply(turn.setFromAxisAngle(xAxis, spinX))
        .normalize();
      const momentum = spin.current[side];
      const clampSpin = (value) => Math.max(-MAX_INERTIA, Math.min(MAX_INERTIA, value));
      momentum.y = momentum.y * 0.5 + clampSpin(spinY / seconds) * 0.5;
      momentum.x = momentum.x * 0.5 + clampSpin(spinX / seconds) * 0.5;
    };
    const finish = (upEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.documentElement.classList.remove('guru-stage-dragging');
      dragRef.current = null;
      // Released after a pause: it stays put instead of coasting.
      if (performance.now() - drag.lastAt > 120) {
        spin.current[side].x = 0;
        spin.current[side].y = 0;
      }
      if (!drag.moved && atomId != null && upEvent.type === 'pointerup') {
        const atom = atomsRef.current[side].find((candidate) => candidate.id === atomId);
        if (atom) callbacksRef.current.onSelectAtom?.(describe(side, atom, upEvent));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const handleHover = (side, atomId, event) => {
    if (dragRef.current) return;
    const atom = atomsRef.current[side].find((candidate) => candidate.id === atomId);
    if (atom) callbacksRef.current.onHoverAtom?.(describe(side, atom, event));
  };
  const handleLeave = () => callbacksRef.current.onHoverAtom?.(null);

  if (!rect) return null;

  return createPortal(
    <>
      <div
        className={`guru-stage is-${comparing ? 'compare' : 'single'}`}
        style={{ left: rect.left, top: rect.top, width: rect.size, height: rect.size }}
      >
        <div className="guru-stage__veil" />
        <div
          className="guru-stage__layer is-mine"
          onPointerDown={(event) => beginDrag('mine', null, event)}
        >
          {myAtoms.length ? (
            <Sketch
              atoms={myAtoms}
              side="mine"
              pulse={pulse}
              burstKey={0}
              ariaLabel={ariaLabel.mine}
              onAtomPointerDown={(atomId, event, keyboard) =>
                beginDrag('mine', atomId, event, keyboard)
              }
              onAtomHover={handleHover}
              onAtomLeave={handleLeave}
            />
          ) : null}
        </div>
        <div
          className="guru-stage__layer is-guru"
          onPointerDown={(event) => beginDrag('guru', null, event)}
        >
          <Sketch
            atoms={guruAtoms}
            side="guru"
            pulse={pulse}
            burstKey={burstKey}
            ariaLabel={ariaLabel.guru}
            onCenterClick={onCenterClick}
            onAtomPointerDown={(atomId, event, keyboard) =>
              beginDrag('guru', atomId, event, keyboard)
            }
            onAtomHover={handleHover}
            onAtomLeave={handleLeave}
          />
        </div>
        {comparing && captions ? (
          <>
            <span className="guru-stage__caption is-mine">{captions.mine}</span>
            <span className="guru-stage__caption is-guru">{captions.guru}</span>
          </>
        ) : null}
        {bonds.length ? (
          <svg className="guru-stage__bonds" viewBox="0 0 1000 1000" aria-hidden="true">
            <defs>
              <radialGradient id="guru-spark">
                <stop offset="0%" stopColor="rgb(255, 250, 238)" stopOpacity="1" />
                <stop offset="40%" stopColor="rgb(255, 246, 228)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="rgb(255, 240, 220)" stopOpacity="0" />
              </radialGradient>
            </defs>
            {bonds.map((bond) => (
              <g key={bond.ticker} className="guru-stage__bond" style={{ '--i': bond.index }}>
                <path className="guru-stage__bond-soft" d={bond.curve.d} pathLength="1" />
                <path className="guru-stage__bond-main" d={bond.curve.d} pathLength="1" />
                {[bond.curve.from, bond.curve.to].map((end, endIndex) => (
                  <circle
                    key={endIndex}
                    className="guru-stage__bond-end"
                    cx={end.x}
                    cy={end.y}
                    r="13"
                  />
                ))}
                {bond.sparks.map((spark, sparkIndex) => (
                  <circle
                    key={sparkIndex}
                    className="guru-stage__spark"
                    cx={spark.x}
                    cy={spark.y}
                    r="7"
                    fill="url(#guru-spark)"
                  />
                ))}
              </g>
            ))}
          </svg>
        ) : null}
      </div>
      {tag ? (
        // --tool-drawer-current-width lives on the app root, which this portal is outside of, so
        // the tag takes its x from the measured stage instead (.atom-tag's own formula would
        // otherwise fall back to the middle of the window).
        <div
          className="atom-tag guru-stage__tag"
          role="status"
          style={{ left: rect.left + rect.size / 2 }}
        >
          <span className="atom-tag__card">
            <svg
              className="atom-tag__frame"
              viewBox="0 0 200 60"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                className="atom-tag__frame-main"
                d="M9 4.5 C52 2.6 118 5.2 190.5 3.4 C196.8 4.1 197.6 9 197.1 15 C196.2 27 198.4 41 196.6 53.2 C195.4 57 191 57.4 184 56.6 C130 55.1 70 58.2 10.2 56.4 C4.4 56.2 2.6 52.6 3.1 46 C3.8 33 2.2 20 3.6 9.6 C4 6 6 4.6 9 4.5 Z"
              />
              <path
                className="atom-tag__frame-soft"
                d="M7.4 6.2 C60 4.1 130 7.4 192.2 5.1 C195.4 6.3 195.9 12 195.6 18 C194.8 30 196.7 44 195 54.4 C193.6 56.2 188 55.1 180 55.4 C120 57 62 54.6 8.6 55.1 C5.6 54.3 4.4 50 4.9 43 C5.6 30 4.1 18 5.2 10.8 C5.6 7.6 6 6.4 7.4 6.2"
              />
            </svg>
            <span className="atom-tag__line">
              <span className="atom-tag__total">{tag.title}</span>
              {tag.value != null ? (
                <span className={`atom-tag__return is-${tag.tone ?? 'flat'} guru-stage__count`}>
                  {tag.value}
                </span>
              ) : null}
            </span>
            {tag.note ? <span className="atom-tag__note">{tag.note}</span> : null}
          </span>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
