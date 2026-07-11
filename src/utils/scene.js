import * as THREE from 'three';
import { noise, jitter, clamp, format, midpoint } from './math.js';
import {
  BOND_LENGTH,
  CAMERA_DISTANCE,
  CAMERA_NEAR_CLIP,
  TRACKBALL_RADIUS,
  GOLDEN_ANGLE,
  MIN_ATOMS,
  LOW_COUNT_LAYOUTS,
  DEFAULT_SCENE_CAMERA,
} from '../constants/scene.js';
import { filterPortfolioItemsForAtomScene } from './portfolioItems.js';

export function closedSketchPath(points) {
  const firstMid = midpoint(points[points.length - 1], points[0]);
  let path = `M ${format(firstMid.x)} ${format(firstMid.y)}`;

  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const currentMid = midpoint(points[index], next);
    path += ` Q ${format(points[index].x)} ${format(points[index].y)} ${format(
      currentMid.x,
    )} ${format(currentMid.y)}`;
  }

  return path;
}

export function openSketchPath(points) {
  if (points.length < 2) {
    return '';
  }

  let path = `M ${format(points[0].x)} ${format(points[0].y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentMid = midpoint(points[index], points[index + 1]);
    path += ` Q ${format(points[index].x)} ${format(points[index].y)} ${format(
      currentMid.x,
    )} ${format(currentMid.y)}`;
  }

  const last = points[points.length - 1];
  path += ` L ${format(last.x)} ${format(last.y)}`;
  return path;
}

export function buildAllocationArcPath({
  centerX,
  centerY,
  radius,
  startAngle,
  endAngle,
  seed,
  wobble = 2.4,
}) {
  const span = endAngle - startAngle;

  if (span <= 0.02) {
    return '';
  }

  const steps = Math.max(8, Math.ceil(span / (Math.PI / 18)));
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const angle = startAngle + span * progress;
    const radialOffset =
      Math.sin(seed * 0.031 + progress * Math.PI * 4.2) * wobble * 0.34 +
      jitter(seed + index * 3.17, wobble * 0.24);
    const tangentOffset = jitter(seed + 200 + index * 2.41, wobble * 0.16);
    const localRadius = radius + radialOffset;

    points.push({
      x:
        centerX +
        Math.cos(angle) * localRadius +
        Math.cos(angle + Math.PI / 2) * tangentOffset,
      y:
        centerY +
        Math.sin(angle) * localRadius +
        Math.sin(angle + Math.PI / 2) * tangentOffset,
    });
  }

  return openSketchPath(points);
}

export function buildLoopPath(radius, seed) {
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const ring = radius + jitter(seed + index * 1.19, radius * 0.22);
    points.push({
      x: Math.cos(angle) * ring + jitter(seed + index * 2.17, 0.92),
      y: Math.sin(angle) * ring + jitter(seed + index * 3.03, 0.92),
    });
  }

  return closedSketchPath(points);
}

export function buildBlotPath(radius, seed) {
  const points = [];

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const ring = radius + jitter(seed + index * 2.31, radius * 0.27);
    points.push({
      x: Math.cos(angle) * ring + jitter(seed + index * 3.3, 1.7),
      y: Math.sin(angle) * ring + jitter(seed + index * 4.4, 1.7),
    });
  }

  return closedSketchPath(points);
}

export function buildBondPath(atom, variant, phase) {
  const end = {
    x: atom.x + jitter(atom.seed + variant * 5.1, 1.8),
    y: atom.y + jitter(atom.seed + variant * 6.1, 1.8),
  };
  const length = Math.hypot(end.x, end.y) || 1;
  const direction = {
    x: end.x / length,
    y: end.y / length,
  };
  const normal = {
    x: -direction.y,
    y: direction.x,
  };
  const phaseWobble = Math.sin(phase + atom.seed * 0.11 + variant * 0.7) * 1.8;
  const depthCurve = (0.5 - atom.depth) * 14;
  const curve = depthCurve + phaseWobble + jitter(atom.seed + variant * 7.1, 6);
  const start = {
    x: jitter(atom.seed + variant * 2.1, 4),
    y: jitter(atom.seed + variant * 3.1, 4),
  };
  const controlOne = {
    x: end.x * (0.28 + variant * 0.025) + normal.x * (curve * 0.85),
    y: end.y * (0.28 + variant * 0.025) + normal.y * (curve * 0.85),
  };
  const controlTwo = {
    x:
      end.x * (0.68 - variant * 0.02) +
      normal.x * (curve * 0.45 + jitter(atom.seed + variant * 11.1, 5)),
    y:
      end.y * (0.68 - variant * 0.02) +
      normal.y * (curve * 0.45 + jitter(atom.seed + variant * 12.1, 5)),
  };

  return `M ${format(start.x)} ${format(start.y)} C ${format(controlOne.x)} ${format(
    controlOne.y,
  )} ${format(controlTwo.x)} ${format(controlTwo.y)} ${format(end.x)} ${format(end.y)}`;
}

export function buildScoreSketchPolygon(points, seed, wobble = 1.4) {
  const jitteredPoints = points.map((point, index) => ({
    x: point.x + jitter(seed + index * 1.37, wobble),
    y: point.y + jitter(seed + index * 2.11, wobble),
  }));

  return jitteredPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${format(point.x)} ${format(point.y)}`)
    .join(' ')
    .concat(' Z');
}

