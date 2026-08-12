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
import { useAtomTransition } from '../../../src/utils/useAtomTransition.js';
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

function findFieldValue(fields, label) {
  const match = Array.isArray(fields) ? fields.find((field) => field?.label === label) : null;
  return match ? Number(match.value) : null;
}

// Prefers the workspace holdings summary (clean, already-computed marketValue/profitAmount) when
// it has a match for the clicked atom — but summarizeWorkspaceHoldings (desktop/src/lib/
// portfolioTotals.mjs, shared analytics math) only includes positions with a computable
// marketValue, which needs a share quantity. A weight-only import ("this position is 40% of the
// portfolio", no quantity) never gets a marketValue there, so `holdings` comes back without it —
// even though the atom itself renders every item unconditionally via the real generateAtomLayout.
// Clicking one of those would otherwise show nothing. Falling back to the raw item's own live
// market-data fields (already fetched for the atom's own detail label) means every clickable node
// has *something* to show, regardless of which import style produced it.
function buildSelectedInfo(holding, item) {
  if (holding) {
    return {
      label: holding.label || holding.code || '종목',
      valueText: formatCurrency(holding.marketValue),
      changeText: Number.isFinite(holding.returnRate)
        ? `${formatCurrency(holding.profitAmount)} · ${formatPercent(holding.returnRate)}`
        : null,
      changeTone: toneClass(holding.returnRate),
      weightText: Number.isFinite(holding.weightPercent) ? `비중 ${holding.weightPercent.toFixed(1)}%` : null,
    };
  }

  if (item) {
    const weightPercent = findFieldValue(item.fields, '비중(%)');
    return {
      label: item.label || item.stockName || item.name || item.ticker || '종목',
      valueText: item.marketPrice || (Number.isFinite(item.latestPrice) ? formatCurrency(item.latestPrice) : '—'),
      changeText: Number.isFinite(item.marketChangePercent)
        ? `${formatCurrency(item.marketChange)} · ${formatPercent(item.marketChangePercent)}`
        : null,
      changeTone: toneClass(item.marketChangePercent),
      weightText: Number.isFinite(weightPercent) ? `비중 ${weightPercent.toFixed(1)}%` : null,
    };
  }

  return null;
}

// No idle/default state anymore (used to show the portfolio-wide total when nothing was
// selected) — the widget stays quiet until a node is actually clicked, then shows that stock's
// own info.
//
// Stays mounted at all times now instead of returning null when info is absent — it used to
// unmount immediately, which is also what let it sit in .atom-section's normal flex flow and
// shrink .atom-visual-stage every time it appeared (see atom-widget.css for the overlay fix on
// that side). An immediate unmount also means there's nothing left on screen to fade *out* — a
// disappear transition needs something to still be there while it plays. deferredInfo holds
// onto the last real info through that fade so the text doesn't blank out mid-animation; `visible`
// is the actual trigger for the CSS transition, one render tick behind `info` on purpose.
function AtomReadout({ info }) {
  const [deferredInfo, setDeferredInfo] = useState(info);
  const [visible, setVisible] = useState(Boolean(info));

  useEffect(() => {
    if (info) {
      setDeferredInfo(info);
    }
    setVisible(Boolean(info));
  }, [info]);

  if (!deferredInfo) {
    return null;
  }

  return (
    <div className={`atom-readout${visible ? ' is-visible' : ''}`}>
      <div className="atom-readout__label">{deferredInfo.label}</div>
      <div className="atom-readout__value">{deferredInfo.valueText}</div>
      <div className="atom-readout__row">
        {deferredInfo.changeText ? (
          <span className={`atom-readout__chip ${deferredInfo.changeTone}`.trim()}>{deferredInfo.changeText}</span>
        ) : null}
        {deferredInfo.weightText ? <span className="atom-readout__note">{deferredInfo.weightText}</span> : null}
      </div>
    </div>
  );
}

