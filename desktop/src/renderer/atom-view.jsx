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
import { formatKoreanWonShort, normalizeDisplayKey } from '../../../src/utils/format.js';
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
// top-level consts in App.jsx), copied here so the drag feel matches exactly. Keep MAX_DRAG_SPIN_
// VELOCITY/DRAG_SPIN_DECAY in sync with App.jsx's own copy in particular — see that file's comment
// on why these two specifically (not just "match by convention" like the others) have to move
// together: their ratio is the hard ceiling on how far the atom can keep spinning after release.
const DRAG_ROTATION_SENSITIVITY = 0.68;
const DRAG_SPIN_DECAY = 7.4;
const MAX_DRAG_SPIN_VELOCITY = 3.2;
const DRAG_ROTATION_RESPONSE = 30;
const IDLE_ROTATION_RESPONSE = 10;

// The widget is now user-resizable (main.js createAtomWidget, 160×190 – 480×560), but SVG text
// has no "stay a fixed screen size" mode — font-size lives in the same viewBox-scaled coordinate
// space as everything else, so shrinking the widget shrinks node labels right along with it. Below
// this reference stage size (the rendered stage px at the widget's *default* 260×300 — the size
// atom-sketch.css's base label font-sizes were tuned against), --atom-label-scale grows so labels
// stay legible at the widget's minimum size; at/above the reference size it's clamped to 1, so
// default and larger widgets render exactly as before.
const ATOM_LABEL_REFERENCE_STAGE_PX = 192;
const ATOM_LABEL_MAX_SCALE = 3;


