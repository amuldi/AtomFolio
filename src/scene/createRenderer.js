import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// UnrealBloomPass's composite pass writes an opaque alpha regardless of the renderer's clear
// alpha, so once bloom is in the pipeline the canvas is opaque black — matching --app-bg
// (#000000) exactly, since this is meant to be the only thing rendered here once Stage B's SVG
// fallback is eventually removed.
export function createSceneRenderer(canvas, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(32, width / height, 10, 4000);
  camera.position.set(0, 0, 470);
  camera.lookAt(0, 0, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Subtle, luminance-gated bloom: only the bright cream "ink" lines/nucleus glow pick it up
  // (threshold 0.72), not the whole scene — keeps the minimalist palette from washing out.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.6, 0.72);
  composer.addPass(bloomPass);

  return { renderer, scene, camera, composer, bloomPass };
}

export function resizeSceneRenderer(renderer, camera, composer, width, height) {
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer.setSize(width, height);
}
