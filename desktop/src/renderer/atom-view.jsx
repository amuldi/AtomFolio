// Real atom visual, reused from the web app — not reimplemented. AtomSketch/generateAtomLayout/
// projectPoint/trackballVector are the actual components and math src/App.jsx uses, imported
// straight from src/ by relative path (the same cross-directory pattern
// desktop/src/lib/portfolioTotals.mjs already uses for the main process). Everything below this
// entry point that isn't imported — the rotation/drag state, the RAF loop, the pointer-event
// wiring — is a scaled-down port of App.jsx's own trackball rig, kept here because that logic
// lives inline in App.jsx intertwined with the rest of the dashboard's state and isn't itself an
// exported, reusable unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { AtomSketch } from '../../../src/components/atom/index.jsx';
import { generateAtomLayout, createAtomState, projectPoint, trackballVector } from '../../../src/utils/scene.js';
import { clamp } from '../../../src/utils/math.js';
import {
  BOND_LENGTH,
  VIEWBOX_SIZE,
  VIEWBOX_HALF,
  DEFAULT_SCENE_CAMERA,
  AUTO_ROTATE_SPEED,
} from '../../../src/constants/scene.js';

// Same tuning as App.jsx's DRAG_ROTATION_SENSITIVITY/DRAG_SPIN_DECAY/MAX_DRAG_SPIN_VELOCITY/
// DRAG_ROTATION_RESPONSE/IDLE_ROTATION_RESPONSE — not exported from scene.js (they're plain
// top-level consts in App.jsx), copied here so the drag feel matches exactly.
const DRAG_ROTATION_SENSITIVITY = 0.68;
const DRAG_SPIN_DECAY = 7.4;
const MAX_DRAG_SPIN_VELOCITY = 0.58;
const DRAG_ROTATION_RESPONSE = 30;
const IDLE_ROTATION_RESPONSE = 10;
// How far idle auto-rotate slows down once nobody's engaged with the (now always-visible) widget.
const IDLE_ROTATE_DISENGAGED_MULTIPLIER = 0.12;

// The widget is now user-resizable (main.js createAtomWidget, 160×190 – 480×560), but SVG text
// has no "stay a fixed screen size" mode — font-size lives in the same viewBox-scaled coordinate
// space as everything else, so shrinking the widget shrinks node labels right along with it. Below
// this reference stage size (the rendered stage px at the widget's *default* 260×300 — the size
// atom-sketch.css's base label font-sizes were tuned against), --atom-label-scale grows so labels
// stay legible at the widget's minimum size; at/above the reference size it's clamped to 1, so
// default and larger widgets render exactly as before.
const ATOM_LABEL_REFERENCE_STAGE_PX = 192;
const ATOM_LABEL_MAX_SCALE = 3;

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function toneClass(value) {
  return Number(value) > 0 ? 'is-profit' : Number(value) < 0 ? 'is-loss' : '';
}

const ATOM_HINT_STORAGE_KEY = 'atomfolio:atomHintDismissed';

