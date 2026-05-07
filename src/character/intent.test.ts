import { Object3D, type Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterRef } from './Character.js';
import { CHARACTER_TOOL_SCHEMA, KNOWN_ANIMATION_CLIPS, createCharacterIntent } from './intent.js';

function createMockCharacterRef(): {
  ref: { current: CharacterRef | null };
  spies: Record<keyof CharacterRef, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    pointAt: vi.fn(),
    pointAtObject: vi.fn(),
    releasePointAt: vi.fn(),
    lookAt: vi.fn(),
    lookAtPoint: vi.fn(),
    releaseLookAt: vi.fn(),
    playAnimation: vi.fn(),
    moveTo: vi.fn(),
    getPosition: vi.fn((out: Vector3) => out),
    getHumanoid: vi.fn(() => null),
  } as const;
  return {
    ref: { current: spies as unknown as CharacterRef },
    spies,
  };
}

describe('createCharacterIntent', () => {
  const dummyCamera = new Object3D();

  it('move_to forwards a Vector3 to the character', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    intent.move_to(1, 2, 3);
    expect(spies.moveTo).toHaveBeenCalledTimes(1);
    const arg = spies.moveTo.mock.calls[0]?.[0] as Vector3;
    expect(arg.x).toBe(1);
    expect(arg.y).toBe(2);
    expect(arg.z).toBe(3);
  });

  it('look_at "camera" resolves the camera lazily', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    intent.look_at('camera');
    expect(spies.lookAt).toHaveBeenCalledWith(dummyCamera);
  });

  it('look_at with a plain {x,y,z} routes to lookAtPoint', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    intent.look_at({ x: 5, y: 0, z: -2 });
    expect(spies.lookAtPoint).toHaveBeenCalledTimes(1);
    const v = spies.lookAtPoint.mock.calls[0]?.[0] as Vector3;
    expect(v.x).toBe(5);
    expect(v.y).toBe(0);
    expect(v.z).toBe(-2);
  });

  it('point_at routes Object3D vs point arguments separately', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    const obj = new Object3D();
    intent.point_at(obj);
    intent.point_at({ x: 0, y: 1, z: 2 });
    expect(spies.pointAtObject).toHaveBeenCalledWith(obj);
    expect(spies.pointAt).toHaveBeenCalledTimes(1);
  });

  it('play_animation defaults mode to "queue"', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    intent.play_animation('walk');
    expect(spies.playAnimation).toHaveBeenCalledWith('walk', 'queue');
  });

  it('speak invokes the deps onSpeak hook', () => {
    const { ref } = createMockCharacterRef();
    const onSpeak = vi.fn();
    const intent = createCharacterIntent(ref, {
      resolveCamera: () => dummyCamera,
      onSpeak,
    });
    intent.speak('hello world');
    expect(onSpeak).toHaveBeenCalledWith('hello world');
  });

  it('dispatch unifies the typed intents', () => {
    const { ref, spies } = createMockCharacterRef();
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    intent.dispatch({ type: 'play_animation', clip: 'run', mode: 'interrupt' });
    expect(spies.playAnimation).toHaveBeenCalledWith('run', 'interrupt');
    intent.dispatch({ type: 'move_to', position: { x: 4, y: 5, z: 6 } });
    expect(spies.moveTo).toHaveBeenCalledTimes(1);
    intent.dispatch({ type: 'look_at', target: { kind: 'camera' } });
    expect(spies.lookAt).toHaveBeenCalledWith(dummyCamera);
  });

  it('throws if called before the character mounts', () => {
    const ref = { current: null };
    const intent = createCharacterIntent(ref, { resolveCamera: () => dummyCamera });
    expect(() => intent.move_to(0, 0, 0)).toThrow(/before <Character/);
  });
});

describe('schema constants', () => {
  it('exposes all five tools by name', () => {
    expect(CHARACTER_TOOL_SCHEMA.map((t) => t.name)).toEqual([
      'move_to',
      'look_at',
      'play_animation',
      'point_at',
      'speak',
    ]);
  });

  it('clip enum covers idle/walk/run/jump/wave/fall', () => {
    expect([...KNOWN_ANIMATION_CLIPS].sort()).toEqual(
      ['fall', 'idle', 'jump', 'run', 'walk', 'wave'].sort(),
    );
  });
});
