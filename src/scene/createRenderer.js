import * as THREE from 'three';

// Bloom/EffectComposer are added in Stage C — Stage A only needs a plain renderer to validate
// the mesh/camera/rotation pipeline before layering post-processing on top.
export function createSceneRenderer(canvas, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(32, width / height, 10, 4000);
  camera.position.set(0, 0, 470);
  camera.lookAt(0, 0, 0);

  return { renderer, scene, camera };
}

export function resizeSceneRenderer(renderer, camera, width, height) {
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