// Shown once, ever — dismissed on the first interaction with the stage (or after a few seconds
// either way), then remembered in localStorage so it never comes back, including across restarts.
function useAtomHint() {
  const [visible, setVisible] = useState(() => {
    try {
      return window.localStorage.getItem(ATOM_HINT_STORAGE_KEY) !== '1';
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(ATOM_HINT_STORAGE_KEY, '1');
    } catch {
      // Worst case the hint reappears next launch — not harmful enough to handle further.
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const timer = setTimeout(dismiss, 4000);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  return [visible, dismiss];
}

function AtomReadout({ holding, totals }) {
  if (holding) {
    return (
      <div className="atom-readout">
        <div className="atom-readout__label">{holding.label || holding.code || '종목'}</div>
        <div className="atom-readout__value">{formatCurrency(holding.marketValue)}</div>
        <div className="atom-readout__row">
          {Number.isFinite(holding.returnRate) ? (
            <span className={`atom-readout__chip ${toneClass(holding.returnRate)}`.trim()}>
              {formatCurrency(holding.profitAmount)} · {formatPercent(holding.returnRate)}
            </span>
          ) : null}
          {Number.isFinite(holding.weightPercent) ? (
            <span className="atom-readout__note">비중 {holding.weightPercent.toFixed(1)}%</span>
          ) : null}
        </div>
      </div>
    );
  }

  const returnRate = totals?.totalReturnRate;

  return (
    <div className="atom-readout">
      <div className="atom-readout__label">포트폴리오 총액</div>
      <div className="atom-readout__value">{totals ? formatCurrency(totals.totalMarketValue) : '—'}</div>
      <div className="atom-readout__row">
        {totals && Number.isFinite(returnRate) ? (
          <span className={`atom-readout__chip ${toneClass(returnRate)}`.trim()}>
            {formatCurrency(totals.totalProfitAmount)} · {formatPercent(returnRate)}
          </span>
        ) : null}
        {totals ? <span className="atom-readout__note">{totals.holdingsCount}개 종목</span> : null}
      </div>
    </div>
  );
}

function AtomView({ items, holdings, totals, activeInsight }) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const [selectedAtomId, setSelectedAtomId] = useState(null);
  const [frameTime, setFrameTime] = useState(() => performance.now());
  const dragRef = useRef({ atomId: null, moved: false, startX: 0, startY: 0 });
  const rotationRef = useRef({
    current: new THREE.Quaternion(),
    target: new THREE.Quaternion(),
    lastTrack: new THREE.Vector3(0, 0, 1),
    lastDragAt: 0,
    spinVelocity: 0,
    spinAxis: new THREE.Vector3(0, 1, 0),
  });

  const baseAtoms = useMemo(() => generateAtomLayout(items).map(createAtomState), [items]);

  useEffect(() => {
    setSelectedAtomId((current) => (baseAtoms.some((atom) => atom.id === current) ? current : null));
  }, [baseAtoms]);

  // Only gates the always-on idle spin below — momentum from an actual drag release is a direct
  // response to the user's own gesture, not ambient motion, so it's left alone.
  const prefersReducedMotionRef = useRef(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotionRef.current = query.matches;
    const handleChange = (event) => {
      prefersReducedMotionRef.current = event.matches;
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // The atom widget is always on screen (unlike the old popover atom page, only open when
  // clicked), so an ambient full-speed spin runs indefinitely whether or not anyone's looking.
  // Idle rotation drops to a slow crawl once neither the pointer nor window focus indicates
  // someone's actually engaged with it, and returns to normal the moment either does.
  const engagementRef = useRef({ hovered: false, focused: typeof document !== 'undefined' && document.hasFocus() });
  useEffect(() => {
    const handleFocus = () => {
      engagementRef.current.focused = true;
    };
    const handleBlur = () => {
      engagementRef.current.focused = false;
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
  const handleStagePointerEnter = useCallback(() => {
    engagementRef.current.hovered = true;
  }, []);
  const handleStagePointerLeave = useCallback(() => {
    engagementRef.current.hovered = false;
  }, []);

  // Imperative (not React state) on purpose — this fires continuously while the user drags-resizes
  // the window, and a CSS custom property write is far cheaper than a re-render on every tick.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      const minDimension = Math.min(width, height);
      if (!minDimension) {
        return;
      }
      const scale = clamp(ATOM_LABEL_REFERENCE_STAGE_PX / minDimension, 1, ATOM_LABEL_MAX_SCALE);
      stage.style.setProperty('--atom-label-scale', String(scale));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    const autoRotateY = new THREE.Quaternion();
    const autoRotateX = new THREE.Quaternion();
    const spinQuaternion = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);

    const animate = (now) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const isDragging = Boolean(dragRef.current.atomId);
      const hasSpin = rotationRef.current.spinVelocity > 0.01;

      if (!isDragging && hasSpin) {
        spinQuaternion.setFromAxisAngle(
          rotationRef.current.spinAxis,
          Math.min(rotationRef.current.spinVelocity * delta, 0.04),
        );
        rotationRef.current.target.premultiply(spinQuaternion).normalize();
        rotationRef.current.spinVelocity *= Math.exp(-DRAG_SPIN_DECAY * delta);
        if (rotationRef.current.spinVelocity < 0.01) {
          rotationRef.current.spinVelocity = 0;
        }
      }

      if (!isDragging && !prefersReducedMotionRef.current) {
        const engaged = engagementRef.current.hovered || engagementRef.current.focused;
        const idleMultiplier = engaged ? 1 : IDLE_ROTATE_DISENGAGED_MULTIPLIER;
        autoRotateY.setFromAxisAngle(yAxis, delta * AUTO_ROTATE_SPEED * idleMultiplier);
        autoRotateX.setFromAxisAngle(xAxis, Math.sin(now * 0.00012) * delta * 0.0038 * idleMultiplier);
        rotationRef.current.target.premultiply(autoRotateY).premultiply(autoRotateX).normalize();
      }

      rotationRef.current.current.slerp(
        rotationRef.current.target,
        1 - Math.exp(-(isDragging ? DRAG_ROTATION_RESPONSE : IDLE_ROTATION_RESPONSE) * delta),
      );
      rotationRef.current.current.normalize();

      setFrameTime(now);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const clientToLocalPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return null;
    }
    return {
      x: ((clientX - bounds.left) / bounds.width) * VIEWBOX_SIZE - VIEWBOX_HALF,
      y: ((clientY - bounds.top) / bounds.height) * VIEWBOX_SIZE - VIEWBOX_HALF,
    };
  }, []);

  const handleNodePointerDown = useCallback(
    (atomId, event) => {
      event.stopPropagation();
      event.preventDefault();
      // Not every pointerdown is guaranteed to have an OS-level pointer session backing it
      // (synthetic input in particular) — setPointerCapture throws NotFoundError in that case.
      // The drag/select logic below doesn't actually depend on capture succeeding (rotation is
      // driven by a window-level pointermove/pointerup listener, not capture), so a failure here
      // shouldn't abort the rest of the handler.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignored — see comment above.
      }

      const point = clientToLocalPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      dragRef.current.atomId = atomId;
      dragRef.current.moved = false;
      dragRef.current.startX = event.clientX;
      dragRef.current.startY = event.clientY;
      rotationRef.current.lastTrack.copy(trackballVector(point));
      rotationRef.current.lastDragAt = performance.now();
      rotationRef.current.spinVelocity = 0;
    },
    [clientToLocalPoint],
  );

  useEffect(() => {
    const deltaQuaternion = new THREE.Quaternion();
    const appliedDeltaQuaternion = new THREE.Quaternion();
    const dragSpinAxis = new THREE.Vector3();

    const handleMove = (event) => {
      if (!dragRef.current.atomId) {
        return;
      }
      event.preventDefault();

      if (!dragRef.current.moved) {
        const moveX = event.clientX - dragRef.current.startX;
        const moveY = event.clientY - dragRef.current.startY;
        if (moveX * moveX + moveY * moveY > 36) {
          dragRef.current.moved = true;
        }
      }

      const point = clientToLocalPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      const nextTrack = trackballVector(point);
      deltaQuaternion.setFromUnitVectors(rotationRef.current.lastTrack, nextTrack);
      appliedDeltaQuaternion.identity().slerp(deltaQuaternion, DRAG_ROTATION_SENSITIVITY);
      rotationRef.current.target.premultiply(appliedDeltaQuaternion).normalize();

      const now = performance.now();
      const elapsed = rotationRef.current.lastDragAt
        ? Math.max((now - rotationRef.current.lastDragAt) / 1000, 0.001)
        : 0;
      const quaternionW = clamp(appliedDeltaQuaternion.w, -1, 1);
      const angle = 2 * Math.acos(quaternionW);
      const sinHalfAngle = Math.sqrt(Math.max(0, 1 - quaternionW * quaternionW));

      if (elapsed > 0 && angle > 0.0001 && sinHalfAngle > 0.0001) {
        dragSpinAxis
          .set(
            appliedDeltaQuaternion.x / sinHalfAngle,
            appliedDeltaQuaternion.y / sinHalfAngle,
            appliedDeltaQuaternion.z / sinHalfAngle,
          )
          .normalize();
        rotationRef.current.spinAxis.lerp(dragSpinAxis, 0.42).normalize();
        rotationRef.current.spinVelocity =
          rotationRef.current.spinVelocity * 0.52 +
          clamp(angle / elapsed, 0, MAX_DRAG_SPIN_VELOCITY) * 0.48;
      }

      rotationRef.current.lastDragAt = now;
      rotationRef.current.lastTrack.copy(nextTrack);
    };

    const handleUp = () => {
      if (!dragRef.current.atomId) {
        return;
      }
      const clickedAtomId = dragRef.current.atomId;
      const wasMoved = dragRef.current.moved;
      dragRef.current.atomId = null;
      dragRef.current.moved = false;

      if (!wasMoved) {
        rotationRef.current.spinVelocity = 0;
        setSelectedAtomId((current) => (current === clickedAtomId ? null : clickedAtomId));
      }
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [clientToLocalPoint]);

  // A new proactive insight (stop-loss/take-profit/allocation drift) auto-selects its atom so it's
  // the first thing visible next time the popover opens — but only once per insight (tracked by
  // key, not by object identity, since a fresh insight object with the same key arrives on every
  // poll for as long as the condition stays true). A manual click elsewhere still overrides it
  // normally afterward; this just draws the eye there once.
  const lastAutoHighlightedKeyRef = useRef(null);
  useEffect(() => {
    if (!activeInsight?.code || activeInsight.key === lastAutoHighlightedKeyRef.current) {
      return;
    }
    const match = baseAtoms.find(
      (atom) => atom.ticker === activeInsight.code || atom.stockCode === activeInsight.code,
    );
    if (match) {
      lastAutoHighlightedKeyRef.current = activeInsight.key;
      setSelectedAtomId(match.id);
    }
  }, [activeInsight, baseAtoms]);

  const atoms = useMemo(
    () =>
      baseAtoms.map((atom) => {
        const position = atom.baseDirection
          .clone()
          .applyQuaternion(rotationRef.current.current)
          .multiplyScalar(BOND_LENGTH);
        const projection = projectPoint(position, DEFAULT_SCENE_CAMERA);
        const isDraggingThis = dragRef.current.atomId === atom.id;
        const matchesActiveInsight =
          activeInsight?.code && (atom.ticker === activeInsight.code || atom.stockCode === activeInsight.code);

        return {
          ...atom,
          ...projection,
          x: projection.x,
          y: projection.y,
          scale: projection.scale,
          position,
          // Rides AtomLabel's existing leader-line rendering — swapping in the insight's reason
          // instead of a new label element means it inherits all the same positioning/opacity/
          // dimming logic for free.
          detail: matchesActiveInsight ? activeInsight.message : atom.detail,
          isSelected: atom.id === selectedAtomId,
          isGroupMatch: false,
          dimmed: selectedAtomId ? atom.id !== selectedAtomId : false,
          hoverMix: 0,
          dragMix: isDraggingThis ? 1 : 0,
          dragging: isDraggingThis,
        };
      }),
    // frameTime drives the continuous rotation repaint even though it isn't read directly here —
    // rotationRef.current.current is mutated in place by the RAF loop above.
    [baseAtoms, selectedAtomId, frameTime, activeInsight],
  );

  const [hintVisible, dismissHint] = useAtomHint();

  const pulse = 0.5 + Math.sin(frameTime * 0.00042) * 0.5;
  const centerMotion = frameTime * 0.00112;

  const selectedAtom = atoms.find((atom) => atom.id === selectedAtomId) ?? null;
  const selectedHolding = selectedAtom
    ? holdings.find(
        (holding) =>
          holding.code && (holding.code === selectedAtom.ticker || holding.code === selectedAtom.stockCode),
      ) ?? null
    : null;

  return (
    <div className="atom-section">
      <div
        className="atom-visual-stage"
        ref={stageRef}
        onPointerDownCapture={dismissHint}
        onPointerEnter={handleStagePointerEnter}
        onPointerLeave={handleStagePointerLeave}
      >
        <AtomSketch
          svgRef={svgRef}
          atoms={atoms}
          pulse={pulse}
          centerMotion={centerMotion}
          centerClickBurst={0}
          standalone={false}
          ariaLabel="보유 종목 원자"
          highlightActive={false}
          onCenterClick={() => setSelectedAtomId(null)}
          onPointerDown={handleNodePointerDown}
          onPointerEnter={() => {}}
          onPointerMove={() => {}}
          onPointerLeave={() => {}}
          onKeyboardSelect={(atomId) =>
            setSelectedAtomId((current) => (current === atomId ? null : atomId))
          }
        />
        {hintVisible ? (
          <div className="atom-hint" role="status">
            원자를 눌러 자세히 보기
          </div>
        ) : null}
      </div>
      <AtomReadout holding={selectedHolding} totals={totals} />
    </div>
  );
}

function AtomViewRoot() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.atomfolio.getState().then((initial) => {
      if (!cancelled) {
        setState(initial);
      }
    });
    const unsubscribe = window.atomfolio.onState((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (!state?.connected || !state.items?.length) {
    return null;
  }

  return (
    <AtomView
      items={state.items}
      holdings={state.holdings ?? []}
      totals={state.totals}
      activeInsight={state.activeInsight ?? null}
    />
  );
}

const mountNode = document.getElementById('atom-visual-root');
if (mountNode) {
  createRoot(mountNode).render(<AtomViewRoot />);
}
