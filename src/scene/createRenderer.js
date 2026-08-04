import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// The camera's resting pose — also the "flying to a target atom" transition's home target for
// idle/charging(partial)/reversing, see blackhole/cameraFraming.js.
export const CAMERA_HOME_POSITION = { x: 0, y: 0, z: 470 };
export const CAMERA_HOME_LOOKAT = { x: 0, y: 0, z: 0 };

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

  // Soft, minimal 2-light setup so atom/nucleus volumes read as rounded 3D form as they rotate,
  // rather than flat unlit cutouts — both lights stay within the cream/black palette (no new
  // hues), matching the 3-color constraint.
  scene.add(new THREE.HemisphereLight(0xfaf1de, 0x050308, 0.85));
  const keyLight = new THREE.DirectionalLight(0xfaf1de, 0.45);
  keyLight.position.set(180, 260, 200);
  scene.add(keyLight);

  const camera = new THREE.PerspectiveCamera(32, width / height, 10, 4000);
  camera.position.set(CAMERA_HOME_POSITION.x, CAMERA_HOME_POSITION.y, CAMERA_HOME_POSITION.z);
  camera.lookAt(CAMERA_HOME_LOOKAT.x, CAMERA_HOME_LOOKAT.y, CAMERA_HOME_LOOKAT.z);

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
