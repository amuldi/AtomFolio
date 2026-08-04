import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PHASE,
  CHARGE_DURATION_MS,
  COLLAPSE_DURATION_MS,
  REVERSE_DURATION_MS,
  createTransitionState,
  selectAtom,
  requestClose,
  tick,
  isTransitioning,
} from '../src/scene/blackhole/transitionMachine.js';

test('idle: selecting an atom starts charging', () => {
  const state = selectAtom(createTransitionState(), 'atom-a');
  assert.equal(state.phase, PHASE.CHARGING);
  assert.equal(state.targetAtomId, 'atom-a');
  assert.equal(isTransitioning(state), true);
});

test('charging auto-advances to collapsing once its duration elapses', () => {
  let state = selectAtom(createTransitionState(), 'atom-a');
  state = tick(state, CHARGE_DURATION_MS - 1);
  assert.equal(state.phase, PHASE.CHARGING);
  assert.ok(state.progress < 1);

  state = tick(state, 1);
  assert.equal(state.phase, PHASE.COLLAPSING);
  assert.equal(state.progress, 0);
  assert.equal(state.elapsedMs, 0);
});

test('collapsing auto-advances to arrived once its duration elapses', () => {
  let state = { ...createTransitionState(), phase: PHASE.COLLAPSING, targetAtomId: 'atom-a' };
  state = tick(state, COLLAPSE_DURATION_MS - 1);
  assert.equal(state.phase, PHASE.COLLAPSING);
  assert.ok(state.progress < 1);

  state = tick(state, 1);
  assert.equal(state.phase, PHASE.ARRIVED);
  assert.equal(state.progress, 1);
});

test('re-clicking the same atom while charging cancels outright (nothing committed yet)', () => {
  let state = selectAtom(createTransitionState(), 'atom-a');
  state = tick(state, 50);
  state = selectAtom(state, 'atom-a');
  assert.deepEqual(state, createTransitionState());
});

test('clicking a different atom while charging restarts the preamble on the new target', () => {
  let state = selectAtom(createTransitionState(), 'atom-a');
  state = tick(state, 200);
  state = selectAtom(state, 'atom-b');
  assert.equal(state.phase, PHASE.CHARGING);
  assert.equal(state.targetAtomId, 'atom-b');
  assert.equal(state.progress, 0);
});

test('re-clicking the target atom while collapsing begins a reverse from the current progress', () => {
  let state = { ...createTransitionState(), phase: PHASE.COLLAPSING, targetAtomId: 'atom-a', progress: 0.4 };
  state = selectAtom(state, 'atom-a');
  assert.equal(state.phase, PHASE.REVERSING);
  assert.equal(state.reverseFrom, 0.4);
  assert.equal(state.progress, 0.4);
});

test('re-clicking the target atom while arrived begins a reverse from progress 1', () => {
  let state = { ...createTransitionState(), phase: PHASE.ARRIVED, targetAtomId: 'atom-a', progress: 1 };
  state = selectAtom(state, 'atom-a');
  assert.equal(state.phase, PHASE.REVERSING);
  assert.equal(state.reverseFrom, 1);
});

test('reversing decays progress to zero and returns to idle without ever overshooting below zero', () => {
  let state = { ...createTransitionState(), phase: PHASE.REVERSING, targetAtomId: 'atom-a', progress: 1, reverseFrom: 1 };
  state = tick(state, REVERSE_DURATION_MS / 2);
  assert.equal(state.phase, PHASE.REVERSING);
  assert.ok(state.progress > 0 && state.progress < 1);

  state = tick(state, REVERSE_DURATION_MS);
  assert.deepEqual(state, createTransitionState());
});

test('reversing from a partial collapse takes the same total duration but starts lower', () => {
  let state = { ...createTransitionState(), phase: PHASE.REVERSING, targetAtomId: 'atom-a', progress: 0.4, reverseFrom: 0.4 };
  state = tick(state, REVERSE_DURATION_MS / 2);
  assert.ok(state.progress > 0 && state.progress < 0.4);
});

test('clicking a different atom while collapsing/arrived retargets mid-flight without resetting progress', () => {
  let state = { ...createTransitionState(), phase: PHASE.COLLAPSING, targetAtomId: 'atom-a', progress: 0.6 };
  state = selectAtom(state, 'atom-b');
  assert.equal(state.phase, PHASE.COLLAPSING);
  assert.equal(state.targetAtomId, 'atom-b');
  assert.equal(state.progress, 0.6, 'progress must be preserved so the camera spring never pops');
});

test('clicking a different atom while arrived also retargets (not just while collapsing)', () => {
  let state = { ...createTransitionState(), phase: PHASE.ARRIVED, targetAtomId: 'atom-a', progress: 1 };
  state = selectAtom(state, 'atom-b');
  assert.equal(state.phase, PHASE.COLLAPSING);
  assert.equal(state.progress, 1);
  assert.equal(state.targetAtomId, 'atom-b');
});

test('clicking any atom while reversing cancels the reverse and starts a fresh charge', () => {
  let state = { ...createTransitionState(), phase: PHASE.REVERSING, targetAtomId: 'atom-a', progress: 0.5, reverseFrom: 0.5 };
  state = selectAtom(state, 'atom-b');
  assert.equal(state.phase, PHASE.CHARGING);
  assert.equal(state.targetAtomId, 'atom-b');
  assert.equal(state.progress, 0);
});

test('requestClose during charging cancels outright', () => {
  let state = selectAtom(createTransitionState(), 'atom-a');
  state = tick(state, 50);
  state = requestClose(state);
  assert.deepEqual(state, createTransitionState());
});

test('requestClose during collapsing/arrived begins a reverse', () => {
  const collapsing = { ...createTransitionState(), phase: PHASE.COLLAPSING, targetAtomId: 'atom-a', progress: 0.7 };
  assert.equal(requestClose(collapsing).phase, PHASE.REVERSING);

  const arrived = { ...createTransitionState(), phase: PHASE.ARRIVED, targetAtomId: 'atom-a', progress: 1 };
  assert.equal(requestClose(arrived).phase, PHASE.REVERSING);
});

test('requestClose while idle is a no-op', () => {
  const state = createTransitionState();
  assert.deepEqual(requestClose(state), state);
});

test('reducedMotion: selecting an atom jumps straight to arrived with no charging/collapsing', () => {
  const state = selectAtom(createTransitionState(), 'atom-a', { reducedMotion: true });
  assert.equal(state.phase, PHASE.ARRIVED);
  assert.equal(state.progress, 1);
});

test('reducedMotion: re-selecting the arrived atom jumps straight back to idle', () => {
  let state = selectAtom(createTransitionState(), 'atom-a', { reducedMotion: true });
  state = selectAtom(state, 'atom-a', { reducedMotion: true });
  assert.deepEqual(state, createTransitionState());
});

test('reducedMotion: requestClose always returns straight to idle', () => {
  const state = selectAtom(createTransitionState(), 'atom-a', { reducedMotion: true });
  assert.deepEqual(requestClose(state, { reducedMotion: true }), createTransitionState());
});

test('tick clamps negative dt to zero instead of moving state backwards', () => {
  const state = selectAtom(createTransitionState(), 'atom-a');
  const same = tick(state, -100);
  assert.deepEqual(same, state);
});
