import type { Vec2 } from './types.js';

export const NPC_WALK_SPEED = 1.5; // world units per second
export const NPC_TARGET_REACHED_EPSILON = 0.05;
export const NPC_BOB_AMPLITUDE = 0.08;
export const NPC_BOB_FREQUENCY = 1.4; // hz
// Mara floats ~0.6 above the scene's ground plane. The default ground sits at
// -1.6 (matches the synthetic grid in Environment.tsx); per-scene overrides
// come from the splat registry's `navigation.groundY`.
export const SCENE_GROUND_Y = -1.6;
export const NPC_FLOAT_OFFSET = 0.6;
export const NPC_BASE_HEIGHT = SCENE_GROUND_Y + NPC_FLOAT_OFFSET;

/**
 * Pure step function — given current position, optional target, and elapsed
 * delta seconds, return the next position and whether the target was reached.
 * Pure-ish: no shared state, easy to unit test.
 */
export function stepTowardTarget(
  position: Vec2,
  target: Vec2 | null,
  deltaSeconds: number,
): { next: Vec2; reached: boolean } {
  if (!target) {
    return { next: position, reached: true };
  }

  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const distance = Math.hypot(dx, dz);

  if (distance <= NPC_TARGET_REACHED_EPSILON) {
    return { next: { x: target.x, z: target.z }, reached: true };
  }

  const maxStep = NPC_WALK_SPEED * deltaSeconds;
  const step = Math.min(distance, maxStep);
  const ratio = step / distance;
  // If our step covered the whole gap, we've arrived this frame.
  const reached = step >= distance;

  return {
    next: {
      x: position.x + dx * ratio,
      z: position.z + dz * ratio,
    },
    reached,
  };
}

/**
 * Vertical idle bob. Decoupled from walk motion so we can stack the two.
 * `baseHeight` defaults to the synthetic-grid scene height; pass a per-scene
 * value (groundY + NPC_FLOAT_OFFSET) for splat scenes with a different ground.
 */
export function idleBob(elapsedSeconds: number, baseHeight: number = NPC_BASE_HEIGHT): number {
  return (
    baseHeight + Math.sin(elapsedSeconds * NPC_BOB_FREQUENCY * Math.PI * 2) * NPC_BOB_AMPLITUDE
  );
}

/**
 * Pick a small random wander target around an anchor. Keeps Mara on-screen.
 */
export function randomWanderTarget(anchor: Vec2, radius = 1.5): Vec2 {
  const angle = Math.random() * Math.PI * 2;
  const r = radius * (0.4 + Math.random() * 0.6);
  return {
    x: anchor.x + Math.cos(angle) * r,
    z: anchor.z + Math.sin(angle) * r,
  };
}
