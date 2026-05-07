import { describe, expect, it } from 'vitest';
import { STUB_ANIMATION_SET, buildStubAnimationClips } from './animations.js';
import { MIXAMO_BONE_NAMES } from './humanoid.js';

describe('stub humanoid clips', () => {
  it('builds clips with the names ecctrl expects to address', () => {
    const clips = buildStubAnimationClips();
    const names = new Set(clips.map((c) => c.name));
    for (const slot of Object.values(STUB_ANIMATION_SET)) {
      expect(names.has(slot)).toBe(true);
    }
  });

  it('walk clip targets contralateral hip and shoulder bones', () => {
    const walk = buildStubAnimationClips().find((c) => c.name === 'walk');
    expect(walk).toBeDefined();
    const tracked = new Set(walk?.tracks.map((t) => t.name) ?? []);
    expect(tracked.has('rHip.quaternion')).toBe(true);
    expect(tracked.has('lHip.quaternion')).toBe(true);
    expect(tracked.has('rShoulder.quaternion')).toBe(true);
    expect(tracked.has('lShoulder.quaternion')).toBe(true);
  });

  it('retargets walk tracks to Mixamo bone names when given the Mixamo map', () => {
    const walk = buildStubAnimationClips(MIXAMO_BONE_NAMES).find((c) => c.name === 'walk');
    expect(walk).toBeDefined();
    const tracked = new Set(walk?.tracks.map((t) => t.name) ?? []);
    expect(tracked.has('mixamorigRightUpLeg.quaternion')).toBe(true);
    expect(tracked.has('mixamorigLeftUpLeg.quaternion')).toBe(true);
    expect(tracked.has('mixamorigRightArm.quaternion')).toBe(true);
    expect(tracked.has('mixamorigLeftArm.quaternion')).toBe(true);
    expect(tracked.has('rHip.quaternion')).toBe(false);
  });
});
