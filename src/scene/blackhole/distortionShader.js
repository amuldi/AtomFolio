import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Radial "gravitational lensing" warp: pulls rendered texels toward a screen-space center,
// falling off toward the frame edges so it reads as suction rather than a uniform zoom.
// strength is driven directly by transitionMachine's getDistortionStrength(state) (0..1), so it
// ramps up through collapsing, holds at arrived, and ramps back down on reverse — all without
// this pass needing to know about phases itself.
const DistortionShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 center;
    varying vec2 vUv;

    void main() {
      vec2 toCenter = vUv - center;
      float dist = length(toCenter);
      float pull = strength * 0.4 * smoothstep(0.95, 0.0, dist);
      vec2 warpedUv = vUv - toCenter * pull;
      vec4 color = texture2D(tDiffuse, warpedUv);
      // Subtle event-horizon darkening near the center only — no color shift, stays inside the
      // cream-on-black palette.
      float darken = strength * 0.35 * smoothstep(0.5, 0.0, dist);
      gl_FragColor = vec4(color.rgb * (1.0 - darken), color.a);
    }
  `,
};

export function createDistortionPass() {
  // Left permanently enabled with strength 0 (a no-op copy) rather than toggled via
  // pass.enabled: EffectComposer only knows to render to screen from the *last* pass in its
  // array, so disabling it whenever it's last would blank the canvas — strength is the only
  // control surface, this pass always stays in the chain.
  return new ShaderPass(DistortionShader);
}

export function setDistortionStrength(pass, strength, center) {
  pass.uniforms.strength.value = strength;
  if (center) {
    pass.uniforms.center.value.set(center.x, center.y);
  }
}
