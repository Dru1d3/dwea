import { describe, expect, it, vi } from 'vitest';
import type { BrainAction } from '../llm/brain.js';
import { DEFAULT_EMOTION } from './emotion.js';
import { createNpcIntent } from './intent.js';

function makeDeps() {
  let emotion = { ...DEFAULT_EMOTION };
  return {
    setTarget: vi.fn(),
    setFacingTarget: vi.fn(),
    playClip: vi.fn(),
    setEmotion: vi.fn((next: typeof DEFAULT_EMOTION) => {
      emotion = next;
    }),
    getEmotion: vi.fn(() => emotion),
    snapshotEmotion: () => emotion,
  };
}

describe('createNpcIntent', () => {
  it('walk_to forwards XZ to setTarget', () => {
    const deps = makeDeps();
    const surface = createNpcIntent(deps);
    surface.walk_to({ x: 2, z: -3 });
    expect(deps.setTarget).toHaveBeenCalledWith({ x: 2, z: -3 });
  });

  it('look_at routes through setFacingTarget so it never starts a walk', () => {
    const deps = makeDeps();
    const surface = createNpcIntent(deps);
    surface.look_at({ x: 1, z: 1 });
    expect(deps.setFacingTarget).toHaveBeenCalledWith({ x: 1, z: 1 });
    expect(deps.setTarget).not.toHaveBeenCalled();
  });

  it('set_face clamps intensity to [0,1]', () => {
    const deps = makeDeps();
    const surface = createNpcIntent(deps);
    surface.set_face('happy', 4);
    expect(deps.setEmotion).toHaveBeenCalled();
    const last = deps.setEmotion.mock.calls.at(-1)?.[0];
    expect(last?.expression).toBe('happy');
    expect(last?.intensity).toBe(1);
  });

  it('set_face with empty expression keeps the prior expression', () => {
    const deps = makeDeps();
    deps.setEmotion({ expression: 'curious', intensity: 0.5, updatedAt: 0 });
    const surface = createNpcIntent(deps);
    surface.set_face('', 0.9);
    const last = deps.setEmotion.mock.calls.at(-1)?.[0];
    expect(last?.expression).toBe('curious');
    expect(last?.intensity).toBe(0.9);
  });

  it('dispatchAll fans actions out in order, ignoring empty-clip animation', () => {
    const deps = makeDeps();
    const surface = createNpcIntent(deps);
    const actions: BrainAction[] = [
      { kind: 'walk_to', x: 1, z: 2, clip: '', expression: '', intensity: 0 },
      { kind: 'play_animation', x: 0, z: 0, clip: '', expression: '', intensity: 0 },
      { kind: 'play_animation', x: 0, z: 0, clip: 'walk', expression: '', intensity: 0 },
      { kind: 'look_at', x: -1, z: -1, clip: '', expression: '', intensity: 0 },
      { kind: 'set_face', x: 0, z: 0, clip: '', expression: 'happy', intensity: 0.6 },
    ];
    surface.dispatchAll(actions);
    expect(deps.setTarget).toHaveBeenCalledWith({ x: 1, z: 2 });
    expect(deps.playClip).toHaveBeenCalledTimes(1);
    expect(deps.playClip).toHaveBeenCalledWith('walk');
    expect(deps.setFacingTarget).toHaveBeenCalledWith({ x: -1, z: -1 });
    const lastEmotion = deps.setEmotion.mock.calls.at(-1)?.[0];
    expect(lastEmotion?.expression).toBe('happy');
  });
});
