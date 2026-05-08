import { describe, expect, it } from 'vitest';
import { DEFAULT_ORBIT, poseAt } from './orbit.js';

describe('poseAt', () => {
  it('starts on the +X side of the orbit at t=0', () => {
    const pose = poseAt(0);
    expect(pose.position[0]).toBeCloseTo(DEFAULT_ORBIT.center[0] + DEFAULT_ORBIT.radius, 5);
    expect(pose.position[2]).toBeCloseTo(DEFAULT_ORBIT.center[2], 5);
    expect(pose.target).toEqual(DEFAULT_ORBIT.center);
  });

  it('returns to the starting horizontal position after a full period', () => {
    const a = poseAt(0);
    const b = poseAt(DEFAULT_ORBIT.periodSec);
    expect(b.position[0]).toBeCloseTo(a.position[0], 5);
    expect(b.position[2]).toBeCloseTo(a.position[2], 5);
  });

  it('keeps the camera at center.height ± bob amplitude', () => {
    for (let t = 0; t < DEFAULT_ORBIT.periodSec; t += 0.1) {
      const pose = poseAt(t);
      const offset = pose.position[1] - (DEFAULT_ORBIT.center[1] + DEFAULT_ORBIT.height);
      expect(Math.abs(offset)).toBeLessThanOrEqual(DEFAULT_ORBIT.bob + 1e-6);
    }
  });
});
