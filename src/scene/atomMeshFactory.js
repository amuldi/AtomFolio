import * as THREE from 'three';
import { jitter } from '../utils/math.js';
import { buildBlotPoints } from '../utils/scene.js';
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

// A low-poly icosahedron (12 vertices, 30 edges) with every vertex bumped in/out along its own
// direction from center by a seeded jitter — an irregular hand-cut "gem" instead of a perfect
// geodesic sphere. A single coherent 3D mesh, not several independent flat loops: its edges are
// spread across the whole real surface, so there's no angle where it can degenerate into a flat
// sliver, and no risk of several overlapping wireframes cluttering the view or z-fighting when
// the camera gets close — both of which were real problems with the previous "several tilted
// rings" design (verified live: a box-shaped artifact from one ring going edge-on, and visible
// flicker/clutter up close from the layered lines).
function buildWobbledIcosphereGeometry(radius, seed) {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    vertex.multiplyScalar(1 + jitter(seed + i * 13.7, 0.16));
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A node (atom or nucleus): a softly lit "gem" mesh, read via the scene's hemisphere/key lights,
// plus its own edge wireframe for the sketchy line texture. Exported so portfolioPreview.js's
// distant clusters can build their nodes the same way, rather than the flat 2D loop shapes it
// used to use — those looked visibly inconsistent with the main scene and, up close during the
// fly-to transition, read as flat, edgeless blobs rather than a coherent 3D form.
export function buildVolumetricNode(radius, seed) {
  const group = new THREE.Group();

  const volume = new THREE.Mesh(buildWobbledIcosphereGeometry(radius * 0.86, seed), createNodeVolumeMaterial());
  group.add(volume);

  // Edges are built from a very slightly larger copy of the same shape, not the fill geometry
  // itself — coincident geometry z-fights/flickers, especially once the camera is close.
  const edgeGeometry = buildWobbledIcosphereGeometry(radius * 0.875, seed);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(edgeGeometry), createNodeOutlineMaterial());
  group.add(outline);

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
  nodeGroup.add(buildVolumetricNode(atom.node, atom.seed + 201));
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

  group.add(buildVolumetricNode(14.8, 811));

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
