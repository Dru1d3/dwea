import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { idleBob, stepTowardTarget } from './movement.js';
import type { Vec2 } from './types.js';

/**
 * Placeholder mesh for Mara: a soft glowing capsule with two eye-dots.
 * Walks toward `target` while it differs from `position`, otherwise bobs.
 *
 * This component owns no NPC state — the parent passes `position`, `target`,
 * and an `onPositionChange` callback. That keeps the LLM scene preamble in
 * sync with what the renderer is showing.
 */
export interface NpcProps {
  position: Vec2;
  target: Vec2 | null;
  onPositionChange: (next: Vec2) => void;
  onTargetReached: () => void;
}

export function Npc({ position, target, onPositionChange, onTargetReached }: NpcProps) {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;

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
      group.current.position.y = idleBob(elapsed.current);

      // Face direction of travel when walking.
      if (target && !reached) {
        const yaw = Math.atan2(target.x - next.x, target.z - next.z);
        group.current.rotation.y = yaw;
      }
    }
  });

  return (
    <group ref={group}>
      {/* Soft glow sphere */}
      <mesh>
        <sphereGeometry args={[0.32, 24, 16]} />
        <meshStandardMaterial
          color="#9be7ff"
          emissive="#5dd4ff"
          emissiveIntensity={0.9}
          roughness={0.3}
          metalness={0.0}
        />
      </mesh>
      {/* Halo ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.36, 0.42, 32]} />
        <meshBasicMaterial color="#bff3ff" transparent opacity={0.35} />
      </mesh>
      {/* Eyes — two tiny dark orbs facing +Z (the "front" we yaw to face) */}
      <mesh position={[-0.08, 0.06, 0.28]}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color="#0c1f2c" />
      </mesh>
      <mesh position={[0.08, 0.06, 0.28]}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color="#0c1f2c" />
      </mesh>
      {/* Subtle point light so the splat catches Mara's glow */}
      <pointLight color="#9be7ff" intensity={1.2} distance={2.5} decay={2} />
    </group>
  );
}
