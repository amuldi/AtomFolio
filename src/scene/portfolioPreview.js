import * as THREE from 'three';
import { generateAtomLayout, buildLoopPoints } from '../utils/scene.js';
import { createNodeOutlineMaterial, createNodeFillMaterial } from './materials.js';
import { createPortfolioPreviewHitMesh } from './raycastInteraction.js';

// Fixed positions for "other portfolio" previews — distant destinations for the fly-to
// transition. Expressed as (lateral offset, depth beyond the origin) rather than a raw 3D
// direction: the camera's FOV is only 32°, so a direction picked without regard for the camera's
// actual viewing cone easily lands well outside the frustum and never renders on screen (this
// was a real bug the first time around — verified via a temporary debug probe that the meshes
// existed but were positioned ~31° off the camera's forward axis, past the ~16° half-FOV).
// `depth` keeps these clearly behind the main atom scene (which sits within ~214 units of the
// origin); `lateral` stays within roughly half the frustum's radius at that depth for a safe
// on-screen margin. Mounted directly under `scene` (not the rotating atom rig), so they read as
// fixed points in space, the same way the warp-streak starfield does.
const PREVIEW_SLOTS = [
  { lateral: [120, 60], depth: 480, scale: 1 },
  { lateral: [-140, 30], depth: 620, scale: 0.9 },
  { lateral: [90, -110], depth: 560, scale: 0.94 },
  { lateral: [-90, 130], depth: 760, scale: 0.8 },
  { lateral: [160, -40], depth: 900, scale: 0.72 },
  { lateral: [-170, -70], depth: 700, scale: 0.84 },
  { lateral: [40, 150], depth: 1000, scale: 0.66 },
  { lateral: [130, 100], depth: 1100, scale: 0.6 },
  { lateral: [-120, -130], depth: 950, scale: 0.68 },
  { lateral: [180, 20], depth: 1200, scale: 0.55 },
  { lateral: [-60, 170], depth: 850, scale: 0.74 },
  { lateral: [60, -170], depth: 1050, scale: 0.62 },
];

const CLUSTER_NODE_COUNT = 5;
const CLUSTER_SPREAD = 16;
const HIT_RADIUS = 90;

function hashStringToSeed(value) {
  let hash = 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function buildMiniLoopMesh(radius, seed) {
  const points = buildLoopPoints(radius, seed);
  const vectors = points.map((point) => new THREE.Vector3(point.x, point.y, 0));
  vectors.push(vectors[0].clone());

  const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y)));
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), createNodeFillMaterial());
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vectors), createNodeOutlineMaterial());

  const group = new THREE.Group();
  group.add(fill, outline);
  return group;
}

export function getPortfolioPreviewSlot(index) {
  return PREVIEW_SLOTS[index % PREVIEW_SLOTS.length];
}

export function createPortfolioPreviewMesh(entry, slot) {
  const group = new THREE.Group();
  group.name = `portfolio-preview-${entry.id}`;

  const seed = hashStringToSeed(entry.id);
  const holdings = generateAtomLayout(entry.items).slice(0, CLUSTER_NODE_COUNT);
  const nodeCount = Math.max(holdings.length, 1);

  for (let i = 0; i < nodeCount; i += 1) {
    const holding = holdings[i];
    const nodeSeed = (holding?.seed ?? seed) + i * 41;
    const angle = (i / nodeCount) * Math.PI * 2 + seed * 0.01;
    const localRadius = CLUSTER_SPREAD * (0.55 + (i % 3) * 0.22);
    const node = buildMiniLoopMesh(2.6 + (i % 2) * 1.1, nodeSeed);
    node.position.set(Math.cos(angle) * localRadius, Math.sin(angle) * localRadius * 0.7, Math.sin(nodeSeed) * 6);
    group.add(node);
  }

  group.add(buildMiniLoopMesh(5.5, seed + 900));

  const scale = slot.scale ?? 1;
  group.scale.setScalar(scale);

  const hitMesh = createPortfolioPreviewHitMesh(entry.id, HIT_RADIUS);
  group.add(hitMesh);

  group.userData.entryId = entry.id;
  group.userData.hitMesh = hitMesh;
  return group;
}

export function positionPortfolioPreviewMesh(mesh, slot) {
  const [lateralX, lateralY] = slot.lateral;
  // world z counts down from the origin, away from the camera (the camera sits at +z looking
  // toward -z, see createRenderer.js's CAMERA_HOME_POSITION/CAMERA_HOME_LOOKAT).
  const position = new THREE.Vector3(lateralX, lateralY, -slot.depth);
  mesh.position.copy(position);
  mesh.userData.localPosition = position;
  return position;
}
