import * as THREE from 'three';
import { jitter } from '../utils/math.js';
import { buildLoopPoints, buildBlotPoints } from '../utils/scene.js';
import {
  createBondMaterial,
  createNodeOutlineMaterial,
  createNodeVolumeMaterial,
  createDustMaterial,
} from './materials.js';

const BOND_SAMPLE_STEPS = 20;

function pointsToVector3Array(points, z = 0) {
  return points.map((point) => new THREE.Vector3(point.x, point.y, z));
}

// Same hand-sketched wobble loop as before, but as an outline only — the volumetric node builds
// its "fill" separately from a lit sphere instead, so these rings don't need their own flat fill.
function buildLoopOutline(radius, seed) {
  const points = buildLoopPoints(radius, seed);
  const vectors = pointsToVector3Array(points);
  vectors.push(vectors[0].clone());
  const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  return new THREE.Line(geometry, createNodeOutlineMaterial());
}

// Three tilt axes for the hand-sketched wobble rings below — chosen so their combination reads
// as a rounded 3D form (an "armillary sphere") from any viewing angle, instead of the flat disc
// a single loop in the XY plane always looked like regardless of camera angle.
const RING_TILTS = [
  { axis: new THREE.Vector3(1, 0, 0), angle: 0 },
  { axis: new THREE.Vector3(0.2, 1, 0).normalize(), angle: Math.PI * 0.42 },
  { axis: new THREE.Vector3(1, 0.3, 0.6).normalize(), angle: Math.PI * 0.31 },
];

// A node (atom or nucleus): a softly lit sphere for volume, read via the scene's
// hemisphere/key lights, plus the wobble-ring outlines tilted around it for the sketchy line
// texture. Replaces the old flat single-plane loop shapes.
function buildVolumetricNode(outerRadius, innerRadius, seed) {
  const group = new THREE.Group();

  const volume = new THREE.Mesh(
    new THREE.SphereGeometry(outerRadius * 0.8, 14, 10),
    createNodeVolumeMaterial(),
  );
  group.add(volume);

  const radii = [outerRadius, outerRadius * 0.92, innerRadius];
  RING_TILTS.forEach((tilt, index) => {
    const ring = buildLoopOutline(radii[index], seed + index * 137);
    ring.quaternion.setFromAxisAngle(tilt.axis, tilt.angle);
    group.add(ring);
  });

  return group;
}

// Approximates buildBondPath's cubic-bezier wobble (scene.js) in 3D: same seeded control-point
// jitter, sampled into a CatmullRomCurve3 instead of an SVG "C" command.
function buildBondCurvePoints(endPosition, variant, seed) {
  const end = endPosition;
  const length = end.length() || 1;
  const direction = end.clone().divideScalar(length);
  const arbitraryAxis = Math.abs(direction.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(direction, arbitraryAxis).normalize();

  const curve = jitter(seed + variant * 7.1, 6) + jitter(seed + variant * 11.1, 5);
  const start = new THREE.Vector3(
    jitter(seed + variant * 2.1, 4),
    jitter(seed + variant * 3.1, 4),
    jitter(seed + variant * 4.1, 4),
  );
  const controlOne = end
    .clone()
    .multiplyScalar(0.28 + variant * 0.025)
    .add(normal.clone().multiplyScalar(curve * 0.85));
  const controlTwo = end
    .clone()
    .multiplyScalar(0.68 - variant * 0.02)
    .add(normal.clone().multiplyScalar(curve * 0.45));

  const curve3 = new THREE.CatmullRomCurve3([start, controlOne, controlTwo, end]);
  return curve3.getPoints(BOND_SAMPLE_STEPS);
}

function buildBondMesh(endPosition, variant, seed) {
  const points = buildBondCurvePoints(endPosition, variant, seed);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, createBondMaterial());
}

export function createAtomMesh(atom, bondLength) {
  const group = new THREE.Group();
  group.name = `atom-${atom.id}`;

  const localPosition = atom.baseDirection.clone().multiplyScalar(bondLength);

  for (let variant = 0; variant < 2; variant += 1) {
    group.add(buildBondMesh(localPosition, variant, atom.seed));
  }

  const nodeGroup = new THREE.Group();
  nodeGroup.position.copy(localPosition);
  nodeGroup.add(buildVolumetricNode(atom.node, atom.node * 0.84, atom.seed + 201));
  group.add(nodeGroup);

  group.userData.atomId = atom.id;
  group.userData.nodeGroup = nodeGroup;
  group.userData.localPosition = localPosition;

  return group;
}

export function createNucleusMesh() {
  const group = new THREE.Group();
  group.name = 'nucleus';

  const blotSeeds = [
    [13.2, 501],
    [10.7, 613],
    [7.9, 727],
  ];

  for (const [radius, seed] of blotSeeds) {
    const points = pointsToVector3Array(buildBlotPoints(radius, seed));
    points.push(points[0].clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(geometry, createNodeOutlineMaterial()));
  }

  group.add(buildVolumetricNode(14.8, 12.9, 811));

  return group;
}

export function createDustPoints() {
  const dust = [
    { x: -22, y: 28, r: 1.4 },
    { x: 10, y: -20, r: 1.2 },
    { x: 28, y: 14, r: 1.2 },
    { x: -36, y: -10, r: 0.95 },
    { x: 44, y: -8, r: 1 },
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(
    dust.map((point) => new THREE.Vector3(point.x, point.y, 0)),
  );

  return new THREE.Points(geometry, createDustMaterial());
}
