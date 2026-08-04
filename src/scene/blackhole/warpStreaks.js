import * as THREE from 'three';
import { INK_COLOR } from '../materials.js';

// A fixed starfield (mounted directly under the scene, not the rotating atom rig) that streaks
// as the camera flies toward/away from a target — the "spaceship passing through space" cue for
// the fly-to transition. Each star is a line segment: one end pinned to the star's real position,
// the other trailing behind it along -cameraVelocity, so the streak length is purely a function
// of how fast the camera is currently moving (naturally ~0 at rest — idle/arrived — with no
// phase-awareness needed here).
const STAR_COUNT = 220;
const FIELD_RADIUS_MIN = 120;
const FIELD_RADIUS_MAX = 900;
const MAX_STREAK_LENGTH = 260;
// Tuning constant translating camera speed (world units/sec) into streak length — needs
// live-in-browser adjustment like the rest of this transition's visual tuning.
const VELOCITY_TO_LENGTH = 0.55;

function randomPointInShell(minRadius, maxRadius) {
  let x;
  let y;
  let z;
  let lengthSquared;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
    lengthSquared = x * x + y * y + z * z;
  } while (lengthSquared === 0 || lengthSquared > 1);
  const length = Math.sqrt(lengthSquared);
  const radius = minRadius + Math.random() * (maxRadius - minRadius);
  return { x: (x / length) * radius, y: (y / length) * radius, z: (z / length) * radius };
}

export function createWarpStreaks(count = STAR_COUNT) {
  const stars = [];
  const positions = new Float32Array(count * 6);

  for (let i = 0; i < count; i += 1) {
    const point = randomPointInShell(FIELD_RADIUS_MIN, FIELD_RADIUS_MAX);
    stars.push(point);
    positions[i * 6] = point.x;
    positions[i * 6 + 1] = point.y;
    positions[i * 6 + 2] = point.z;
    positions[i * 6 + 3] = point.x;
    positions[i * 6 + 4] = point.y;
    positions[i * 6 + 5] = point.z;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);

  const material = new THREE.LineBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.stars = stars;
  return lines;
}

export function updateWarpStreaks(lines, cameraVelocity) {
  const stars = lines.userData.stars;
  const position = lines.geometry.attributes.position;
  const speed = Math.sqrt(
    cameraVelocity.x * cameraVelocity.x
      + cameraVelocity.y * cameraVelocity.y
      + cameraVelocity.z * cameraVelocity.z,
  );

  if (speed < 1e-3) {
    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      position.setXYZ(i * 2 + 1, star.x, star.y, star.z);
    }
    position.needsUpdate = true;
    return;
  }

  const length = Math.min(MAX_STREAK_LENGTH, speed * VELOCITY_TO_LENGTH);
  const dirX = cameraVelocity.x / speed;
  const dirY = cameraVelocity.y / speed;
  const dirZ = cameraVelocity.z / speed;

  for (let i = 0; i < stars.length; i += 1) {
    const star = stars[i];
    // A static star, viewed from a camera moving with velocity v, appears (relative to the
    // camera) to move in -v — so the trailing end extends backward along -v from the star's
    // true position.
    position.setXYZ(i * 2 + 1, star.x - dirX * length, star.y - dirY * length, star.z - dirZ * length);
  }
  position.needsUpdate = true;
}

export function disposeWarpStreaks(lines) {
  lines.geometry.dispose();
  lines.material.dispose();
}
