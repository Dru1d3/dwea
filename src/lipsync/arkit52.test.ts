import { describe, expect, it } from 'vitest';
import {
  ARKIT_52_CHANNELS,
  ARKIT_52_LENGTH,
  type MorphTargetMesh,
  applyFrameToMesh,
  channelIndex,
  frameFromSparse,
  jawOpenOf,
  lerpFrame,
} from './arkit52.js';

describe('ARKit-52 channel table', () => {
  it('has exactly 52 unique channels in canonical order', () => {
    expect(ARKIT_52_LENGTH).toBe(52);
    expect(new Set(ARKIT_52_CHANNELS).size).toBe(52);
    expect(ARKIT_52_CHANNELS[0]).toBe('eyeBlinkLeft');
    expect(ARKIT_52_CHANNELS[17]).toBe('jawOpen');
    expect(ARKIT_52_CHANNELS[51]).toBe('tongueOut');
  });

  it('channelIndex resolves canonical positions', () => {
    expect(channelIndex('eyeBlinkLeft')).toBe(0);
    expect(channelIndex('jawOpen')).toBe(17);
    expect(channelIndex('tongueOut')).toBe(51);
  });
});

describe('frameFromSparse', () => {
  it('fills missing channels with zero', () => {
    const f = frameFromSparse({ jawOpen: 0.7, mouthSmileLeft: 0.4 });
    expect(f).toHaveLength(52);
    expect(f[channelIndex('jawOpen')]).toBe(0.7);
    expect(f[channelIndex('mouthSmileLeft')]).toBe(0.4);
    expect(f[channelIndex('cheekPuff')]).toBe(0);
  });
});

describe('lerpFrame', () => {
  it('blends each channel by t and clamps t to [0, 1]', () => {
    const a = frameFromSparse({ jawOpen: 0 });
    const b = frameFromSparse({ jawOpen: 1 });
    expect(lerpFrame(a, b, 0)[17]).toBe(0);
    expect(lerpFrame(a, b, 1)[17]).toBe(1);
    expect(lerpFrame(a, b, 0.25)[17]).toBeCloseTo(0.25);
    expect(lerpFrame(a, b, -1)[17]).toBe(0);
    expect(lerpFrame(a, b, 5)[17]).toBe(1);
  });
});

describe('applyFrameToMesh', () => {
  it('writes morph influences keyed by the mesh dictionary', () => {
    const mesh: MorphTargetMesh = {
      morphTargetDictionary: { jawOpen: 0, mouthSmileLeft: 1 },
      morphTargetInfluences: [0, 0],
    };
    const frame = frameFromSparse({ jawOpen: 0.6, mouthSmileLeft: 0.2 });
    applyFrameToMesh(mesh, frame);
    expect(mesh.morphTargetInfluences).toEqual([0.6, 0.2]);
  });

  it('silently skips channels missing from the mesh dictionary', () => {
    // Lip-only rig: only `jawOpen` exists on the mesh. A full ARKit-52
    // stream should not throw on the missing brow / eye channels.
    const mesh: MorphTargetMesh = {
      morphTargetDictionary: { jawOpen: 0 },
      morphTargetInfluences: [0],
    };
    const frame = frameFromSparse({ jawOpen: 0.9, browInnerUp: 0.5, eyeBlinkLeft: 1 });
    expect(() => applyFrameToMesh(mesh, frame)).not.toThrow();
    expect(mesh.morphTargetInfluences).toEqual([0.9]);
  });

  it('is a no-op when the mesh has no morph targets', () => {
    const mesh: MorphTargetMesh = {};
    const frame = frameFromSparse({ jawOpen: 0.5 });
    expect(() => applyFrameToMesh(mesh, frame)).not.toThrow();
  });
});

describe('jawOpenOf', () => {
  it('returns the jaw-open coefficient out of an ARKit-52 frame', () => {
    expect(jawOpenOf(frameFromSparse({ jawOpen: 0.4 }))).toBe(0.4);
    expect(jawOpenOf(frameFromSparse({}))).toBe(0);
  });
});
