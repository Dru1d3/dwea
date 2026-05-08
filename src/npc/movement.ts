import { driftAndSettle } from '../visual/curves.js';
import type { Vec2 } from './types.js';

export const NPC_WALK_SPEED = 1.5; // world units per second
export const NPC_TARGET_REACHED_EPSILON = 0.05;
export const NPC_BOB_AMPLITUDE = 0.08;
export const NPC_BOB_FREQUENCY = 1.4; // hz
// World convention: 1 unit = 1 m, ground plane at Y=0 (see ADR 0007).
// Mara is a floating spirit-NPC that hovers ~0.8 m off the ground; per-scene
// overrides still come from the splat registry's `navigation.groundY`.
export const SCENE_GROUND_Y = 0;
export const NPC_FLOAT_OFFSET = 0.8;
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
 * Vertical idle bob — Mara's spirit hover (Visual Style Bible §3.1, §5.2).
 * Decoupled from walk motion so we can stack the two. `baseHeight` defaults
 * to the synthetic-grid scene height; pass a per-scene value
 * (groundY + NPC_FLOAT_OFFSET) for splat scenes with a different ground.
 *
 * Bible §5.2 forbids linear lerp on character motion. The bob shape comes
 * from `driftAndSettle` (slow ease-in-out + low-frequency bob) folded over a
 * triangle phase so the loop seam at `idleBob(0)` repeats cleanly. This is
 * the in-runtime proof that §5.2 curves drive shipped motion (DWEA-61).
 */
export function idleBob(elapsedSeconds: number, baseHeight: number = NPC_BASE_HEIGHT): number {
  const halfPeriod = 1 / NPC_BOB_FREQUENCY;
  const triangle = (elapsedSeconds / halfPeriod) % 2;
  const t = triangle <= 1 ? triangle : 2 - triangle;
  // driftAndSettle returns 0..1; map symmetrically to ±NPC_BOB_AMPLITUDE so
  // Mara hovers above and below `baseHeight` instead of only on one side.
  const offset = (driftAndSettle(t) * 2 - 1) * NPC_BOB_AMPLITUDE;
  return baseHeight + offset;
}

export type NpcClip = 'idle' | 'walk';

/**
 * Pick the animation clip the NPC should be playing this frame. The NPC is
 * walking only when there is a target it has not yet reached; everything else
 * (no target, target reached, target equal to current position) is idle.
 */
export function pickNpcClip(target: Vec2 | null, reached: boolean): NpcClip {
  return target && !reached ? 'walk' : 'idle';
}

/**
 * Yaw (radians, around world Y) the NPC needs so its rig front faces the
 * target. The Quaternius husky GLB (DWEA-32) faces world +Z at rest — its
 * head points at +Z, tail at -Z. The yaw is the angle that takes that
 * +Z front vector onto the (target - current) direction.
 *
 * Returns null when there's no movement direction (no target, or target is
 * the current position) so callers can preserve the previous facing.
 */
export function npcFacingYaw(from: Vec2, to: Vec2): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return null;
  return Math.atan2(dx, dz);
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
