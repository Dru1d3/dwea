import { useGLTF } from '@react-three/drei';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { AnimationClip, Group, Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { type HumanoidHandle, MIXAMO_BONE_NAMES } from './humanoid.js';

/** Default model: three.js's bundled Mixamo Y-Bot ("Soldier"). */
const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}models/Soldier.glb`;

/**
 * Inner Y offset applied to the loaded scene so that `mixamorigHips` lands at
 * y=0 of the outer `<group>` — matching `StubHumanoid`'s convention where
 * the root group is positioned at hip level. Soldier.glb's Hips bone sits at
 * world y≈1.0 in its local coordinate space (after the Character node's
 * Z→Y rotation + cm→m scale), so we shift it down 1.0 m.
 */
const SOLDIER_FEET_OFFSET = -1.0;

interface GltfHumanoidProps {
  /** glTF binary URL relative to `BASE_URL`. Defaults to the bundled Soldier. */
  readonly url?: string;
}

/**
 * Loads a rigged glTF and exposes it as a `HumanoidHandle`. Bones are looked
 * up via `MIXAMO_BONE_NAMES`; bundled clips ship as lowercase
 * `idle / walk / run` (TPose is dropped) so they collide cleanly with the
 * synth fallback set in `Character`.
 *
 * Uses `SkeletonUtils.clone` so multiple `<GltfHumanoid />` instances do not
 * share a skeleton — drei's `useGLTF` cache otherwise hands back the same
 * Object3D every time.
 */
export const GltfHumanoid = forwardRef<HumanoidHandle, GltfHumanoidProps>(function GltfHumanoid(
  { url = DEFAULT_MODEL_URL },
  ref,
) {
  const gltf = useGLTF(url);
  const rootRef = useRef<Group>(null);

  // Per-mount clone of the GLB scene with proper SkinnedMesh + skeleton
  // wiring. Without this, two characters would share bones and animation
  // updates would race.
  const scene = useMemo<Object3D>(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);

  // Cast shadows on the cloned skinned meshes — Soldier.glb omits the flag.
  useMemo(() => {
    scene.traverse((obj) => {
      const mesh = obj as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  // Lowercase clip names + drop TPose so the GLB clips slot into the same
  // name-keyed action map the synth fallback uses.
  const clips = useMemo<readonly AnimationClip[]>(() => {
    return gltf.animations
      .filter((c) => c.name.toLowerCase() !== 'tpose')
      .map((c) => {
        const clone = c.clone();
        clone.name = clone.name.toLowerCase();
        return clone;
      });
  }, [gltf.animations]);

  useImperativeHandle(
    ref,
    () => ({
      get root() {
        const node = rootRef.current;
        if (!node) {
          throw new Error('GltfHumanoid root accessed before mount');
        }
        return node;
      },
      bone(name) {
        const root = rootRef.current;
        if (!root) return null;
        return root.getObjectByName(MIXAMO_BONE_NAMES[name]) ?? null;
      },
      boneNames: MIXAMO_BONE_NAMES,
      clips,
    }),
    [clips],
  );

  return (
    <group ref={rootRef} name="gltf-humanoid">
      <primitive object={scene} position={[0, SOLDIER_FEET_OFFSET, 0]} />
    </group>
  );
});

// Warm the loader cache so the GLB is ready by the time <Character /> mounts.
useGLTF.preload(DEFAULT_MODEL_URL);
