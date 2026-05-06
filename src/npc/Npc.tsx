import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { type AnimationAction, AnimationMixer, type Group, LoopRepeat } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { type NpcClip, pickNpcClip, stepTowardTarget } from './movement.js';
import type { Vec2 } from './types.js';

const SOLDIER_URL = `${import.meta.env.BASE_URL}models/Soldier.glb`;

// The animation cross-fade window. Short fade → snappy idle↔walk transitions.
const ANIM_FADE = 0.18;

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
      group.current.position.y = groundY;

      // Face direction of travel when walking.
      if (target && !reached) {
        const yaw = Math.atan2(target.x - next.x, target.z - next.z);
        group.current.rotation.y = yaw;
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
    <group ref={group} name="npc-soldier">
      <primitive object={scene} />
    </group>
  );
}
