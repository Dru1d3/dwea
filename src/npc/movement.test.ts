import { describe, expect, it } from 'vitest';
import { idleBob, randomWanderTarget, stepTowardTarget } from './movement.js';

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
    // Mara stays close to the configured base height (currently -1.0).
    const baseExpected = -1.0;
    expect(min).toBeGreaterThan(baseExpected - 0.2);
    expect(max).toBeLessThan(baseExpected + 0.2);
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
