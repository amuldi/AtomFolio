import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAtomLayout } from '../src/utils/scene.js';

const items = [
  { id: 'a', label: 'A', shares: 100, value: 1000 },
  { id: 'b', label: 'B', shares: 10, value: 9000 },
  { id: 'c', label: 'C', shares: 40, value: 2000 },
];
const byLabel = (atoms) => Object.fromEntries(atoms.map((atom) => [atom.label, atom]));

test('electron size follows quantity: fewer shares, smaller electron', () => {
  const atoms = byLabel(
    generateAtomLayout(items, { sizeFor: (item) => item.shares, weightFor: (item) => item.value }),
  );
  assert.ok(atoms.A.node > atoms.C.node);
  assert.ok(atoms.C.node > atoms.B.node);
  assert.equal(atoms.A.sizeRatio, 1);
  // The label share still reports market-value weight, not quantity.
  assert.equal(atoms.B.weightShare, 9000 / 12000);
});

test('electron size falls back to weight when no quantities are known', () => {
  const atoms = byLabel(
    generateAtomLayout(items, { sizeFor: () => 0, weightFor: (item) => item.value }),
  );
  assert.ok(atoms.B.node > atoms.C.node);
  assert.ok(atoms.C.node > atoms.A.node);
});
