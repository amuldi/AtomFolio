import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createSceneRenderer, resizeSceneRenderer } from './createRenderer.js';
import { createAtomMesh, createNucleusMesh, createDustPoints } from './atomMeshFactory.js';

// Stage A: static WebGL rendering behind a dev-only toggle, mounted alongside the SVG scene for
// visual comparison. No raycasting/interaction/bloom yet (Stages B/C) — just proving the mesh
// pipeline, rig-quaternion rotation, and frame loop read the same refs the SVG scene already uses.
export function AtomCanvas({ atoms, rotationRef, motionPreferenceRef, bondLength }) {
  const canvasRef = useRef(null);
  const rigRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const { clientWidth, clientHeight } = canvas.parentElement ?? canvas;
    const width = clientWidth || 1;
    const height = clientHeight || 1;
    const { renderer, scene, camera } = createSceneRenderer(canvas, width, height);

    const rig = new THREE.Group();
    scene.add(rig);
    rigRef.current = rig;

    const handleResize = () => {
      const parent = canvas.parentElement ?? canvas;
      resizeSceneRenderer(renderer, camera, parent.clientWidth || 1, parent.clientHeight || 1);
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

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
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

    rig.add(createNucleusMesh());
    rig.add(createDustPoints());

    for (const atom of atoms ?? []) {
      rig.add(createAtomMesh(atom, bondLength));
    }

    return undefined;
  }, [atoms, bondLength]);

  return <canvas ref={canvasRef} className="atom-webgl-canvas" />;
}
