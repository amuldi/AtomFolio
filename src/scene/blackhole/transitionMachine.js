// Pure, THREE-independent state machine for the black-hole absorption transition:
//
//   idle -> charging -> collapsing -> arrived
//     ^                                  |
//     |______________ reversing _________|
//
// Renderer/camera code drives this with tick(state, dtMs) each frame and reads `phase`/
// `progress`/`targetAtomId` to decide what to draw. Keeping it decoupled from THREE means the
// phase transitions and interrupt behavior (re-click, ESC, A->B crossfade) can be unit tested
// with `node --test` without a WebGL context. See .claude/plans/binary-leaping-wind.md.

export const PHASE = Object.freeze({
  IDLE: 'idle',
  CHARGING: 'charging',
  COLLAPSING: 'collapsing',
  ARRIVED: 'arrived',
  REVERSING: 'reversing',
});

// Preamble before the heavy collapse commits — short enough that a re-click here can cancel
// with nothing to undo.
export const CHARGE_DURATION_MS = 320;
// Total collapse: camera fly-to + radial distortion + particle swirl convergence.
export const COLLAPSE_DURATION_MS = 1050;
// Reverse (ESC / close): symmetric-ish quick return, scaled from wherever progress was
// interrupted, so a close mid-collapse doesn't take as long as a full arrived -> idle reverse.
export const REVERSE_DURATION_MS = 380;
// A->B crossfade: how long the released atom's "emit" fade-back-to-orbit visual runs, decoupled
// from the new target's collapse progress (which is not reset, per design).
export const RELEASE_DURATION_MS = 180;

export function createTransitionState() {
  return {
    phase: PHASE.IDLE,
    targetAtomId: null,
    releasingAtomId: null,
    releaseElapsedMs: 0,
    progress: 0,
    elapsedMs: 0,
    reverseFrom: 0,
  };
}

// Click dispatch — reducedMotion short-circuits straight to/from ARRIVED with no shader/camera
// fly/particle work, per the explicit "즉시 컷" decision.
export function selectAtom(state, atomId, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    if (state.phase !== PHASE.IDLE && state.targetAtomId === atomId) {
      return createTransitionState();
    }
    return { ...createTransitionState(), phase: PHASE.ARRIVED, targetAtomId: atomId, progress: 1 };
  }

  switch (state.phase) {
    case PHASE.IDLE:
      return { ...createTransitionState(), phase: PHASE.CHARGING, targetAtomId: atomId };

    case PHASE.CHARGING:
      // Nothing committed yet at this phase, so re-clicking the same atom cancels outright
      // rather than reversing; clicking a different atom just restarts the preamble on it.
      if (state.targetAtomId === atomId) {
        return createTransitionState();
      }
      return { ...createTransitionState(), phase: PHASE.CHARGING, targetAtomId: atomId };

    case PHASE.COLLAPSING:
    case PHASE.ARRIVED:
      if (state.targetAtomId === atomId) {
        return beginReverse(state);
      }
      // Direct A->B crossfade: progress is deliberately NOT reset (spring keeps chasing, so
      // retargeting produces no pop), only the target and a short release fade for A.
      return {
        ...state,
        phase: PHASE.COLLAPSING,
        targetAtomId: atomId,
        releasingAtomId: state.targetAtomId,
        releaseElapsedMs: 0,
      };

    case PHASE.REVERSING:
      return { ...createTransitionState(), phase: PHASE.CHARGING, targetAtomId: atomId };

    default:
      return state;
  }
}

export function requestClose(state, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    return createTransitionState();
  }
  if (state.phase === PHASE.CHARGING) {
    return createTransitionState();
  }
  if (state.phase === PHASE.COLLAPSING || state.phase === PHASE.ARRIVED) {
    return beginReverse(state);
  }
  return state;
}

function beginReverse(state) {
  return {
    phase: PHASE.REVERSING,
    targetAtomId: state.targetAtomId,
    releasingAtomId: null,
    releaseElapsedMs: 0,
    progress: state.progress,
    elapsedMs: 0,
    reverseFrom: state.progress,
  };
}

export function tick(state, dtMs) {
  const safeDt = Math.max(0, dtMs);
  let next = state;

  if (next.releasingAtomId) {
    const releaseElapsedMs = next.releaseElapsedMs + safeDt;
    next = releaseElapsedMs >= RELEASE_DURATION_MS
      ? { ...next, releasingAtomId: null, releaseElapsedMs: 0 }
      : { ...next, releaseElapsedMs };
  }

  switch (next.phase) {
    case PHASE.CHARGING: {
      const elapsedMs = next.elapsedMs + safeDt;
      const progress = Math.min(1, elapsedMs / CHARGE_DURATION_MS);
      if (progress >= 1) {
        return { ...next, phase: PHASE.COLLAPSING, elapsedMs: 0, progress: 0 };
      }
      return { ...next, elapsedMs, progress };
    }

    case PHASE.COLLAPSING: {
      const elapsedMs = next.elapsedMs + safeDt;
      const progress = Math.min(1, elapsedMs / COLLAPSE_DURATION_MS);
      if (progress >= 1) {
        return { ...next, phase: PHASE.ARRIVED, elapsedMs, progress: 1 };
      }
      return { ...next, elapsedMs, progress };
    }

    case PHASE.REVERSING: {
      const elapsedMs = next.elapsedMs + safeDt;
      const reverseFraction = Math.min(1, elapsedMs / REVERSE_DURATION_MS);
      if (reverseFraction >= 1) {
        return createTransitionState();
      }
      return { ...next, elapsedMs, progress: next.reverseFrom * (1 - reverseFraction) };
    }

    default:
      return next;
  }
}

export function isTransitioning(state) {
  return state.phase !== PHASE.IDLE;
}

// 0..1 "how deep into the black hole" — drives both the distortion ShaderPass strength uniform
// and the particle swirl convergence factor across collapsing/arrived/reversing.
export function getDistortionStrength(state) {
  switch (state.phase) {
    case PHASE.COLLAPSING:
      return state.progress;
    case PHASE.ARRIVED:
      return 1;
    case PHASE.REVERSING:
      return state.progress;
    default:
      return 0;
  }
}

export function getReleaseProgress(state) {
  if (!state.releasingAtomId) {
    return 0;
  }
  return Math.min(1, state.releaseElapsedMs / RELEASE_DURATION_MS);
}
