import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createSceneRenderer, resizeSceneRenderer } from './createRenderer.js';
import { createAtomMesh, createNucleusMesh, createDustPoints } from './atomMeshFactory.js';
import {
  createAtomHitMesh,
  createCenterHitMesh,
  billboardHitMeshes,
  pickAtPointer,
} from './raycastInteraction.js';
import { createLabelRenderer, resizeLabelRenderer, createAtomLabelObject, setAtomLabelSelected } from './cssLabels.js';

// Stage B: real interaction (raycaster hit-testing + CSS2D labels/keyboard focus) layered on top
// of Stage A's static rendering. Still a dev-only toggle (?webglScene=1) mounted alongside the
// SVG scene until the full behavior checklist in the migration plan is verified — see
// .claude/plans/binary-leaping-wind.md, Stage B.
export function AtomCanvas({
  atoms,
  rotationRef,
  motionPreferenceRef,
  bondLength,
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
    const { renderer, scene, camera, composer } = createSceneRenderer(canvas, width, height);
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

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);

      if (motionPreferenceRef?.current?.visible === false) {
        return;
      }

      if (rotationRef?.current?.current) {
        rig.quaternion.copy(rotationRef.current.current);
      }

      billboardHitMeshes(hitMeshesRef.current, camera);
      composer.render();
      labelRenderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
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

    rig.add(createNucleusMesh());
    rig.add(createDustPoints());

    const centerHit = createCenterHitMesh();
    const hitMeshes = [centerHit];
    rig.add(centerHit);

    for (const atom of atoms ?? []) {
      const atomMesh = createAtomMesh(atom, bondLength);
      rig.add(atomMesh);

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