export function buildScoreAxisPath(start, end, seed) {
  const startPoint = {
    x: start.x + jitter(seed + 1.1, 0.8),
    y: start.y + jitter(seed + 2.3, 0.8),
  };
  const endPoint = {
    x: end.x + jitter(seed + 3.7, 1.2),
    y: end.y + jitter(seed + 4.9, 1.2),
  };

  return `M ${format(startPoint.x)} ${format(startPoint.y)} L ${format(endPoint.x)} ${format(
    endPoint.y,
  )}`;
}

export function buildSketchBoxPath(x, y, width, height, seed, wobble = 1.4) {
  return buildScoreSketchPolygon(
    [
      { x, y },
      { x: x + width, y: y + jitter(seed + 1.2, wobble * 0.18) },
      { x: x + width + jitter(seed + 2.4, wobble * 0.18), y: y + height },
      { x: x + jitter(seed + 3.6, wobble * 0.18), y: y + height + jitter(seed + 4.8, wobble * 0.18) },
    ],
    seed,
    wobble,
  );
}

export function createAtomState(config) {
  return {
    ...config,
    baseDirection: new THREE.Vector3(...config.direction).normalize(),
    hovered: false,
    hoverMix: 0,
    dragging: false,
    dragMix: 0,
    nodeTilt: jitter(config.seed + 401, 16),
    labelTilt: jitter(config.seed + 509, 8),
    labelOffset: 20 + noise(config.seed + 557) * 14,
    nodePaths: [
      buildLoopPath(config.node, config.seed + 201),
      buildLoopPath(config.node * 0.84, config.seed + 301),
    ],
  };
}

export function createSceneCameraRig() {
  return {
    current: {
      panX: 0,
      panY: 0,
      dolly: 0,
      zoom: 1,
      roll: 0,
      driftX: 0,
      driftY: 0,
      focus: 0,
    },
    target: {
      panX: 0,
      panY: 0,
      dolly: 0,
      zoom: 1,
      roll: 0,
      driftX: 0,
      driftY: 0,
      focus: 0,
    },
  };
}

export function projectPoint(position, camera = DEFAULT_SCENE_CAMERA) {
  const translatedX = position.x + (camera.panX ?? 0);
  const translatedY = position.y + (camera.panY ?? 0);
  const translatedZ = position.z + (camera.dolly ?? 0);
  const roll = ((camera.roll ?? 0) * Math.PI) / 180;
  const rollCos = Math.cos(roll);
  const rollSin = Math.sin(roll);
  const rolledX = translatedX * rollCos - translatedY * rollSin;
  const rolledY = translatedX * rollSin + translatedY * rollCos;
  const perspective = CAMERA_DISTANCE / Math.max(CAMERA_NEAR_CLIP, CAMERA_DISTANCE - translatedZ);
  const zoom = camera.zoom ?? 1;

  return {
    x: rolledX * perspective * zoom + (camera.driftX ?? 0),
    y: rolledY * perspective * zoom + (camera.driftY ?? 0),
    scale: perspective * zoom,
    depth: clamp((translatedZ / BOND_LENGTH + 1) * 0.5, 0, 1),
  };
}

export function trackballVector(point) {
  const x = clamp(point.x / TRACKBALL_RADIUS, -1, 1);
  const y = clamp(point.y / TRACKBALL_RADIUS, -1, 1);
  const lengthSquared = x * x + y * y;

  if (lengthSquared > 1) {
    const scale = 1 / Math.sqrt(lengthSquared);
    return new THREE.Vector3(x * scale, y * scale, 0);
  }

  return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSquared));
}

