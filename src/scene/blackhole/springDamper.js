// Framerate-independent-ish damped harmonic oscillator, integrated per-frame with a moving
// target — this is what lets the collapsing camera fly-to keep chasing an atom's live world
// position (it keeps orbiting during the transition, per design) without any position/velocity
// discontinuity when the target changes, which is also how the A->B direct crossfade and the
// ESC/close reverse avoid a "pop": only the target changes, the spring itself never resets.
//
// dampingRatio = 1 is critically damped (reaches the target as fast as possible with no
// overshoot) — the only value the design system's "no linear/ease-in-out" rule allows here.

const MAX_DT_MS = 48; // clamp to avoid a stability blow-up after a stalled/backgrounded frame

export function createSpringScalar(value = 0) {
  return { value, velocity: 0 };
}

export function stepSpringScalar(spring, target, dtMs, angularFrequency = 14, dampingRatio = 1) {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS) / 1000;
  if (dt <= 0) {
    return spring;
  }
  const displacement = spring.value - target;
  const accel = -2 * dampingRatio * angularFrequency * spring.velocity
    - angularFrequency * angularFrequency * displacement;
  const velocity = spring.velocity + accel * dt;
  const value = spring.value + velocity * dt;
  return { value, velocity };
}

export function createSpringVector3(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0 };
}

export function stepSpringVector3(spring, target, dtMs, angularFrequency = 14, dampingRatio = 1) {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS) / 1000;
  if (dt <= 0) {
    return spring;
  }
  const next = { x: spring.x, y: spring.y, z: spring.z, vx: spring.vx, vy: spring.vy, vz: spring.vz };
  for (const [axis, velocityAxis] of [['x', 'vx'], ['y', 'vy'], ['z', 'vz']]) {
    const displacement = spring[axis] - target[axis];
    const accel = -2 * dampingRatio * angularFrequency * spring[velocityAxis]
      - angularFrequency * angularFrequency * displacement;
    next[velocityAxis] = spring[velocityAxis] + accel * dt;
    next[axis] = spring[axis] + next[velocityAxis] * dt;
  }
  return next;
}
