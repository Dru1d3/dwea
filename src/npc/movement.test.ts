import { describe, expect, it } from 'vitest';
import {
  NPC_BASE_HEIGHT,
  idleBob,
  npcFacingYaw,
  pickNpcClip,
  randomWanderTarget,
  stepTowardTarget,
} from './movement.js';

describe('stepTowardTarget', () => {
  it('returns the same position when no target is set', () => {
    const result = stepTowardTarget({ x: 1, z: 2 }, null, 0.1);
    expect(result).toEqual({ next: { x: 1, z: 2 }, reached: true });
  });

  it('walks part of the way at the configured speed', () => {
    const result = stepTowardTarget({ x: 0, z: 0 }, { x: 10, z: 0 }, 1);
    // speed 1.5, dt 1 → moved 1.5 units toward (10, 0)
    expect(result.next.x).toBeCloseTo(1.5, 5);
    expect(result.next.z).toBeCloseTo(0, 5);
    expect(result.reached).toBe(false);
  });

  it('snaps to target when within epsilon', () => {
    const result = stepTowardTarget({ x: 0.99, z: 0 }, { x: 1, z: 0 }, 0.001);
    expect(result.next).toEqual({ x: 1, z: 0 });
    expect(result.reached).toBe(true);
  });

  it('does not overshoot a near target', () => {
    const result = stepTowardTarget({ x: 0, z: 0 }, { x: 0.1, z: 0 }, 1);
    expect(result.next.x).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(result.reached).toBe(true);
  });
});

describe('idleBob', () => {
  it('oscillates around the base height', () => {
    const samples = Array.from({ length: 60 }, (_, i) => idleBob(i / 60));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // Amplitude check: peak-to-peak ≥ 0.1, well below the bob amplitude bound.
    expect(max - min).toBeGreaterThan(0.1);
    // Mara stays close to the configured base height (NPC_BASE_HEIGHT).
    expect(min).toBeGreaterThan(NPC_BASE_HEIGHT - 0.2);
    expect(max).toBeLessThan(NPC_BASE_HEIGHT + 0.2);
  });
});

describe('pickNpcClip', () => {
  it('returns walk when there is an unreached target', () => {
    expect(pickNpcClip({ x: 1, z: 0 }, false)).toBe('walk');
  });

  it('returns idle when there is no target', () => {
    expect(pickNpcClip(null, false)).toBe('idle');
    expect(pickNpcClip(null, true)).toBe('idle');
  });

  it('returns idle on the frame the target is reached', () => {
    expect(pickNpcClip({ x: 1, z: 0 }, true)).toBe('idle');
  });
});

describe('npcFacingYaw', () => {
  // Husky rig (DWEA-32) faces +Z at rest. With rotation.y = 0 the model's
  // head points at +Z, so a target with larger z (straight ahead) should
  // yield yaw 0. These cases lock the four cardinal directions in.
  const TWO_PI = Math.PI * 2;
  const wrap = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

  it('returns null when there is no movement direction', () => {
    expect(npcFacingYaw({ x: 0, z: 0 }, { x: 0, z: 0 })).toBeNull();
  });

  it('faces +Z (forward) for a target with larger z', () => {
    const yaw = npcFacingYaw({ x: 0, z: 0 }, { x: 0, z: 1 });
    expect(yaw).not.toBeNull();
    expect(wrap(yaw as number)).toBeCloseTo(0, 5);
  });

  it('faces +X for a target to the right (rotation.y = π/2)', () => {
    const yaw = npcFacingYaw({ x: 0, z: 0 }, { x: 1, z: 0 });
    expect(yaw).not.toBeNull();
    expect(wrap(yaw as number)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('faces -X for a target to the left (rotation.y = -π/2 ≡ 3π/2)', () => {
    const yaw = npcFacingYaw({ x: 0, z: 0 }, { x: -1, z: 0 });
    expect(yaw).not.toBeNull();
    expect(wrap(yaw as number)).toBeCloseTo((3 * Math.PI) / 2, 5);
  });

  it('faces -Z (backward) for a target with smaller z', () => {
    const yaw = npcFacingYaw({ x: 0, z: 0 }, { x: 0, z: -1 });
    expect(yaw).not.toBeNull();
    expect(wrap(yaw as number)).toBeCloseTo(Math.PI, 5);
  });
});

describe('randomWanderTarget', () => {
  it('stays within the requested radius of the anchor', () => {
    const anchor = { x: 5, z: -2 };
    for (let i = 0; i < 50; i++) {
      const t = randomWanderTarget(anchor, 2);
      const distance = Math.hypot(t.x - anchor.x, t.z - anchor.z);
      expect(distance).toBeLessThanOrEqual(2 + 1e-6);
    }
  });
});
