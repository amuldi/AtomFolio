import * as THREE from 'three';

// Invisible hit-target radius matches the old SVG hit-circle (r = atom.node * 2.85,
// src/components/atom/index.jsx) so click/hover forgiveness feels identical.
const HIT_RADIUS_MULTIPLIER = 2.85;
const CENTER_HIT_RADIUS = 34;

export function createHitTargetMaterial() {
  return new THREE.MeshBasicMaterial({ visible: false });
}

export function createAtomHitMesh(atom) {
  const geometry = new THREE.CircleGeometry(atom.node * HIT_RADIUS_MULTIPLIER, 16);
  const mesh = new THREE.Mesh(geometry, createHitTargetMaterial());
  mesh.userData.atomId = atom.id;
  return mesh;
}

export function createCenterHitMesh() {
  const geometry = new THREE.CircleGeometry(CENTER_HIT_RADIUS, 24);
  const mesh = new THREE.Mesh(geometry, createHitTargetMaterial());
  mesh.userData.center = true;
  return mesh;
}

function billboardToCamera(mesh, camera) {
  mesh.quaternion.copy(camera.quaternion);
}

// Hit meshes are billboarded flat circles facing the camera every frame (cheap — there are at
// most ~18 of them), so raycasting against them reproduces the old 2D-hit-circle forgiveness
// regardless of the rig's current rotation.
export function billboardHitMeshes(hitMeshes, camera) {
  for (const mesh of hitMeshes) {
    billboardToCamera(mesh, camera);
  }
}

function pointerToNdc(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) {
    return null;
  }

  return new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
}

// Returns { atomId } | { center: true } | null.
export function pickAtPointer(event, canvas, camera, raycaster, hitMeshes) {
  const ndc = pointerToNdc(event, canvas);
  if (!ndc) {
    return null;
  }

  raycaster.setFromCamera(ndc, camera);
  const intersections = raycaster.intersectObjects(hitMeshes, false);

  if (!intersections.length) {
    return null;
  }

  const hit = intersections[0].object;
  if (hit.userData.center) {
    return { center: true };
  }

  if (hit.userData.atomId) {
    return { atomId: hit.userData.atomId };
  }

  return null;
}
