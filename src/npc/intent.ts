/**
 * NPC action surface — the imperative API the brain dispatches against.
 *
 * Mirrors the v0 action vocabulary in [DWEA-34](/DWEA/issues/DWEA-34):
 * `walk_to`, `look_at`, `play_animation`, `set_face`. Bound to the husky
 * NPC's state hook in [App.tsx](../App.tsx); the player [Character](../character/Character.tsx)
 * has a parallel surface in [character/intent.ts](../character/intent.ts).
 *
 * `set_face` cannot drive blendshapes on the current husky GLB (no morph
 * targets) so it pushes into the [emotion state](./emotion.ts) instead, which
 * the [EmotionBadge](./EmotionBadge.tsx) renders as a floating face bubble.
 */
import type { BrainAction } from '../llm/brain.js';
import type { EmotionState } from './emotion.js';
import type { Vec2 } from './types.js';

export interface NpcIntentSurface {
  walk_to: (point: Vec2) => void;
  look_at: (point: Vec2) => void;
  play_animation: (clip: string) => void;
  set_face: (expression: string, intensity: number) => void;
  /** Bulk-apply an action list from the brain in order. */
  dispatchAll: (actions: readonly BrainAction[]) => void;
}

export interface NpcIntentDeps {
  /** From [state.ts](./state.ts) — moves Mara to a clicked target. */
  setTarget: (target: Vec2 | null) => void;
  /** Sets a non-walking facing target. Implemented in state.ts as a separate
   *  channel so look_at doesn't require a walk. */
  setFacingTarget: (target: Vec2 | null) => void;
  /** Hint for the renderer to play a one-shot clip. Ignored if the clip is
   *  unknown to the model. */
  playClip: (clip: string) => void;
  /** Update the emotion state read by [EmotionBadge](./EmotionBadge.tsx). */
  setEmotion: (next: EmotionState) => void;
  /** Latest emotion read so set_face without an emotion key falls back. */
  getEmotion: () => EmotionState;
}

/**
 * Build the surface bound to the supplied deps. Returns a stable object so
 * callers can capture it once and dispatch from event handlers.
 */
export function createNpcIntent(deps: NpcIntentDeps): NpcIntentSurface {
  const surface: NpcIntentSurface = {
    walk_to(point) {
      deps.setTarget(point);
    },
    look_at(point) {
      deps.setFacingTarget(point);
    },
    play_animation(clip) {
      deps.playClip(clip);
    },
    set_face(expression, intensity) {
      const current = deps.getEmotion();
      const expr = expression.trim();
      // Intensity sanitisation: clamp to [0,1]; treat NaN as the existing
      // intensity so repeated set_face calls don't reset the bubble strength.
      const safe =
        Number.isFinite(intensity) && intensity >= 0 ? Math.min(intensity, 1) : current.intensity;
      deps.setEmotion({
        expression: expr || current.expression,
        intensity: safe,
        updatedAt: performance.now(),
      });
    },
    dispatchAll(actions) {
      for (const a of actions) {
        switch (a.kind) {
          case 'walk_to':
            surface.walk_to({ x: a.x, z: a.z });
            break;
          case 'look_at':
            surface.look_at({ x: a.x, z: a.z });
            break;
          case 'play_animation':
            if (a.clip) surface.play_animation(a.clip);
            break;
          case 'set_face':
            surface.set_face(a.expression, a.intensity);
            break;
        }
      }
    },
  };
  return surface;
}
