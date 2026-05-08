import { useGLTF } from '@react-three/drei';
import { createPortal, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { type AnimationAction, AnimationMixer, type Group, LoopRepeat, type Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { MonsterBible } from '../llm/bible.js';
import { EmotionBadge } from './EmotionBadge.js';
import type { EmotionState } from './emotion.js';
import { type NpcClip, npcFacingYaw, pickNpcClip, stepTowardTarget } from './movement.js';
import type { Vec2 } from './types.js';

// DWEA-32 — switch the wandering NPC ("Mara") rig from Mixamo Soldier to the
// Quaternius CC0 husky so the dwea-11-world-c preview renders a fully-rigged
// dog with parity locomotion (idle/walk/gallop). The husky GLB ships its own
// `Idle` and `Walk` clips at the canonical names the mixer below picks up.
const NPC_GLB_URL = `${import.meta.env.BASE_URL}characters/husky-quaternius.glb`;

// The animation cross-fade window. Short fade → snappy idle↔walk transitions.
const ANIM_FADE = 0.18;

// Husky's AnimalArmature parent ships at scale=100 so the rest-pose mesh
// reaches a ~3.2 m bbox in world units. 0.5 brings her down to ~1.6 m at
// the head — still bigger than a real husky but reads as a creature without
// dwarfing the splat scenes the camera frames.
const NPC_SCALE = 0.5;

// Husky's feet sit at y=0 in scene-local; lifting the rig by this much keeps
// her paws visibly above the noisy splat floor in scenes where the lower
// percentile of gaussians sits a few cm above navigation.groundY.
const FEET_CLEARANCE = 0.05;

// §5 emotion-badge anchoring (DWEA-66 brief §5, DWEA-70). Bones we probe in
// preference order — `Head_end` is the leaf above the skull on Quaternius
// rigs and gives the cleanest "above silhouette" anchor; the others cover
// the husky `Head` and the future Mara/Mixamo rig conventions. First match
// wins.
const HEAD_BONE_NAMES = ['Head_end', 'Head', 'mixamorig:HeadTop_End', 'mixamorig:Head'];

// Badge offset above the head-bone anchor, expressed in BONE-local units
// (the bone inherits the inner group's NPC_SCALE, so 0.3 here ≈ 0.15 m
// world for the husky — enough clearance to clear the ear silhouette in
// idle pose without floating absurdly far above the head).
const BADGE_HEAD_BONE_OFFSET = 0.3;

// Fallback Y offset when no head bone is addressable. Pre-scale local units
// inside `<group scale={NPC_SCALE}>` — the husky's rest-pose silhouette top
// reaches ~3.2 local units (0.5 × 3.2 ≈ 1.6 m world per the NPC_SCALE
// comment above), and we add ~10 cm world clearance ÷ NPC_SCALE for the
// §5-mandated gap above the silhouette.
const BADGE_GROUP_FALLBACK_OFFSET = 3.4;

function findHeadBone(root: Object3D): Object3D | null {
  for (const name of HEAD_BONE_NAMES) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  return null;
}

useGLTF.preload(NPC_GLB_URL);

export interface NpcProps {
  position: Vec2;
  target: Vec2 | null;
  /** Optional non-walking facing target. Only honored when there is no walk
   *  target — walking always faces the direction of travel. */
  facingTarget?: Vec2 | null;
  groundY?: number;
  /** Current NPC emotion. When provided alongside `bible`, the EmotionBadge
   *  renders inside the rig subtree (DWEA-70 §5 conformance). */
  emotion?: EmotionState;
  bible?: MonsterBible;
  onPositionChange: (next: Vec2) => void;
  onTargetReached: () => void;
}

export function Npc(props: NpcProps) {
  return (
    <Suspense fallback={null}>
      <RiggedNpc {...props} />
    </Suspense>
  );
}

function RiggedNpc({
  position,
  target,
  facingTarget = null,
  groundY = 0,
  emotion,
  bible,
  onPositionChange,
  onTargetReached,
}: NpcProps) {
  const group = useRef<Group>(null);
  const gltf = useGLTF(NPC_GLB_URL);

  // Per-mount clone of the GLB scene so this NPC's skeleton is independent
  // of the player Character's husky (drei caches the original gltf.scene).
  const scene = useMemo(() => {
    const cloned = SkeletonUtils.clone(gltf.scene);
    cloned.traverse((obj) => {
      const mesh = obj as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return cloned;
  }, [gltf.scene]);

  // §5 anchor: prefer the head bone for animation-aware tracking, fall back
  // to the inner group with a constant local-Y if no addressable head bone
  // ships in this rig (DWEA-70). Memoized on `scene` so the lookup runs once
  // per cloned skeleton.
  const headBone = useMemo(() => findHeadBone(scene), [scene]);

  // Build the AnimationMixer + idle/walk actions once per cloned scene.
  const animation = useMemo(() => {
    const mixer = new AnimationMixer(scene);
    const actions: Record<'idle' | 'walk', AnimationAction | null> = {
      idle: null,
      walk: null,
    };
    for (const clip of gltf.animations) {
      const name = clip.name.toLowerCase();
      if (name === 'idle' || name === 'walk') {
        const action = mixer.clipAction(clip);
        action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
        actions[name] = action;
      }
    }
    return { mixer, actions };
  }, [scene, gltf.animations]);

  // Default to idle on mount so the NPC is animating before any walk target.
  useEffect(() => {
    const idle = animation.actions.idle;
    idle?.reset().fadeIn(ANIM_FADE).play();
    return () => {
      animation.mixer.stopAllAction();
    };
  }, [animation]);

  const currentClip = useRef<NpcClip>('idle');

  useFrame((state, delta) => {
    const { next, reached } = stepTowardTarget(position, target, delta);
    if (next.x !== position.x || next.z !== position.z) {
      onPositionChange(next);
    }
    if (target && reached) {
      onTargetReached();
    }

    if (group.current) {
      group.current.position.x = next.x;
      group.current.position.z = next.z;
      group.current.position.y = groundY + FEET_CLEARANCE;

      // Facing priority: walk direction > brain look_at > camera. The camera
      // fallback keeps the husky engaged with the user during idle moments
      // instead of stiffly staring at world origin (DWEA-34 review feedback).
      if (target && !reached) {
        const yaw = npcFacingYaw(next, target);
        if (yaw !== null) {
          group.current.rotation.y = yaw;
        }
      } else if (facingTarget) {
        const yaw = npcFacingYaw(next, facingTarget);
        if (yaw !== null) {
          group.current.rotation.y = yaw;
        }
      } else {
        const cam = state.camera.position;
        const yaw = npcFacingYaw(next, { x: cam.x, z: cam.z });
        if (yaw !== null) {
          group.current.rotation.y = yaw;
        }
      }
    }

    // Drive idle ↔ walk based on whether we have an unreached target.
    const wantClip = pickNpcClip(target, reached);
    if (wantClip !== currentClip.current) {
      const next = animation.actions[wantClip];
      const prev = animation.actions[currentClip.current];
      next?.reset().fadeIn(ANIM_FADE).play();
      prev?.fadeOut(ANIM_FADE);
      currentClip.current = wantClip;
    }

    animation.mixer.update(delta);
  });

  // Badge mount point: the bone if we found one (best path — follows the
  // rig through animation and any future GLB swap), else the inner scaled
  // group as a fallback. `position` on the badge is therefore in PARENT-
  // local space, not world units — no `groundY + 1.6` literal anywhere.
  const badge =
    emotion && bible ? (
      headBone ? (
        createPortal(
          <EmotionBadge offsetY={BADGE_HEAD_BONE_OFFSET} emotion={emotion} bible={bible} />,
          headBone,
        )
      ) : (
        <EmotionBadge offsetY={BADGE_GROUP_FALLBACK_OFFSET} emotion={emotion} bible={bible} />
      )
    ) : null;

  return (
    <group ref={group} name="npc-soldier" scale={NPC_SCALE}>
      <primitive object={scene} />
      {badge}
    </group>
  );
}
