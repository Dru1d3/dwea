import { Object3D, Vector3 } from 'three';
import type { CharacterRef } from './Character.js';
import { STUB_ANIMATION_SET } from './animations.js';

/**
 * The five-tool intent surface the LLM motor (T3) imports.
 *
 * The runtime sits between the LLM and the renderer: when the model emits a
 * tool call, T3 maps it to one of these methods. Each call is deliberately
 * primitive so the LLM never reaches into Three.js or scene-graph internals.
 *
 * `speak` is a stub here — T4 owns the Web Speech API wiring.
 */

/** Names of the clips currently registered on the stub humanoid. */
export const KNOWN_ANIMATION_CLIPS = [
  STUB_ANIMATION_SET.idle,
  STUB_ANIMATION_SET.walk,
  STUB_ANIMATION_SET.run,
  STUB_ANIMATION_SET.jump,
  STUB_ANIMATION_SET.fall,
  STUB_ANIMATION_SET.action1,
] as const;

export type ClipName = (typeof KNOWN_ANIMATION_CLIPS)[number];

/** How a play_animation call composes with the currently-playing clip. */
export type AnimationDispatchMode = 'queue' | 'interrupt';

/**
 * Tool-call shapes — one per Tool in the plan's 5-tool schema. Mirrors
 * what an LLM function-call envelope passes us.
 */
export interface MoveToIntent {
  readonly type: 'move_to';
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export interface LookAtIntent {
  readonly type: 'look_at';
  /** World-space point to track, OR an Object3D the runtime resolves. */
  readonly target:
    | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly z: number }
    | { readonly kind: 'object'; readonly object: Object3D }
    | { readonly kind: 'camera' };
}

export interface PlayAnimationIntent {
  readonly type: 'play_animation';
  readonly clip: ClipName;
  readonly mode?: AnimationDispatchMode;
}

export interface PointAtIntent {
  readonly type: 'point_at';
  readonly target:
    | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly z: number }
    | { readonly kind: 'object'; readonly object: Object3D };
}

export interface SpeakIntent {
  readonly type: 'speak';
  readonly text: string;
}

export type CharacterIntent =
  | MoveToIntent
  | LookAtIntent
  | PlayAnimationIntent
  | PointAtIntent
  | SpeakIntent;

/**
 * Imperative intent surface. T3 calls these methods by hand from its
 * tool-call dispatcher; tests bind them to the in-app chat box.
 */
export interface CharacterIntentSurface {
  move_to(x: number, y: number, z: number): void;
  look_at(target: 'camera' | Object3D | { x: number; y: number; z: number }): void;
  play_animation(clip: ClipName, mode?: AnimationDispatchMode): void;
  point_at(target: Object3D | { x: number; y: number; z: number }): void;
  /** STUB: T4 wires this to the Web Speech API (or ElevenLabs later). */
  speak(text: string): void;
  /** Apply a tool-call envelope. Shorthand around the typed methods. */
  dispatch(intent: CharacterIntent): void;
}

interface IntentDeps {
  /**
   * Resolver for the active scene camera. Used when `look_at` is given the
   * `'camera'` shorthand. Pulled from R3F state at call time so camera
   * swaps just work.
   */
  readonly resolveCamera: () => Object3D;
  /** Optional handler for `speak` — typically wired by T4 to the Web Speech API. */
  readonly onSpeak?: (text: string) => void;
}

/**
 * Build the intent surface bound to a character ref. Returns a stable
 * object so T3 can store the reference outside React's render loop.
 */
export function createCharacterIntent(
  characterRef: { readonly current: CharacterRef | null },
  deps: IntentDeps,
): CharacterIntentSurface {
  function need(): CharacterRef {
    const c = characterRef.current;
    if (!c) {
      throw new Error('Character intent surface called before <Character /> mounted');
    }
    return c;
  }

  const surface: CharacterIntentSurface = {
    move_to(x, y, z) {
      need().moveTo(new Vector3(x, y, z));
    },
    look_at(target) {
      const c = need();
      if (target === 'camera') {
        c.lookAt(deps.resolveCamera());
        return;
      }
      if (target instanceof Object3D) {
        c.lookAt(target);
        return;
      }
      c.lookAtPoint(new Vector3(target.x, target.y, target.z));
    },
    play_animation(clip, mode = 'queue') {
      need().playAnimation(clip, mode);
    },
    point_at(target) {
      const c = need();
      if (target instanceof Object3D) {
        c.pointAtObject(target);
        return;
      }
      c.pointAt(new Vector3(target.x, target.y, target.z));
    },
    speak(text) {
      // STUB — log + delegate. T4 replaces this with Web Speech synthesis.
      if (typeof console !== 'undefined') {
        console.info(`[Character.speak] ${text}`);
      }
      deps.onSpeak?.(text);
    },
    dispatch(intent) {
      switch (intent.type) {
        case 'move_to':
          surface.move_to(intent.position.x, intent.position.y, intent.position.z);
          return;
        case 'look_at': {
          if (intent.target.kind === 'camera') {
            surface.look_at('camera');
          } else if (intent.target.kind === 'object') {
            surface.look_at(intent.target.object);
          } else {
            surface.look_at({ x: intent.target.x, y: intent.target.y, z: intent.target.z });
          }
          return;
        }
        case 'play_animation':
          surface.play_animation(intent.clip, intent.mode);
          return;
        case 'point_at': {
          if (intent.target.kind === 'object') {
            surface.point_at(intent.target.object);
          } else {
            surface.point_at({ x: intent.target.x, y: intent.target.y, z: intent.target.z });
          }
          return;
        }
        case 'speak':
          surface.speak(intent.text);
          return;
      }
    },
  };

  return surface;
}

/**
 * Schema metadata exported for T3's LLM tool registration. Mirrors the
 * plan's 5-tool schema. Keep this in sync with `CharacterIntent`.
 */
export const CHARACTER_TOOL_SCHEMA = [
  {
    name: 'move_to',
    description: 'Teleport the character to a world-space position.',
    parameters: ['x', 'y', 'z'],
  },
  {
    name: 'look_at',
    description: "Aim the character's head toward the camera, an object, or a world point.",
    parameters: ['target'],
  },
  {
    name: 'play_animation',
    description: 'Cross-fade into a named animation clip.',
    parameters: ['clip', 'mode'],
    enums: { clip: KNOWN_ANIMATION_CLIPS, mode: ['queue', 'interrupt'] as const },
  },
  {
    name: 'point_at',
    description: "Aim the character's right arm at an object or world-space point.",
    parameters: ['target'],
  },
  {
    name: 'speak',
    description: 'Speak the given utterance aloud (Web Speech API).',
    parameters: ['text'],
  },
] as const;

export type CharacterToolSchema = typeof CHARACTER_TOOL_SCHEMA;
