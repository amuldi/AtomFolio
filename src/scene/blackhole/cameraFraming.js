// Pure vector math (plain {x,y,z} objects, no THREE dependency) for where the camera's
// position/lookAt springs should be chasing *this frame*, given the transition phase and the
// target atom's live world position. AtomCanvas re-reads the atom's world position every frame
// (it keeps orbiting during the transition, per design) and feeds it back in here — this
// function itself holds no state, so retargeting is just a different return value next call,
// which is what lets springDamper.js produce a pop-free chase.
import { PHASE } from './transitionMachine.js';

const DEFAULT_ARRIVAL_MARGIN = 60;
// How far the camera eases toward the atom during the brief "charging" preamble — most of the
// travel happens during collapsing, this is just enough to read as an anticipatory lean-in.
const DEFAULT_CHARGE_BLEND = 0.16;

function vectorLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalize(v) {
  const len = vectorLength(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function addScaled(a, b, scale) {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function lerpVector(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function computeCameraFrame(
  phase,
  atomWorldPosition,
  homePosition,
  homeLookAt,
  { arrivalMargin = DEFAULT_ARRIVAL_MARGIN, chargeBlend = DEFAULT_CHARGE_BLEND } = {},
) {
  if (!atomWorldPosition || phase === PHASE.IDLE) {
    return { position: homePosition, lookAt: homeLookAt };
  }

  if (phase === PHASE.REVERSING) {
    return { position: homePosition, lookAt: homeLookAt };
  }

  // Approach from the same general direction the camera always viewed the scene from, stopping
  // short of the atom rather than flying past it — the atom's own local direction from the
  // world origin has nothing to do with which side the camera should end up on.
  const approachDirection = normalize(subtract(homePosition, atomWorldPosition));
  const arrivalPosition = addScaled(atomWorldPosition, approachDirection, arrivalMargin);

  if (phase === PHASE.CHARGING) {
    return {
      position: lerpVector(homePosition, arrivalPosition, chargeBlend),
      lookAt: lerpVector(homeLookAt, atomWorldPosition, chargeBlend),
    };
  }

  // collapsing / arrived
  return { position: arrivalPosition, lookAt: atomWorldPosition };
}
