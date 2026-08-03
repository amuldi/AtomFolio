import * as THREE from 'three';
import { buildLoopPoints } from '../../utils/scene.js';
import { INK_COLOR } from '../materials.js';

// Seeds particles from the target atom's own node-loop outline (the same points its visible
// loop mesh is built from — see atomMeshFactory.js's buildLoopMesh), then spirals+converges them
// toward the atom's local origin as progress goes 0->1. Exact spiral rate/point size/opacity are
// tuning constants meant to be adjusted by eye in the browser (per the migration plan, Stage D's
// visuals aren't fully specifiable ahead of time).
const vertexShader = `
  attribute vec3 aStart;
  attribute float aSeed;
  uniform float uProgress;
  uniform float uPointSize;

  void main() {
    float spin = uProgress * (2.4 + aSeed * 3.2);
    float c = cos(spin);
    float s = sin(spin);
    vec3 spiraled = vec3(aStart.x * c - aStart.y * s, aStart.x * s + aStart.y * c, aStart.z);
    vec3 converged = spiraled * (1.0 - uProgress);

    vec4 mvPosition = modelViewMatrix * vec4(converged, 1.0);
    gl_PointSize = uPointSize * (1.0 - uProgress * 0.6) * (200.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float dist = length(centered);
    if (dist > 0.5) {
      discard;
    }
    float alpha = uOpacity * smoothstep(0.5, 0.0, dist);
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function createParticleSwirl(atom) {
  const sourcePoints = [
    ...buildLoopPoints(atom.node, atom.seed + 201),
    ...buildLoopPoints(atom.node * 0.84, atom.seed + 301),
  ];

  const starts = new Float32Array(sourcePoints.length * 3);
  const seeds = new Float32Array(sourcePoints.length);
  sourcePoints.forEach((point, index) => {
    starts[index * 3] = point.x;
    starts[index * 3 + 1] = point.y;
    starts[index * 3 + 2] = 0;
    seeds[index] = ((index * 37) % 97) / 97;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(starts.slice(), 3));
  geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uPointSize: { value: 5 },
      uColor: { value: new THREE.Color(INK_COLOR) },
      uOpacity: { value: 0.55 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.atomId = atom.id;
  return points;
}

export function setParticleSwirlProgress(points, progress) {
  points.material.uniforms.uProgress.value = Math.min(1, Math.max(0, progress));
}

export function disposeParticleSwirl(points) {
  points.geometry.dispose();
  points.material.dispose();
}
