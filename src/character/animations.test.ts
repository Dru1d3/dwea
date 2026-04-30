import { describe, expect, it } from 'vitest';
import { STUB_ANIMATION_SET, buildStubAnimationClips } from './animations.js';

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
});
