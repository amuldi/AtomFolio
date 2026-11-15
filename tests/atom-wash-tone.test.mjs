import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWashTone } from '../src/components/atom/washTone.js';

test('wash tone: flat for ~0% and unknown returns, no glow', () => {
  for (const value of [0, 0.01, null, Number.NaN]) {
    const tone = resolveWashTone(value);
    assert.equal(tone.className, 'node-wash is-flat');
    assert.equal(tone.glow, 0);
  }
});

test('wash tone: red up, blue down', () => {
  assert.equal(resolveWashTone(12).className, 'node-wash is-up');
  assert.equal(resolveWashTone(-12).className, 'node-wash is-down');
  assert.equal(resolveWashTone(12).direction, 1);
  assert.equal(resolveWashTone(-12).direction, -1);
});

test('wash tone: bigger moves paint stronger and glow brighter, capped at 1', () => {
  const small = resolveWashTone(2);
  const mid = resolveWashTone(15);
  const big = resolveWashTone(60);
  assert.equal(small.glow, 0);
  assert.ok(mid.strength > small.strength);
  assert.ok(big.strength > mid.strength);
  assert.ok(big.glow > mid.glow && mid.glow > 0);
  assert.equal(big.strength, 1);
  assert.equal(big.glow, 1);
  assert.deepEqual(
    { s: resolveWashTone(-30).strength, g: resolveWashTone(-30).glow },
    { s: resolveWashTone(30).strength, g: resolveWashTone(30).glow },
  );
});
