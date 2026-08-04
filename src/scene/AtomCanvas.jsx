import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createSceneRenderer, resizeSceneRenderer, CAMERA_HOME_POSITION, CAMERA_HOME_LOOKAT } from './createRenderer.js';
import { createAtomMesh, createNucleusMesh, createDustPoints } from './atomMeshFactory.js';
import {
  createAtomHitMesh,
  createCenterHitMesh,
  billboardHitMeshes,
  pickAtPointer,
} from './raycastInteraction.js';
import { createLabelRenderer, resizeLabelRenderer, createAtomLabelObject, setAtomLabelSelected } from './cssLabels.js';
import { PHASE, tick as tickTransition, getDistortionStrength, getReleaseProgress } from './blackhole/transitionMachine.js';
import { computeCameraFrame } from './blackhole/cameraFraming.js';
import { createSpringVector3, stepSpringVector3 } from './blackhole/springDamper.js';
import { createParticleSwirl, setParticleSwirlProgress, disposeParticleSwirl } from './blackhole/particleSwirl.js';
import { setDistortionStrength } from './blackhole/distortionShader.js';

// Stage D: the black-hole absorption transition is layered on top of Stage B/C's static
// rendering + interaction + bloom. transitionRef is owned by App.jsx (same ref-mutated-outside-
// React pattern as rotationRef) and ticked here every frame; onTransitionPhaseChange reports
// edge-triggered phase changes back so App.jsx can open/close AtomDetailPanel in sync with the
// camera's arrival instead of at click time. See .claude/plans/binary-leaping-wind.md, Stage D.
export function AtomCanvas({
  atoms,
  rotationRef,
  motionPreferenceRef,
  bondLength,
  transitionRef,
  onTransitionPhaseChange,
  onAtomPointerDown,
  onAtomPointerEnter,
  onAtomPointerMove,
  onAtomPointerLeave,
  onKeyboardSelect,
  onCenterClick,
}) {
  const canvasRef = useRef(null);
  const labelLayerRef = useRef(null);
  const rigRef = useRef(null);
  const sceneObjectsRef = useRef({ scene: null, camera: null, renderer: null, labelRenderer: null });
  const hitMeshesRef = useRef([]);
  const labelObjectsRef = useRef(new Map());
  const atomMeshesRef = useRef(new Map());
  const atomDataRef = useRef(new Map());
  const particleSwirlsRef = useRef(new Map());
  const cameraPositionSpringRef = useRef(createSpringVector3(CAMERA_HOME_POSITION.x, CAMERA_HOME_POSITION.y, CAMERA_HOME_POSITION.z));
  const hoveredIdRef = useRef(null);
  const frameRef = useRef(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const callbacksRef = useRef({});

  callbacksRef.current = {
    onAtomPointerDown,
    onAtomPointerEnter,
    onAtomPointerMove,
    onAtomPointerLeave,
    onKeyboardSelect,
    onCenterClick,
    onTransitionPhaseChange,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelLayerRef.current;
    if (!canvas || !labelLayer) {
      return undefined;
    }

    const parent = canvas.parentElement ?? canvas;
    const width = parent.clientWidth || 1;
    const height = parent.clientHeight || 1;
    const { renderer, scene, camera, composer, distortionPass } = createSceneRenderer(canvas, width, height);
    const labelRenderer = createLabelRenderer(width, height);
    labelLayer.appendChild(labelRenderer.domElement);

    const rig = new THREE.Group();
    scene.add(rig);
    rigRef.current = rig;
    sceneObjectsRef.current = { scene, camera, renderer, composer, labelRenderer };

    const handleResize = () => {
      const nextWidth = parent.clientWidth || 1;
      const nextHeight = parent.clientHeight || 1;
      resizeSceneRenderer(renderer, camera, composer, nextWidth, nextHeight);
      resizeLabelRenderer(labelRenderer, nextWidth, nextHeight);
    };
    window.addEventListener('resize', handleResize);

    // atomId -> Points, for whichever atom(s) currently need a swirl: the active target
    // (collapsing/arrived/reversing) and/or an atom just released by an A->B crossfade.
    const syncParticleSwirls = (state) => {
      const wanted = new Map();

      if (state.targetAtomId && state.phase !== PHASE.IDLE && state.phase !== PHASE.CHARGING) {
        wanted.set(state.targetAtomId, getDistortionStrength(state));
      }
      if (state.releasingAtomId) {
        wanted.set(state.releasingAtomId, 1 - getReleaseProgress(state));
      }

      for (const [atomId, points] of particleSwirlsRef.current.entries()) {
        if (!wanted.has(atomId)) {
          rig.remove(points);
          disposeParticleSwirl(points);
          particleSwirlsRef.current.delete(atomId);
        }
      }

      for (const [atomId, progress] of wanted.entries()) {
        let points = particleSwirlsRef.current.get(atomId);
        if (!points) {
          const atomData = atomDataRef.current.get(atomId);
          const atomMesh = atomMeshesRef.current.get(atomId);
          if (!atomData || !atomMesh) {
            continue;
          }
          points = createParticleSwirl(atomData);
          points.position.copy(atomMesh.userData.localPosition);
          rig.add(points);
          particleSwirlsRef.current.set(atomId, points);
        }
        setParticleSwirlProgress(points, progress);
      }
    };

    let lastTime = performance.now();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);

      if (motionPreferenceRef?.current?.visible === false) {
        lastTime = performance.now();
        return;
      }

      const now = performance.now();
      const dtMs = Math.min(now - lastTime, 64);
      lastTime = now;

      if (rotationRef?.current?.current) {
        rig.quaternion.copy(rotationRef.current.current);
      }

      const transitionState = transitionRef?.current;
      if (transitionState) {
        const previousPhase = transitionState.phase;
        const nextState = tickTransition(transitionState, dtMs);
        transitionRef.current = nextState;
        if (nextState.phase !== previousPhase) {
          callbacksRef.current.onTransitionPhaseChange?.(nextState.phase, nextState.targetAtomId);
        }

        const targetMesh = nextState.targetAtomId ? atomMeshesRef.current.get(nextState.targetAtomId) : null;
        const atomWorldPosition = targetMesh
          ? targetMesh.userData.localPosition.clone().applyQuaternion(rig.quaternion)
          : null;

        const frame = computeCameraFrame(
          nextState.phase,
          atomWorldPosition,
          CAMERA_HOME_POSITION,
          CAMERA_HOME_LOOKAT,
        );

        // Only position is springed (smooth fly-to). lookAt is applied directly and unsmoothed —
        // two independently-lagging springs could let the atom drift outside the (narrow, 32°)
        // frustum mid-flight if position and orientation fell out of sync; always aiming exactly
        // at the phase-appropriate target keeps the atom framed throughout the approach.
        cameraPositionSpringRef.current = stepSpringVector3(cameraPositionSpringRef.current, frame.position, dtMs);
        camera.position.set(
          cameraPositionSpringRef.current.x,
          cameraPositionSpringRef.current.y,
          cameraPositionSpringRef.current.z,
        );
        camera.lookAt(frame.lookAt.x, frame.lookAt.y, frame.lookAt.z);

        setDistortionStrength(distortionPass, getDistortionStrength(nextState));
        syncParticleSwirls(nextState);
      }

      billboardHitMeshes(hitMeshesRef.current, camera);
      composer.render();
      labelRenderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
      for (const points of particleSwirlsRef.current.values()) {
        disposeParticleSwirl(points);
      }
      particleSwirlsRef.current = new Map();
      composer.dispose();
      renderer.dispose();
      labelLayer.removeChild(labelRenderer.domElement);
    };
  }, []);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) {
      return undefined;
    }

    while (rig.children.length) {
      rig.remove(rig.children[0]);
    }

    for (const labelObject of labelObjectsRef.current.values()) {
      labelObject.element.remove();
    }
    labelObjectsRef.current = new Map();

    for (const points of particleSwirlsRef.current.values()) {
      disposeParticleSwirl(points);
    }
    particleSwirlsRef.current = new Map();

    rig.add(createNucleusMesh());
    rig.add(createDustPoints());

    const centerHit = createCenterHitMesh();
    const hitMeshes = [centerHit];
    rig.add(centerHit);

    const atomMeshes = new Map();
    const atomData = new Map();

    for (const atom of atoms ?? []) {
      const atomMesh = createAtomMesh(atom, bondLength);
      rig.add(atomMesh);
      atomMeshes.set(atom.id, atomMesh);
      atomData.set(atom.id, atom);

      const hitMesh = createAtomHitMesh(atom);
      hitMesh.position.copy(atomMesh.userData.localPosition);
      rig.add(hitMesh);
      hitMeshes.push(hitMesh);

      const labelObject = createAtomLabelObject(atom, {
        onKeyboardSelect: (atomId) => callbacksRef.current.onKeyboardSelect?.(atomId),
      });
      labelObject.position.copy(atomMesh.userData.localPosition);
      rig.add(labelObject);
      labelObjectsRef.current.set(atom.id, labelObject);
    }

    hitMeshesRef.current = hitMeshes;
    atomMeshesRef.current = atomMeshes;
    atomDataRef.current = atomData;

    return undefined;
    // Rebuild geometry only when the set of atoms actually changes shape, not on every
    // frameTime-driven re-render of the `atoms` prop.
  }, [(atoms ?? []).map((atom) => atom.id).join(','), bondLength]);

  useEffect(() => {
    for (const atom of atoms ?? []) {
      const labelObject = labelObjectsRef.current.get(atom.id);
      if (labelObject) {
        setAtomLabelSelected(labelObject, Boolean(atom.isSelected));
        labelObject.element.classList.toggle('is-dimmed', Boolean(atom.dimmed));
      }
    }
  }, [atoms]);

  const hoverPick = (event) => {
    const { camera } = sceneObjectsRef.current;
    if (!camera) {
      return null;
    }
    return pickAtPointer(event, canvasRef.current, camera, raycasterRef.current, hitMeshesRef.current);
  };

  const handlePointerDown = (event) => {
    const pick = hoverPick(event);
    if (pick?.atomId) {
      callbacksRef.current.onAtomPointerDown?.(pick.atomId, event);
    } else if (pick?.center) {
      callbacksRef.current.onCenterClick?.(event);
    }
  };

  const handlePointerMove = (event) => {
    const pick = hoverPick(event);
    const nextId = pick?.atomId ?? null;
    const previousId = hoveredIdRef.current;

    if (nextId !== previousId) {
      if (previousId) {
        callbacksRef.current.onAtomPointerLeave?.(previousId);
      }
      if (nextId) {
        callbacksRef.current.onAtomPointerEnter?.(nextId, event);
      }
      hoveredIdRef.current = nextId;
    } else if (nextId) {
      callbacksRef.current.onAtomPointerMove?.(nextId, event);
    }
  };

  const handlePointerLeave = () => {
    if (hoveredIdRef.current) {
      callbacksRef.current.onAtomPointerLeave?.(hoveredIdRef.current);
      hoveredIdRef.current = null;
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="atom-webgl-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      />
      <div ref={labelLayerRef} className="atom-webgl-label-layer" />
    </>
  );
}
