import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { type AnimationAction, AnimationMixer, type Group, LoopRepeat } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { type NpcClip, npcFacingYaw, pickNpcClip, stepTowardTarget } from './movement.js';
import { attachSplatRendering } from './splatRig.js';
import type { Vec2 } from './types.js';

const SOLDIER_URL = `${import.meta.env.BASE_URL}models/Soldier.glb`;

// The animation cross-fade window. Short fade → snappy idle↔walk transitions.
const ANIM_FADE = 0.18;

// Mara is the demo "monster" NPC — scale her up from native human (1.83 m)
// so she reads as a creature rather than a tiny background figure at the
// camera distances the splat scenes use.
const NPC_SCALE = 1.6;

// Soldier.glb's feet sit at y=0 in scene-local; lifting the rig by this much
// keeps her toes visibly above the noisy splat floor in scenes where the
// lower percentile of gaussians sits a few cm above navigation.groundY.
const FEET_CLEARANCE = 0.05;

useGLTF.preload(SOLDIER_URL);

export interface NpcProps {
  position: Vec2;
  target: Vec2 | null;
  groundY?: number;
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

function RiggedNpc({ position, target, groundY = 0, onPositionChange, onTargetReached }: NpcProps) {
  const group = useRef<Group>(null);
  const gltf = useGLTF(SOLDIER_URL);

  // Per-mount clone of the GLB scene so this NPC's skeleton is independent
  // of the player Character's Soldier (drei caches the original gltf.scene).
  // We then swap every SkinnedMesh on the clone for a sibling Points cloud
  // with a gaussian-falloff splat shader, so Mara reads as a 3D Gaussian
  // Splat reconstruction rather than a triangle-shaded mesh — matching the
  // splat aesthetic of the surrounding scene.
  const scene = useMemo(() => {
    const cloned = SkeletonUtils.clone(gltf.scene);
    attachSplatRendering(cloned);
    return cloned;
  }, [gltf.scene]);

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

  useFrame((_, delta) => {
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

      // Face direction of travel when walking; preserve last facing on the
      // arrival frame so we don't snap to a zero-length direction.
      if (target && !reached) {
        const yaw = npcFacingYaw(next, target);
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

  return (
    <group ref={group} name="npc-soldier" scale={NPC_SCALE}>
      <primitive object={scene} />
    </group>
  );
}