export function generateAtomLayout(items) {
  const visibleItems = filterPortfolioItemsForAtomScene(items);

  if (!visibleItems.length) {
    return [];
  }

  const total = Math.max(visibleItems.length, MIN_ATOMS);

  if (total === 1) {
    return [
      {
        id: 'a1',
        direction: [0.86, 0.22, 0.46],
        node: 8.7,
        seed: 11,
        label: visibleItems[0]?.label ?? 'Stock',
        detail: visibleItems[0]?.detail ?? '',
        region: visibleItems[0]?.region ?? '',
        sector: visibleItems[0]?.sector ?? '',
        style: visibleItems[0]?.style ?? '',
        risk: visibleItems[0]?.risk ?? '',
        assetClass: visibleItems[0]?.assetClass ?? '',
        metadataSource: visibleItems[0]?.metadataSource ?? 'raw',
        metadataSourceByField: visibleItems[0]?.metadataSourceByField ?? {},
        fields: visibleItems[0]?.fields ?? [],
      },
    ];
  }

  if (LOW_COUNT_LAYOUTS[total]) {
    return Array.from({ length: total }, (_, index) => {
      const preset = LOW_COUNT_LAYOUTS[total][index] ?? [0, 0, 1];
      const direction = new THREE.Vector3(...preset)
        .add(
          new THREE.Vector3(
            jitter(1500 + index * 19, 0.08),
            jitter(1600 + index * 23, 0.08),
            jitter(1700 + index * 29, 0.08),
          ),
        )
        .normalize();

      return {
        id: `a${index + 1}`,
        direction: [direction.x, direction.y, direction.z],
        node: 7.9 + noise(1800 + index * 31) * 1.6,
        seed: 11 + index * 23,
        label: visibleItems[index]?.label ?? `Stock ${index + 1}`,
        detail: visibleItems[index]?.detail ?? '',
        region: visibleItems[index]?.region ?? '',
        sector: visibleItems[index]?.sector ?? '',
        style: visibleItems[index]?.style ?? '',
        risk: visibleItems[index]?.risk ?? '',
        assetClass: visibleItems[index]?.assetClass ?? '',
        metadataSource: visibleItems[index]?.metadataSource ?? 'raw',
        metadataSourceByField: visibleItems[index]?.metadataSourceByField ?? {},
        fields: visibleItems[index]?.fields ?? [],
      };
    });
  }

  return Array.from({ length: total }, (_, index) => {
    const ratio = total === 1 ? 0.5 : index / (total - 1);
    const y = 1 - ratio * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * GOLDEN_ANGLE + jitter(1400 + index * 17, 0.24);
    const direction = new THREE.Vector3(
      Math.cos(theta) * radius + jitter(1500 + index * 19, 0.14),
      y + jitter(1600 + index * 23, 0.14),
      Math.sin(theta) * radius + jitter(1700 + index * 29, 0.14),
    ).normalize();

    return {
      id: `a${index + 1}`,
      direction: [direction.x, direction.y, direction.z],
      node: 7.8 + noise(1800 + index * 31) * 1.7,
      seed: 11 + index * 23,
      label: visibleItems[index]?.label ?? `Stock ${index + 1}`,
      detail: visibleItems[index]?.detail ?? '',
      region: visibleItems[index]?.region ?? '',
      sector: visibleItems[index]?.sector ?? '',
      style: visibleItems[index]?.style ?? '',
      risk: visibleItems[index]?.risk ?? '',
      assetClass: visibleItems[index]?.assetClass ?? '',
      metadataSource: visibleItems[index]?.metadataSource ?? 'raw',
      metadataSourceByField: visibleItems[index]?.metadataSourceByField ?? {},
      fields: visibleItems[index]?.fields ?? [],
    };
  });
}

export const PORTFOLIO_PREVIEW_SLOTS = [
  { x: -0.12, y: -0.02, scale: 0.32, rotation: -23, z: -1160, blur: 0.66, opacity: 0.64, shadow: 18, delay: '-2.4s', duration: '5.8s' },
  { x: 1.12, y: 0.07, scale: 0.24, rotation: 18, z: -1380, blur: 1.02, opacity: 0.5, shadow: 14, delay: '-1.2s', duration: '6.4s' },
  { x: 0.1, y: 0.09, scale: 0.2, rotation: -7, z: -1540, blur: 1.28, opacity: 0.42, shadow: 11, delay: '-1.8s', duration: '6.2s' },
  { x: 0.94, y: 0.27, scale: 0.28, rotation: 13, z: -1240, blur: 0.84, opacity: 0.56, shadow: 15, delay: '-2.9s', duration: '5.9s' },
  { x: -0.08, y: 0.82, scale: 0.29, rotation: 17, z: -1200, blur: 0.74, opacity: 0.6, shadow: 16, delay: '-3.1s', duration: '6.1s' },
  { x: 0.18, y: 1.08, scale: 0.21, rotation: -15, z: -1600, blur: 1.34, opacity: 0.38, shadow: 10, delay: '-1.5s', duration: '6.7s' },
  { x: 1.08, y: 0.96, scale: 0.23, rotation: -19, z: -1460, blur: 1.1, opacity: 0.46, shadow: 12, delay: '-0.8s', duration: '6.9s' },
  { x: 0.86, y: 0.72, scale: 0.19, rotation: 9, z: -1700, blur: 1.52, opacity: 0.34, shadow: 9, delay: '-2.2s', duration: '7.1s' },
];

export const CENTER_BLOTS = [
  buildBlotPath(13.2, 501),
  buildBlotPath(10.7, 613),
  buildBlotPath(7.9, 727),
];

export const CENTER_SPIN_LOOPS = [
  buildLoopPath(14.8, 811),
  buildLoopPath(12.9, 883),
];

export const DUST = [
  { x: -22, y: 28, r: 1.4, opacity: 0.2 },
  { x: 10, y: -20, r: 1.2, opacity: 0.16 },
  { x: 28, y: 14, r: 1.2, opacity: 0.14 },
  { x: -36, y: -10, r: 0.95, opacity: 0.11 },
  { x: 44, y: -8, r: 1, opacity: 0.1 },
];
