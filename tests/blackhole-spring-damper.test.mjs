import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSpringScalar,
  stepSpringScalar,
  createSpringVector3,
  stepSpringVector3,
} from '../src/scene/blackhole/springDamper.js';

test('a spring already at rest at its target stays there', () => {
  const spring = createSpringScalar(10);
  const next = stepSpringScalar(spring, 10, 16);
  assert.equal(next.value, 10);
  assert.equal(next.velocity, 0);
});

test('a critically damped spring converges to a fixed target without overshooting', () => {
  let spring = createSpringScalar(0);
  const target = 100;
  let maxValue = -Infinity;

  for (let i = 0; i < 240; i += 1) {
    spring = stepSpringScalar(spring, target, 16, 14, 1);
    maxValue = Math.max(maxValue, spring.value);
  }

  assert.ok(Math.abs(spring.value - target) < 0.01, `expected convergence, got ${spring.value}`);
  assert.ok(maxValue <= target + 1e-6, `critically damped spring should not overshoot, peaked at ${maxValue}`);
});

test('a spring keeps chasing a target that moves every frame (no discontinuity on retarget)', () => {
  let spring = createSpringScalar(0);
  for (let i = 0; i < 60; i += 1) {
    // moving target, like an atom's live world position during collapsing
    spring = stepSpringScalar(spring, i, 16, 14, 1);
  }
  const beforeRetarget = { ...spring };
  // simulate an A->B crossfade: the target jumps far away in one frame (unlike the smooth
  // per-frame tracking above) — the spring must still continue from its current
  // position/velocity rather than snapping to the new target, even though a single stiff step
  // moves it a lot.
  const afterRetarget = stepSpringScalar(spring, 500, 16, 14, 1);

  assert.notEqual(afterRetarget.value, 500, 'must not snap straight to the new target');
  assert.ok(
    Math.abs(afterRetarget.value - beforeRetarget.value) < Math.abs(500 - beforeRetarget.value),
    'one frame of a critically damped spring should move only partway toward a far new target',
  );
});

test('retargeting alone (zero dt) never changes position or velocity — only future steps do', () => {
  const spring = stepSpringScalar(createSpringScalar(0), 10, 16, 14, 1);
  const untouched = stepSpringScalar(spring, 9999, 0, 14, 1);
  assert.deepEqual(untouched, spring);
});

test('zero or negative dt is a no-op', () => {
  const spring = createSpringScalar(5);
  assert.deepEqual(stepSpringScalar(spring, 100, 0), spring);
  assert.deepEqual(stepSpringScalar(spring, 100, -16), spring);
});

test('a very large dt (e.g. a stalled/backgrounded frame) is clamped, not unstable', () => {
  const spring = createSpringScalar(0);
  const next = stepSpringScalar(spring, 100, 5000, 14, 1);
  assert.ok(Number.isFinite(next.value));
  assert.ok(Number.isFinite(next.velocity));
});

test('vector3 spring converges on all three axes independently', () => {
  let spring = createSpringVector3(0, 0, 0);
  const target = { x: 10, y: -20, z: 5 };
  for (let i = 0; i < 240; i += 1) {
    spring = stepSpringVector3(spring, target, 16, 14, 1);
  }
  assert.ok(Math.abs(spring.x - target.x) < 0.01);
  assert.ok(Math.abs(spring.y - target.y) < 0.01);
  assert.ok(Math.abs(spring.z - target.z) < 0.01);
});
