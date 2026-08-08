// Shared by the web app (src/App.jsx) and the desktop menu-bar widget
// (desktop/src/renderer/atom-view.jsx, imported by relative path the same way that file already
// pulls in AtomSketch/generateAtomLayout from src/) — one dissolve/materialize implementation, not
// two. Pure JS + React hooks only, no DOM/Electron-specific APIs, so it works unmodified in both.
//
// Core idea: size and rotation speed move in opposite directions on purpose. Dissolving something
// spins it up as it shrinks away (like it's being flung into a point); materializing something
// spins down as it grows into place (like it's decelerating into rest). Dissolve eases in
// (accelerates); materialize eases out (decelerates) — that pairing is intentional, not
// interchangeable with a generic spring.
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 420;
// How much faster than normal idle rotation gets at the peak of a transition (dissolve ends here,
// materialize starts here).
const DEFAULT_ROTATION_BOOST = 3.4;

function easeInCubic(t) {
  return t * t * t;
}

function easeOutCubic(t) {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @returns {{
 *   scale: number,                     // 1 at rest; animates 1->0 dissolving, 0->1 materializing
 *   phase: 'idle' | 'dissolving' | 'materializing',
 *   rotationSpeedMultiplierRef: {current: number}, // see below for why this one's a ref
 *   dissolve: () => Promise<void>,
 *   materialize: () => Promise<void>,
 * }}
 *
 * scale/phase are plain useState — both callers already re-render on every animation frame for
 * their own rotation loop (App.jsx and atom-view.jsx each hold a `frameTime` state updated from
 * their rAF loop specifically so the SVG scene re-renders continuously), so piggybacking one more
 * state value on that existing cadence costs nothing extra.
 *
 * rotationSpeedMultiplier is a ref instead, because it has a different consumer: the *inside* of
 * that same long-lived rAF loop, which reads it every frame to scale AUTO_ROTATE_SPEED. That
 * effect has an empty dependency array (restarting the whole rotation rig every time the
 * multiplier ticked would blow away in-flight rotation/spin state 60 times over one 420ms
 * transition) — a captured useState value in that closure would just be frozen at mount. A ref
 * sidesteps that entirely: the rAF loop reads rotationSpeedMultiplierRef.current fresh every
 * frame, no re-subscription needed.
 */
export function useAtomTransition({
  durationMs = DEFAULT_DURATION_MS,
  rotationBoost = DEFAULT_ROTATION_BOOST,
} = {}) {
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState('idle');
  const rotationSpeedMultiplierRef = useRef(1);
  const frameRef = useRef(null);

  const stop = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  // Unmounting mid-transition (widget closed via some other path, component swapped out) must not
  // leave a dangling rAF callback writing state into a gone component.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    (nextPhase) =>
      new Promise((resolve) => {
        stop();

        if (prefersReducedMotion()) {
          // Snap straight to the transition's end state — no in-between frames to skip through.
          setPhase('idle');
          setScale(nextPhase === 'dissolving' ? 0 : 1);
          rotationSpeedMultiplierRef.current = 1;
          resolve();
          return;
        }

        setPhase(nextPhase);
        const start = performance.now();

        const step = (now) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = nextPhase === 'dissolving' ? easeInCubic(t) : easeOutCubic(t);

          if (nextPhase === 'dissolving') {
            setScale(1 - eased);
            rotationSpeedMultiplierRef.current = 1 + eased * (rotationBoost - 1);
          } else {
            setScale(eased);
            rotationSpeedMultiplierRef.current = rotationBoost - eased * (rotationBoost - 1);
          }

          if (t < 1) {
            frameRef.current = requestAnimationFrame(step);
          } else {
            frameRef.current = null;
            setPhase('idle');
            resolve();
          }
        };

        // Starting a new phase always cancels whatever was running (stop() above) and begins this
        // one from t=0 — the minimum bar for "interruptible" (a stray in-flight animation can
        // never keep fighting a new one), not a seamless crossfade from wherever the old one's
        // scale/rotation happened to be. In practice callers only ever start a fresh
        // dissolve/materialize once the previous one's promise has already resolved, so this
        // doesn't visibly jump.
        frameRef.current = requestAnimationFrame(step);
      }),
    [durationMs, rotationBoost, stop],
  );

  const dissolve = useCallback(() => run('dissolving'), [run]);
  const materialize = useCallback(() => run('materializing'), [run]);

  return { scale, phase, rotationSpeedMultiplierRef, dissolve, materialize };
}