// 억/만 축약 (src/utils/format.js's formatKoreanWonShort, shared with the web app's own
// DigitalTwinPanel and the popover's summary page) — was a raw Intl.NumberFormat currency string
// (₩12,345,000), which at the widget's default width wraps mid-digit exactly the way the web
// dashboard's own cards used to before that got fixed; same compact style everywhere money
// appears now, not just here. Plain magnitude, no sign — see formatSignedCurrency below for
// deltas (profit/change amounts), which do need one.
function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `₩${formatKoreanWonShort(value)}`;
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}₩${formatKoreanWonShort(Math.abs(value))}`;
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

// Local re-implementation of src/App.jsx's own canHighlightGroupField (not exported from there,
// and App.jsx/src/components/atom/src/utils/scene.js are explicitly off-limits for this task) —
// same two checks: the field actually has a value, and that value came from real enrichment
// (securityKnowledge.js) rather than being empty/inferred-from-nothing. Guards against grouping
// a whole portfolio together under a false "same category" just because every holding alike has
// an empty risk/style field, say.
function canHighlightGroupField(atom, groupKey) {
  if (!atom || !groupKey) {
    return false;
  }
  const value = String(atom[groupKey] ?? '').trim();
  if (!value) {
    return false;
  }
  const source = String(atom.metadataSourceByField?.[groupKey] ?? '').trim().toLowerCase();
  return source === 'provided' || source === 'reference' || source === 'derived' || source === 'wikidata';
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
        ? `${formatSignedCurrency(holding.profitAmount)} · ${formatPercent(holding.returnRate)}`
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
      // No changeText here (unlike the `holding` branch above) — item.marketChange/
      // marketChangePercent are the security's own *today's* price move, in its *native*
      // currency (item.marketPrice above might read €0.28, $12.40, etc. depending on the
      // listing), not the portfolio's total return in KRW. formatSignedCurrency always prefixes
      // ₩ regardless of what currency the number is actually denominated in, so rendering it here
      // produced a won-sign amount that was neither the right currency nor the right metric —
      // e.g. showing "-₩0 · -1.39%" (today's move) right where a stop-loss notification for the
      // same stock had just said "-98.10%" (total return since purchase). Nothing accurate to
      // show without a real holding (see this function's own comment above on why one might be
      // missing), so this stays blank rather than showing something actively misleading.
      changeText: null,
      changeTone: '',
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

function AtomView({ items, holdings, activeInsight, selectedPortfolioId, categoryDimension, sleeping }) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const [selectedAtomId, setSelectedAtomId] = useState(null);
  const [frameTime, setFrameTime] = useState(() => performance.now());
  const dragRef = useRef({ atomId: null, moved: false, startX: 0, startY: 0 });
  // Whether a widget window-move drag is currently in flight — read by the click-through
  // hit-test below (its own dragInProgress) so the window can never go click-through mid-drag,
  // which is what let a drag get stuck running forever (see that effect's own comment). Declared
  // up here (not next to handleWidgetDragStart/handleWidgetDragEnd further down, which actually
  // set it) so there's no question of it being used before it's initialized — not React state,
  // since nothing here needs to re-render off it, only read it synchronously from event handlers.
  const widgetDragActiveRef = useRef(false);
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
  // clicked), so an ambient full-speed spin runs indefinitely — hovering it, sleeping, window
  // focus, none of that slows it down. The only thing that stops it is actually picking an atom up
  // (isDragging below, set from a real pointerdown-and-move on an atom): motion pauses under your
  // hand while you're actively spinning it yourself, and resumes the instant you let go. This went
  // through two other gates first (window focus, then hover) before landing here — both made
  // rotation feel like it was barely alive most of the time, gated on a signal that had nothing to
  // do with whether anyone actually wanted it to stop.

  // ⌘ held is what turns a press into "move the window" instead of "rotate/select the atom" —
  // without it, grabbing a node/center still rotates/selects it (handleNodePointerDown below, and
  // AtomSketch's own .center-hit, stop propagation and take over the gesture themselves the same
  // as always) and grabbing anywhere else on .atom-section does nothing (handleWidgetDragStart
  // bails without ⌘). With ⌘ held, though, *every* press moves the window — including one that
  // starts on a node or the center — because handleNodePointerDown/handleCenterPointerDown below
  // both opt out (without stopPropagation()) the moment they see event.metaKey, letting the press
  // bubble up to .atom-section's own handler instead of being taken over locally. Reintroduced
  // after an earlier version dropped the modifier entirely (a plain single-handed grab-anywhere
  // drag, no ⌘): that felt right for the empty background, but meant there was no way to reposition
  // the widget by grabbing a node without it rotating first — ⌘ fixes that by making "move" an
  // explicit, always-available gesture regardless of what's under the cursor.
  //
  // The move drag itself is synthetic, not a native OS window-drag — handleWidgetDragStart just
  // tells main.js a drag started (window.atomfolio.beginWidgetDrag), and main.js's
  // beginAtomWidgetDrag/endAtomWidgetDrag own the actual gesture from there, polling the cursor via
  // screen.getCursorScreenPoint() on a timer for as long as it's held (see main.js's own comment).
  // This *used* to be a real native drag (atom-widget.css's -webkit-app-region: drag, no JS,
  // no IPC, no cursor polling) specifically so macOS's own Mission Control would carry the widget
  // onto a neighboring Space when it was held at the screen edge mid-drag — a real native drag is
  // the only kind that behavior fires for at all; a synthetic one (repeated setPosition() calls,
  // like this) never registers as a real window-drag session with the window server, so Mission
  // Control never gets a session to hook into. That Space-carry turned out to be exactly the wrong
  // default for an ambient widget meant to stay put on whichever Space it was shown on (see
  // createAtomWidget's own comment in main.js) — so this went back to being synthetic, on purpose,
  // to lose that one side effect while keeping everything else about the drag feeling identical.

  // Click-through for the widget's own empty space. This is a transparent, frameless
  // BrowserWindow — by default Electron gives it a normal opaque hit-box covering its whole
  // rectangle, so *any* pixel inside that rectangle intercepts clicks regardless of whether
  // anything is actually painted there. Almost everything drawn here already opts out of that at
  // the SVG level (every decorative stroke/glow/label in atom-sketch.css is pointer-events: none;
  // only .node-hit/.center-hit are pointer-events: all) — but the plain <div>s wrapping the SVG
  // (.atom-visual-stage, .atom-materialize-wrapper) still have the CSS default (pointer-events:
  // auto), so today the entire stage box still eats every click that isn't over a node, doing
  // nothing with it and blocking whatever's behind this window — that's the actual bug being
  // fixed here, not just the visually-obvious margin around the atom.
  //
  // document.elementFromPoint (not a ref on the event target) is what actually answers "is this
  // pixel currently interactive" — the event target for a plain pointermove is whatever DOM
  // element is literally under the cursor, which for the reasons above is almost always one of
  // those wrapper divs rather than something meaningful to branch on directly.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }

    // null (not a boolean) so the very first evaluation always sends its result, regardless of
    // which way it comes out — there's no meaningful "default" to compare against yet. A ref, not
    // a plain closure variable, because onWidgetOpening below has to be able to reset it: main.js
    // resets the *actual* window to non-ignoring on every show (see setAtomWidgetVisible's own
    // comment), and this has to reset back in step, or a re-shown widget whose cursor lands
    // somewhere that hashes to the same shouldIgnore it had before being hidden would never
    // re-send the IPC (the `!== lastIgnore` guard below would see no change) even though main.js's
    // side had already changed out from under it.
    const lastIgnoreRef = { current: null };

    const unsubscribeOpening = window.atomfolio?.onWidgetOpening?.(() => {
      lastIgnoreRef.current = null;
    });

    const evaluate = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const overHitTarget = Boolean(target?.closest?.('.node-hit, .center-hit'));
      const overStage = Boolean(target && stage.contains(target));
      // A drag already in progress — either a node-rotation (dragRef) or a widget window-move
      // (widgetDragActiveRef, see handleWidgetDragStart/handleWidgetDragEnd below) — must never
      // flip to click-through mid-gesture: forward: true (see main.js's
      // atomfolio:widget-set-click-through handler) only forwards move events, not the eventual
      // pointerup/pointercancel this component needs in order to end the drag cleanly. Missing
      // the widget-drag half of this was the actual bug behind "grab the widget and it never lets
      // go" — the cursor drifting off .atom-visual-stage's own bounds mid-drag (trivially easy
      // during a real drag gesture) used to flip the window to click-through, which stops it from
      // ever receiving the pointerup that would have ended the drag, leaving main.js's cursor-poll
      // loop running indefinitely.
      const dragInProgress = Boolean(dragRef.current.atomId) || widgetDragActiveRef.current;
      // ⌘ held is also always interactive, regardless of overStage — the widget-move drag starts
      // from .atom-section's own pointerdown (see handleWidgetDragStart), which includes the
      // outer drag-margin padding *outside* .atom-visual-stage's own bounds; requiring overStage
      // here too would make that margin permanently click-through, so a ⌘-drag could never start
      // there in the first place.
      const interactive = overHitTarget || dragInProgress || overStage || event.metaKey;
      const shouldIgnore = !interactive;

      if (shouldIgnore !== lastIgnoreRef.current) {
        lastIgnoreRef.current = shouldIgnore;
        window.atomfolio?.setWidgetClickThrough?.(shouldIgnore);
      }
    };

    window.addEventListener('pointermove', evaluate);
    return () => {
      window.removeEventListener('pointermove', evaluate);
      unsubscribeOpening?.();
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
        // Negative angle: with projectPoint's screen-x mapping directly onto 3D x (no camera-side
        // flip — see src/utils/scene.js), a positive setFromAxisAngle(yAxis, +θ) rotation drifts
        // the near-facing atoms toward screen-*right*. Negating it is what actually makes the
        // widget spin left, not just "whichever way the default sign happens to fall out" — and
        // it's a fixed direction, not something idle state ever flips.
        autoRotateY.setFromAxisAngle(yAxis, -delta * AUTO_ROTATE_SPEED);
        autoRotateX.setFromAxisAngle(xAxis, Math.sin(now * 0.00012) * delta * 0.0038);
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
      // ⌘ held: this press should move the window, the same as grabbing empty stage space does —
      // see handleWidgetDragStart below. Returning here without stopPropagation()/preventDefault()
      // lets the pointerdown bubble straight up to .atom-section's own handler instead of this one
      // taking it over; handleCenterPointerDown below does the identical thing for the center-hit
      // circle, just via AtomSketch's own onCenterPointerDown escape hatch instead of a plain
      // return, since that circle's pointerdown is handled inside the shared component, not here.
      if (event.metaKey) {
        return;
      }
      // Dissolving/materializing swaps the underlying atom data out from under any rotation state
      // that was mid-gesture, and is already animating rotation speed on its own — ignoring new
      // rotation drags while a transition is in flight is simpler and safer than reconciling the
      // two.
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

  // AtomSketch's own center-hit circle takes the pointerdown over itself (stopPropagation) unless
  // this returns exactly `false` — see that component's own comment on onCenterPointerDown. Same
  // ⌘ branch as handleNodePointerDown above, just expressed through that escape hatch instead of a
  // plain early return, since the center-hit's pointerdown handling lives in the shared component,
  // not here.
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

  // Starts the widget's window-move drag — see atom-widget.css's own comment on .atom-section for
  // why this is a synthetic (IPC-driven) drag rather than -webkit-app-region: drag. ⌘ gates it:
  // without it, this does nothing at all, so a plain click-drag on empty background does nothing
  // here and a plain click-drag on a node/center still rotates/selects it as always. Reaches here
  // for a press on .atom-section's own empty space unconditionally, *and* — with ⌘ held — for a
  // press that started on a node or the center too, since handleNodePointerDown/
  // handleCenterPointerDown both opt out and let it bubble up in that case instead of
  // stopPropagation()ing it the way they do without ⌘.
  const handleWidgetDragStart = useCallback((event) => {
    if (!event.metaKey) {
      return;
    }
    if (event.button !== 0) {
      // Native app-region drags only ever responded to the primary button too — a right-click here
      // should reach the context-menu handler untouched, not also kick off a window move.
      return;
    }
    widgetDragActiveRef.current = true;
    window.atomfolio?.beginWidgetDrag?.();
  }, []);

  // Ends whatever drag main.js's beginAtomWidgetDrag started, on the next window-level
  // pointerup/pointercancel after it — mirrors the node-rotation handleUp above (a window-level
  // listener, not pointer capture; see handleNodePointerDown's own comment on why capture isn't
  // load-bearing here either). Fires on *every* pointerup, including ones that never followed a
  // widget-drag pointerdown (a plain click, or a node-rotate's own release) — main.js's
  // endAtomWidgetDrag is safe to call unconditionally, so there's nothing to gate on *that* side;
  // widgetDragActiveRef is reset here regardless, purely so the click-through hit-test's own
  // dragInProgress read stops being true the instant the drag actually ends.
  useEffect(() => {
    const handleWidgetDragEnd = () => {
      widgetDragActiveRef.current = false;
      window.atomfolio?.endWidgetDrag?.();
    };
    window.addEventListener('pointerup', handleWidgetDragEnd);
    window.addEventListener('pointercancel', handleWidgetDragEnd);
    return () => {
      window.removeEventListener('pointerup', handleWidgetDragEnd);
      window.removeEventListener('pointercancel', handleWidgetDragEnd);
    };
  }, []);

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

  // The clicked atom's own value for the settings-selected category dimension (assetClass/region/
  // sector/style/risk — see popover.js's 카테고리 필터 control) — computed against baseAtoms, not
  // the projected `atoms` below, since it only needs the field value, not this frame's rotation.
  const selectedBaseAtom = selectedAtomId ? baseAtoms.find((atom) => atom.id === selectedAtomId) : null;
  const activeGroupValue =
    selectedBaseAtom && canHighlightGroupField(selectedBaseAtom, categoryDimension)
      ? normalizeDisplayKey(selectedBaseAtom[categoryDimension])
      : null;

  // Mirrors the current selection to the main process — the one thing it's for is offering
  // "open *this stock's* news" in the widget's own right-click menu (see main.js's
  // widgetSelection) instead of only the generic news page. selectedBaseAtom is a plain render-
  // time const (not a ref/memo), but baseAtoms.find() returns the same array element reference
  // across re-renders that don't actually change selectedAtomId or baseAtoms itself, so this
  // effect doesn't fire on every animation-driven re-render — only on an actual
  // select/deselect/portfolio-switch.
  useEffect(() => {
    const label = selectedBaseAtom?.label || selectedBaseAtom?.stockName || null;
    window.atomfolio?.setWidgetSelection?.(
      label ? { ticker: selectedBaseAtom.ticker || selectedBaseAtom.stockCode || null, label } : null,
    );
  }, [selectedBaseAtom]);

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
        const isGroupMatch =
          activeGroupValue != null &&
          atom.id !== selectedAtomId &&
          canHighlightGroupField(atom, categoryDimension) &&
          normalizeDisplayKey(atom[categoryDimension]) === activeGroupValue;

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
          isGroupMatch,
          // Same-category atoms stay at full opacity alongside the selected one — only genuinely
          // unrelated holdings dim out.
          dimmed: selectedAtomId ? atom.id !== selectedAtomId && !isGroupMatch : false,
          hoverMix: 0,
          dragMix: isDraggingThis ? 1 : 0,
          dragging: isDraggingThis,
        };
      }),
    // frameTime drives the continuous rotation repaint even though it isn't read directly here —
    // rotationRef.current.current is mutated in place by the RAF loop above.
    [baseAtoms, selectedAtomId, frameTime, activeInsight, activeGroupValue, categoryDimension],
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
    <div className="atom-section" onPointerDown={handleWidgetDragStart}>
      <div className="atom-visual-stage" ref={stageRef} onPointerDownCapture={dismissHint}>
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
      categoryDimension={state.categoryDimension ?? 'sector'}
      sleeping={state.sleeping ?? false}
    />
  );
}

const mountNode = document.getElementById('atom-visual-root');
if (mountNode) {
  createRoot(mountNode).render(<AtomViewRoot />);
}
