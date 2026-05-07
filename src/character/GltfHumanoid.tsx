import { useGLTF } from '@react-three/drei';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { AnimationClip, Group, Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { type HumanoidBoneNames, type HumanoidHandle, QUADRUPED_BONE_NAMES } from './humanoid.js';

/**
 * Default model: Quaternius "Husky" from the Animated Animal Pack — CC0,
 * quadruped rig with bundled Idle / Walk / Gallop locomotion clips. Replaces
 * the previously-default `Soldier.glb` (Mixamo Y-Bot) per DWEA-32.
 */
type RigDescriptor = {
  /** GLB URL relative to Vite's `BASE_URL`. */
  readonly path: string;
  /** Abstract → concrete bone name map for IK + animation retargeting. */
  readonly boneNames: HumanoidBoneNames;
  /**
   * Uniform scale applied to the loaded scene. The husky GLB ships with an
   * AnimalArmature parent at scale=[100,100,100], producing a ~3.2 m bbox in
   * world units; we shrink it to roughly soldier-sized so the existing
   * camera/capsule/scene tuning still reads. Soldier rig defaults to 1.0.
   */
  readonly scale: number;
  /**
   * Inner Y offset applied to the loaded scene so the rig's hip lands at
   * y=0 of the outer `<group>`. Stub humanoid convention is hip-at-root.
   */
  readonly feetOffset: number;
  /**
   * Bundled clip name → canonical name. Names that aren't in this map keep
   * their lowercase form. The locomotion trio (idle/walk/run) MUST be present
   * after this rename so `Character.tsx`'s mixer keys onto the same names
   * the synth fallback set uses.
   */
  readonly clipRename: Readonly<Record<string, string>>;
  /**
   * Clip name predicate: return false to drop the clip entirely. Used to
   * skip FBX2glTF's `AnimalArmature|*` duplicate copies on the husky GLB.
   */
  readonly clipFilter?: (originalName: string) => boolean;
};

const HUSKY_RIG: RigDescriptor = {
  path: 'characters/husky-quaternius.glb',
  boneNames: QUADRUPED_BONE_NAMES,
  // Quaternius bake puts the AnimalArmature at scale 100; uncorrected the
  // dog renders at ~3.2 m. Shrinking to 0.5 yields a ~1.6 m visible body
  // when wrapped by the prior soldier spawn / NPC_SCALE values.
  scale: 0.5,
  // Husky pelvis sits a touch above origin in its rest pose; keeping the
  // offset at 0 places the rig with feet at ground level for the spawn
  // height the host already adds (see Character.tsx's outer wrapper group).
  feetOffset: 0,
  clipRename: {
    // Map the husky's locomotion trio onto the canonical lowercase names
    // the player rig's mixer keys onto. Soldier.glb shipped its locomotion
    // as Idle/Walk/Run, the husky as Idle/Walk/Gallop — rename Gallop→run
    // so play_animation('run', …) keeps working with no LLM-side change.
    idle: 'idle',
    walk: 'walk',
    gallop: 'run',
  },
  clipFilter: (name) => !name.startsWith('AnimalArmature|'),
};

const DEFAULT_RIG: RigDescriptor = HUSKY_RIG;

interface GltfHumanoidProps {
  /** glTF binary URL relative to `BASE_URL`. Defaults to the active rig descriptor's `path`. */
  readonly url?: string;
  /** Override the bone-name map. Defaults to the active rig descriptor's `boneNames`. */
  readonly boneNames?: HumanoidBoneNames;
  /** Override the inner Y offset. Defaults to the active rig descriptor's `feetOffset`. */
  readonly feetOffset?: number;
  /** Override the uniform scale. Defaults to the active rig descriptor's `scale`. */
  readonly scale?: number;
}

/**
 * Loads a rigged glTF and exposes it as a `HumanoidHandle`. The URL and
 * bone-name map default to the active rig descriptor (currently the
 * Quaternius husky — CC0 quadruped). Pass overrides to mount a different
 * rig in the same hierarchy.
 *
 * Uses `SkeletonUtils.clone` so multiple `<GltfHumanoid />` instances do not
 * share a skeleton — drei's `useGLTF` cache otherwise hands back the same
 * Object3D every time.
 */
export const GltfHumanoid = forwardRef<HumanoidHandle, GltfHumanoidProps>(function GltfHumanoid(
  {
    url = `${import.meta.env.BASE_URL}${DEFAULT_RIG.path}`,
    boneNames = DEFAULT_RIG.boneNames,
    feetOffset = DEFAULT_RIG.feetOffset,
    scale = DEFAULT_RIG.scale,
  },
  ref,
) {
  const gltf = useGLTF(url);
  const rootRef = useRef<Group>(null);

  // Per-mount clone of the GLB scene with proper SkinnedMesh + skeleton
  // wiring. Without this, two characters would share bones and animation
  // updates would race.
  const scene = useMemo<Object3D>(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);

  // Cast shadows on the cloned skinned meshes — most CC0 GLBs omit the flag.
  useMemo(() => {
    scene.traverse((obj) => {
      const mesh = obj as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  // Lowercase clip names + apply the rig's rename map + drop FBX2glTF
  // duplicates / T-Pose so the GLB clips slot into the same name-keyed
  // action map the synth fallback uses.
  const clips = useMemo<readonly AnimationClip[]>(() => {
    return gltf.animations
      .filter((c) => c.name.toLowerCase() !== 'tpose')
      .filter((c) => (DEFAULT_RIG.clipFilter ? DEFAULT_RIG.clipFilter(c.name) : true))
      .map((c) => {
        const lower = c.name.toLowerCase();
        const renamed = DEFAULT_RIG.clipRename[lower] ?? lower;
        const clone = c.clone();
        clone.name = renamed;
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
        return root.getObjectByName(boneNames[name]) ?? null;
      },
      boneNames,
      clips,
    }),
    [boneNames, clips],
  );

  return (
    <group ref={rootRef} name="gltf-humanoid">
      <primitive object={scene} position={[0, feetOffset, 0]} scale={scale} />
    </group>
  );
});

// Warm the loader cache so the GLB is ready by the time <Character /> mounts.
useGLTF.preload(`${import.meta.env.BASE_URL}${DEFAULT_RIG.path}`);
