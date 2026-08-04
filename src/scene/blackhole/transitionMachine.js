// Pure, THREE-independent state machine for the "fly to a target atom" transition — a spaceship
// approach, not an absorption effect: the camera travels through space toward the atom and stops
// just short of it, like closing in on a planet.
//
//   idle -> charging -> collapsing -> arrived
//     ^                                  |
//     |______________ reversing _________|
//
// Renderer/camera code drives this with tick(state, dtMs) each frame and reads `phase`/
// `progress`/`targetAtomId` to decide what to draw. Keeping it decoupled from THREE means the
// phase transitions and interrupt behavior (re-click, ESC, A->B retarget) can be unit tested
// with `node --test` without a WebGL context. See .claude/plans/binary-leaping-wind.md.

export const PHASE = Object.freeze({
  IDLE: 'idle',
  CHARGING: 'charging',
  COLLAPSING: 'collapsing',
  ARRIVED: 'arrived',
  REVERSING: 'reversing',
});

// Preamble before the flight commits — short enough that a re-click here can cancel with nothing
// to undo.
export const CHARGE_DURATION_MS = 320;
// Total flight: camera travels from home toward the target and arrives.
export const COLLAPSE_DURATION_MS = 1050;
// Reverse (ESC / close): symmetric-ish quick return, scaled from wherever progress was
// interrupted, so a close mid-flight doesn't take as long as a full arrived -> idle reverse.
export const REVERSE_DURATION_MS = 380;

export function createTransitionState() {
  return {
    phase: PHASE.IDLE,
    targetAtomId: null,
    progress: 0,
    elapsedMs: 0,
    reverseFrom: 0,
  };
}

// Click dispatch — reducedMotion short-circuits straight to/from ARRIVED with no camera flight,
// per the explicit "즉시 컷" decision.
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
      // Retarget mid-flight: progress is deliberately NOT reset (the camera spring keeps
      // chasing whatever the current target is, so swapping targets produces no pop — the
      // ship just banks toward the new destination).
      return { ...state, phase: PHASE.COLLAPSING, targetAtomId: atomId };

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
    progress: state.progress,
    elapsedMs: 0,
    reverseFrom: state.progress,
  };
}

export function tick(state, dtMs) {
  const safeDt = Math.max(0, dtMs);

  switch (state.phase) {
    case PHASE.CHARGING: {
      const elapsedMs = state.elapsedMs + safeDt;
      const progress = Math.min(1, elapsedMs / CHARGE_DURATION_MS);
      if (progress >= 1) {
        return { ...state, phase: PHASE.COLLAPSING, elapsedMs: 0, progress: 0 };
      }
      return { ...state, elapsedMs, progress };
    }

    case PHASE.COLLAPSING: {
      const elapsedMs = state.elapsedMs + safeDt;
      const progress = Math.min(1, elapsedMs / COLLAPSE_DURATION_MS);
      if (progress >= 1) {
        return { ...state, phase: PHASE.ARRIVED, elapsedMs, progress: 1 };
      }
      return { ...state, elapsedMs, progress };
    }

    case PHASE.REVERSING: {
      const elapsedMs = state.elapsedMs + safeDt;
      const reverseFraction = Math.min(1, elapsedMs / REVERSE_DURATION_MS);
      if (reverseFraction >= 1) {
        return createTransitionState();
      }
      return { ...state, elapsedMs, progress: state.reverseFrom * (1 - reverseFraction) };
    }

    default:
      return state;
  }
}

export function isTransitioning(state) {
  return state.phase !== PHASE.IDLE;
}
