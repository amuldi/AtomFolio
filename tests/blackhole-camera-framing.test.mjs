import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PHASE } from '../src/scene/blackhole/transitionMachine.js';
import { computeCameraFrame } from '../src/scene/blackhole/cameraFraming.js';

const HOME_POSITION = { x: 0, y: 0, z: 470 };
const HOME_LOOKAT = { x: 0, y: 0, z: 0 };
const ATOM_POSITION = { x: 100, y: 0, z: 0 };

test('idle: camera frame is exactly the home pose regardless of any atom position', () => {
  const frame = computeCameraFrame(PHASE.IDLE, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT);
  assert.deepEqual(frame, { position: HOME_POSITION, lookAt: HOME_LOOKAT });
});

test('idle: a missing atom position also falls back to home even if phase were wrong', () => {
  const frame = computeCameraFrame(PHASE.COLLAPSING, null, HOME_POSITION, HOME_LOOKAT);
  assert.deepEqual(frame, { position: HOME_POSITION, lookAt: HOME_LOOKAT });
});

test('charging: eases only partway toward the atom, not all the way', () => {
  const frame = computeCameraFrame(PHASE.CHARGING, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT);
  assert.ok(frame.lookAt.x > 0 && frame.lookAt.x < ATOM_POSITION.x);
  assert.notDeepEqual(frame.position, HOME_POSITION);
});

test('collapsing: looks straight at the atom and stops short of it, approaching from the home side', () => {
  const arrivalMargin = 70;
  const frame = computeCameraFrame(PHASE.COLLAPSING, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT, {
    arrivalMargin,
  });
  assert.deepEqual(frame.lookAt, ATOM_POSITION);

  const distanceToHome = Math.hypot(
    frame.position.x - HOME_POSITION.x,
    frame.position.y - HOME_POSITION.y,
    frame.position.z - HOME_POSITION.z,
  );
  const homeToAtomDistance = Math.hypot(
    ATOM_POSITION.x - HOME_POSITION.x,
    ATOM_POSITION.y - HOME_POSITION.y,
    ATOM_POSITION.z - HOME_POSITION.z,
  );
  assert.ok(
    distanceToHome < homeToAtomDistance,
    'the arrival point should be between home and the atom, not past the atom',
  );

  const distanceToAtom = Math.hypot(
    frame.position.x - ATOM_POSITION.x,
    frame.position.y - ATOM_POSITION.y,
    frame.position.z - ATOM_POSITION.z,
  );
  assert.ok(Math.abs(distanceToAtom - arrivalMargin) < 1e-6, 'should stop exactly arrivalMargin short of the atom');
});

test('arrived: identical framing to collapsing (a steady hold, not a further approach)', () => {
  const collapsing = computeCameraFrame(PHASE.COLLAPSING, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT);
  const arrived = computeCameraFrame(PHASE.ARRIVED, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT);
  assert.deepEqual(collapsing, arrived);
});

test('reversing: camera frame returns straight to home regardless of where the atom is', () => {
  const frame = computeCameraFrame(PHASE.REVERSING, ATOM_POSITION, HOME_POSITION, HOME_LOOKAT);
  assert.deepEqual(frame, { position: HOME_POSITION, lookAt: HOME_LOOKAT });
});
