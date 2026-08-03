import * as THREE from 'three';

// Design-system 3-color constraint: cream "ink" on black, red/blue reserved for
// return-value accents elsewhere (never used on the atom's own base material).
export const INK_COLOR = 0xf9efda;

export function createBondMaterial() {
  return new THREE.LineBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: 0.55,
  });
}

export function createNodeOutlineMaterial() {
  return new THREE.LineBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: 0.85,
  });
}

export function createNodeFillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function createDustMaterial() {
  return new THREE.PointsMaterial({
    color: INK_COLOR,
    size: 2.4,
    transparent: true,
    opacity: 0.18,
    sizeAttenuation: true,
    depthWrite: false,
  });
}