function AtomView({ items, holdings, activeInsight, selectedPortfolioId }) {
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

  // Dissolve/materialize (shared with the web app — see the hook itself) for two triggers here:
  // widget close (main.js sends atomfolio:widget-closing, see the effect below) and portfolio
  // switch (this component noticing selectedPortfolioId changed, see the next effect down).
  const {
    scale: atomTransitionScale,
    phase: atomTransitionPhase,
    transitionAngularVelocityRef: atomTransitionAngularVelocityRef,
    dissolve: dissolveAtom,
    materialize: materializeAtom,
    advanceTransition: advanceAtomTransition,
  } = useAtomTransition();

  // What the scene actually renders — deliberately not just `items` directly. On a portfolio
  // switch, main.js has already swapped state.items by the time this component finds out (unlike
  // the web app's preview-atom click, which controls its own timing and can dissolve *before*
  // touching the data); holding the previous portfolio's items here until the dissolve finishes
  // is what makes "dissolve the old one, then swap, then materialize the new one" possible instead
  // of the swap happening invisibly out from under an already-in-flight dissolve.
  const [displayedItems, setDisplayedItems] = useState(items);
  const previousPortfolioIdRef = useRef(selectedPortfolioId);
  // Layout for the *next* portfolio, computed as soon as the switch is known rather than left for
  // baseAtoms' own useMemo to compute fresh at the swap instant below — see baseAtoms, which reads
  // this instead of calling generateAtomLayout itself when it matches. Keyed by items reference
  // (main.js has already swapped state.items to the target portfolio's by the time this effect
  // sees selectedPortfolioId change, so `items` here already *is* the target — setDisplayedItems
  // is later called with this exact same reference, which is what the match is against).
  const precomputedBaseAtomsRef = useRef({ items: null, atoms: null });

  useEffect(() => {
    if (previousPortfolioIdRef.current === selectedPortfolioId) {
      // Same portfolio — e.g. a poll-tick price refresh, or a quick-added holding. Real data, just
      // not a "switch", so it should show up immediately with no transition at all.
      setDisplayedItems(items);
      return undefined;
    }
    previousPortfolioIdRef.current = selectedPortfolioId;
    // Runs in parallel with the dissolve about to play below, instead of landing as synchronous
    // work exactly at the dissolve->materialize handoff (previously the one moment it could read
    // as a felt hitch — right as the atom needs to start growing back in).
    precomputedBaseAtomsRef.current = { items, atoms: generateAtomLayout(items).map(createAtomState) };
    let cancelled = false;
    (async () => {
      await dissolveAtom();
      if (cancelled) {
        return;
      }
      setDisplayedItems(items);
      await materializeAtom();
    })();
    return () => {
      cancelled = true;
    };
    // Fires on every items change (a poll-tick price refresh included, not just a switch) — the
    // branch at the top of this effect is what tells those apart, immediately adopting the new
    // items with no transition unless selectedPortfolioId also moved since the last run.
  }, [items, selectedPortfolioId, dissolveAtom, materializeAtom]);

  // main.js plays this dissolve before actually hiding the window (see its own
  // hideAtomWidgetAfterDissolve) — acks back once done, with a timeout on that side in case this
  // never fires (component unmounted, reduced-motion resolved instantly but the message raced
  // it, etc.) so the widget can never get stuck refusing to hide.
  useEffect(() => {
    return window.atomfolio?.onWidgetClosing?.(async () => {
      await dissolveAtom();
      window.atomfolio?.widgetCloseAck?.();
    });
  }, [dissolveAtom]);

  // Symmetric with onWidgetClosing above — without this, showing the widget again after it was
  // dissolved-and-hidden left --materialize stuck at 0 (the dissolve's end state) forever, since
  // nothing ever told the transition to run the other direction. No ack needed here (unlike
  // closing, main.js isn't waiting on anything before it can proceed — the window is already
  // shown by the time this fires, just still scaled to 0 until this plays out).
  useEffect(() => {
    return window.atomfolio?.onWidgetOpening?.(() => {
      void materializeAtom();
    });
  }, [materializeAtom]);

  const baseAtoms = useMemo(
    () => {
      const precomputed = precomputedBaseAtomsRef.current;
      if (precomputed.items === displayedItems && precomputed.atoms) {
        precomputedBaseAtomsRef.current = { items: null, atoms: null };
        return precomputed.atoms;
      }
      return generateAtomLayout(displayedItems).map(createAtomState);
    },
    [displayedItems],
  );

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
  // Idle rotation drops to a slow crawl until window focus indicates someone's actually engaged
  // with it, and returns to normal the moment it does.
  //
  // This used to also count merely hovering the pointer over the widget as "engaged" (full speed
  // the instant the cursor entered the stage, no click needed). With backgroundThrottling now
  // fixed elsewhere so this rAF loop actually runs at full rate in the background, that hover
  // trigger stopped being the barely-perceptible nudge it read as before and started reading as
  // "the atom moves just because my cursor is near it" — motion with no action behind it. Focus
  // (the window actually being interacted with, not just moused-over) is a deliberate enough
  // signal to keep; hover isn't.
  const engagementRef = useRef({ focused: typeof document !== 'undefined' && document.hasFocus() });
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

  // ⌘ gates "move the window" vs "rotate the atom" — without it, grabbing anywhere on the stage
  // (including the center/bond-lines) behaves like the website's trackball; holding ⌘ moves the
  // window instead. This still updates .is-move-mode on hover (below) purely for the grab/grabbing
  // cursor — but actually MOVING the window is done by hand (screenX/screenY deltas -> IPC), not
  // via -webkit-app-region: drag. A native-app-region version was tried first and reported broken
  // in real use (window just doesn't move): -webkit-app-region: drag only takes effect for a
  // mousedown that starts *after* the browser process has already cached that point as a
  // draggable region from a prior layout pass — the region has to be armed before the click, not
  // during it. Toggling the class reactively from a pointerdown/pointermove handler is
  // structurally too late for that same pointerdown (if the region had actually been armed in
  // time, the native drag would have intercepted the mousedown before it ever reached this JS
  // handler at all) — it only had a chance of working if the user happened to move the mouse
  // (hover) with ⌘ already held before pressing, not the more natural press-then-hold-⌘-then-drag
  // order. Reading event.metaKey off pointer events (below and in handleNodePointerDown) is still
  // the right way to detect the modifier without keyboard focus — the OS attaches current modifier
  // state to every mouse event regardless of window focus — it's specifically the "hand the drag
  // off to app-region" part that didn't hold up.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const syncMoveMode = (event) => {
      stage.classList.toggle('is-move-mode', event.metaKey);
    };
    const clearMoveMode = () => {
      stage.classList.remove('is-move-mode');
    };
    stage.addEventListener('pointermove', syncMoveMode);
    stage.addEventListener('pointerdown', syncMoveMode);
    stage.addEventListener('pointerleave', clearMoveMode);
    return () => {
      stage.removeEventListener('pointermove', syncMoveMode);
      stage.removeEventListener('pointerdown', syncMoveMode);
      stage.removeEventListener('pointerleave', clearMoveMode);
    };
  }, []);

  // The actual ⌘-move drag: started from handleStagePointerDown below (background/center/node —
  // whatever's under the cursor, as long as ⌘ is held), same dragRef + window-level pointermove/up
  // shape as the rotation drag further down. Tracked via screenX/screenY (not clientX/Y) because
  // the window itself moves under the cursor as this runs — a client-coordinate delta would be
  // measuring against a stage that just relocated out from under it; screen coordinates don't have
  // that problem.
  const widgetDragRef = useRef({ active: false, pointerId: null, lastScreenX: 0, lastScreenY: 0 });

  const handleStagePointerDown = useCallback((event) => {
    if (!event.metaKey) {
      return;
    }
    event.preventDefault();
    widgetDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Same rationale as handleNodePointerDown below — capture is a nice-to-have, not required.
    }
  }, []);

  useEffect(() => {
    const handleMove = (event) => {
      const drag = widgetDragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
      }
      const dx = event.screenX - drag.lastScreenX;
      const dy = event.screenY - drag.lastScreenY;
      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      if (dx !== 0 || dy !== 0) {
        window.atomfolio?.moveWidgetBy?.(dx, dy);
      }
    };
    const handleUp = (event) => {
      const drag = widgetDragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
      }
      widgetDragRef.current.active = false;
      // Snap-to-edge (main.js) only fires from this explicit "drag actually ended" signal, not on
      // every intermediate move — see main.js's atomfolio:widget-move-end handler.
      window.atomfolio?.moveWidgetEnd?.();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
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
    const transitionSpinY = new THREE.Quaternion();
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
        const engaged = engagementRef.current.focused;
        const idleMultiplier = engaged ? 1 : IDLE_ROTATE_DISENGAGED_MULTIPLIER;
        autoRotateY.setFromAxisAngle(yAxis, delta * AUTO_ROTATE_SPEED * idleMultiplier);
        autoRotateX.setFromAxisAngle(xAxis, Math.sin(now * 0.00012) * delta * 0.0038 * idleMultiplier);
        rotationRef.current.target.premultiply(autoRotateY).premultiply(autoRotateX).normalize();
      }

      // Drives useAtomTransition's own progress — this loop is the only rAF loop either of them
      // runs now, so this is the one place that has to call it. A no-op whenever no
      // dissolve()/materialize() is in flight. Must run before the read below, so that read sees
      // this frame's velocity rather than last frame's.
      advanceAtomTransition(now);

      // Dissolve/materialize's own spin — added on top of (not multiplied into) idle rotation
      // above, and applies regardless of hover/focus/reduced-motion gating on that idle rotation:
      // this is a transition playing out on its own timeline, not ambient drift. useAtomTransition
      // itself zeroes this out under prefers-reduced-motion, so there's no separate guard needed
      // here for that.
      if (atomTransitionAngularVelocityRef.current !== 0) {
        transitionSpinY.setFromAxisAngle(yAxis, delta * atomTransitionAngularVelocityRef.current);
        rotationRef.current.target.premultiply(transitionSpinY).normalize();
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
      // ⌘ held means this is a window-move gesture, not a rotation — bail out without touching
      // dragRef/stopPropagation/preventDefault. Not calling stopPropagation is what lets the event
      // keep bubbling up to .atom-visual-stage's own onPointerDown (handleStagePointerDown above),
      // which is what actually starts the move drag — so a ⌘-drag started on a node or the center
      // moves the window exactly the same as one started on empty stage background. Starting
      // rotation tracking here anyway would also risk it never getting a matching pointerup once
      // the window-move drag takes over the gesture, leaving dragRef.current.atomId stuck non-null
      // — which would silently disable idle auto-rotate for good, since the render loop treats a
      // non-null atomId as "still dragging".
      if (event.metaKey) {
        return;
      }
      // Dissolving/materializing swaps the underlying atom data out from under any rotation state
      // that was mid-gesture, and is already animating rotation speed on its own — ignoring new
      // rotation drags while a transition is in flight is simpler and safer than reconciling the
      // two. ⌘-drag (window move, handled above) is unaffected — it doesn't touch rotation state
      // at all, so there's nothing for it to conflict with.
      if (atomTransitionPhase !== 'idle') {
        return;
      }
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
    [clientToLocalPoint, atomTransitionPhase],
  );

  // AtomSketch's own .center-hit unconditionally stopPropagation()s on pointerdown (it has to —
  // that's what makes a plain click-to-deselect work without also rotating the atom underneath
  // it), which normally never gives .atom-visual-stage's own onPointerDown a chance to see a
  // center pointerdown at all. Returning exactly `false` here opts out of that for the ⌘ case
  // only, letting the event bubble up to handleStagePointerDown — same outcome
  // handleNodePointerDown above already gives individual nodes. Returning undefined (the ⌘-not-
  // held path) keeps AtomSketch's existing capture/stopPropagation/onCenterClick behavior exactly
  // as it always was.
  const handleCenterPointerDown = useCallback((event) => {
    if (event.metaKey) {
      return false;
    }
    return undefined;
  }, []);

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
  const selectedItem = selectedAtom
    ? displayedItems.find(
        (item) => item && (item.ticker === selectedAtom.ticker || item.stockCode === selectedAtom.stockCode),
      ) ?? null
    : null;
  const selectedInfo = buildSelectedInfo(selectedHolding, selectedItem);

  return (
    <div className="atom-section">
      <div
        className="atom-visual-stage"
        ref={stageRef}
        onPointerDownCapture={dismissHint}
        onPointerDown={handleStagePointerDown}
      >
        {/* Dissolve/materialize (useAtomTransition, shared with the web app) — whole-scene scale
            via a CSS custom property, not per-node repositioning. See atom-widget.css for the
            class itself. */}
        <div className="atom-materialize-wrapper" style={{ '--materialize': atomTransitionScale }}>
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
            onCenterPointerDown={handleCenterPointerDown}
            onPointerDown={handleNodePointerDown}
            onPointerEnter={() => {}}
            onPointerMove={() => {}}
            onPointerLeave={() => {}}
            onKeyboardSelect={(atomId) =>
              setSelectedAtomId((current) => (current === atomId ? null : atomId))
            }
          />
        </div>
        {hintVisible ? (
          <div className="atom-hint" role="status">
            원자를 눌러 자세히 보기
          </div>
        ) : null}
      </div>
      <AtomReadout info={selectedInfo} />
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

  // Same signal and same data-theme mechanism popover.js uses (main.js's broadcastTheme, sent to
  // both windows) — atom-widget.css/atom-sketch.css's --atom-ink and --widget-ink* tokens are
  // what actually react to it, this just carries the resolved value onto <html>.
  useEffect(() => {
    let cancelled = false;
    window.atomfolio.getTheme().then((theme) => {
      if (!cancelled) {
        document.documentElement.dataset.theme = theme.isDark ? 'dark' : 'light';
      }
    });
    const unsubscribe = window.atomfolio.onTheme(({ isDark }) => {
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    });
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
      activeInsight={state.activeInsight ?? null}
      selectedPortfolioId={state.selectedPortfolioId ?? null}
    />
  );
}

const mountNode = document.getElementById('atom-visual-root');
if (mountNode) {
  createRoot(mountNode).render(<AtomViewRoot />);
}
