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
// Absolute peak angular velocity (radians/second) a transition spins at — NOT a multiplier on
// AUTO_ROTATE_SPEED. AUTO_ROTATE_SPEED is tuned for a barely-perceptible ambient drift; even a
// 3-4x multiplier on that over one ~420ms transition works out to a rotation too small to
// register (the scale change reads clearly, the spin doesn't). This value is added on top of
// idle rotation instead, sized against the transition's own duration — independent of whatever
// AUTO_ROTATE_SPEED happens to be tuned to. For a cubic ease applied over durationMs, the swept
// angle works out to peakAngularVelocity * durationMs / 4 (the ease curve's average is 1/4 of its
// peak) — at 90 rad/s and the default 420ms duration that's ~9.4 rad, about 1.5 full turns per
// dissolve or materialize. Measured directly (accumulating the actual per-frame angle applied in
// the desktop widget's rotation rig over a live dissolve+materialize) rather than judged by eye,
// since this environment's screen capture can't be trusted for that; landed in the middle of the
// "roughly 1-2 revolutions per transition" target.
const TRANSITION_PEAK_ANGULAR_VELOCITY = 90;

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
 *   scale: number,                        // 1 at rest; animates 1->0 dissolving, 0->1 materializing
 *   phase: 'idle' | 'dissolving' | 'materializing',
 *   transitionAngularVelocityRef: {current: number}, // radians/second; see below for why a ref
 *   dissolve: () => Promise<void>,
 *   materialize: () => Promise<void>,
 * }}
 *
 * scale/phase are plain useState — both callers already re-render on every animation frame for
 * their own rotation loop (App.jsx and atom-view.jsx each hold a `frameTime` state updated from
 * their rAF loop specifically so the SVG scene re-renders continuously), so piggybacking one more
 * state value on that existing cadence costs nothing extra.
 *
 * transitionAngularVelocity is a ref instead, because it has a different consumer: the *inside*
 * of that same long-lived rAF loop, which reads it every frame to spin the atom an extra
 * `delta * transitionAngularVelocityRef.current` radians, additively, on top of whatever idle
 * rotation it already applies. That effect has an empty dependency array (restarting the whole
 * rotation rig every time this value ticked would blow away in-flight rotation/spin state 60
 * times over one 420ms transition) — a captured useState value in that closure would just be
 * frozen at mount. A ref sidesteps that entirely: the rAF loop reads
 * transitionAngularVelocityRef.current fresh every frame, no re-subscription needed.
 */
export function useAtomTransition({
  durationMs = DEFAULT_DURATION_MS,
  peakAngularVelocity = TRANSITION_PEAK_ANGULAR_VELOCITY,
} = {}) {
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState('idle');
  const transitionAngularVelocityRef = useRef(0);
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
          // Snap straight to the transition's end state — no in-between frames to skip through,
          // no spin either.
          setPhase('idle');
          setScale(nextPhase === 'dissolving' ? 0 : 1);
          transitionAngularVelocityRef.current = 0;
          resolve();
          return;
        }

        setPhase(nextPhase);
        const start = performance.now();

        const step = (now) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = nextPhase === 'dissolving' ? easeInCubic(t) : easeOutCubic(t);

          if (nextPhase === 'dissolving') {
            // Spins up from a standstill to peak as it shrinks away — eased *is* how far along
            // that acceleration is, so it doubles directly as the velocity fraction.
            setScale(1 - eased);
            transitionAngularVelocityRef.current = eased * peakAngularVelocity;
          } else {
            // Arrives already spinning at peak and decelerates to a standstill as it grows in —
            // the mirror image of dissolve's ramp-up, so it's peak minus the same eased fraction
            // rather than a separate curve.
            setScale(eased);
            transitionAngularVelocityRef.current = (1 - eased) * peakAngularVelocity;
          }

          if (t < 1) {
            frameRef.current = requestAnimationFrame(step);
          } else {
            frameRef.current = null;
            setPhase('idle');
            // Materialize's own formula already lands on exactly 0 here, but dissolve's does the
            // opposite — it *ends* at full peak velocity (still spinning fastest right as it
            // vanishes) and nothing else ever zeroes it back out. Left alone, the consuming rAF
            // loop keeps applying that leftover peak spin to a scale-0/invisible atom forever
            // (the loop itself has no idea the transition "finished", it just keeps reading
            // whatever's in the ref) — wasted work on a hidden window, not merely a rounding nit.
            transitionAngularVelocityRef.current = 0;
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
    [durationMs, peakAngularVelocity, stop],
  );

  const dissolve = useCallback(() => run('dissolving'), [run]);
  const materialize = useCallback(() => run('materializing'), [run]);

  return { scale, phase, transitionAngularVelocityRef, dissolve, materialize };
}
