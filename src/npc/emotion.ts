/**
 * Emotion state — the visible-face channel for the LLM-driven monster.
 *
 * The husky GLB has no morph targets, so v0 represents emotion as a floating
 * emoji bubble above the NPC ([EmotionBadge](./EmotionBadge.tsx)). Once we
 * pick a model with blendshapes (or a face-texture swap) the same state plugs
 * into the renderer instead.
 */

export interface EmotionState {
  /** A keyword from the active [MonsterBible](../llm/bible.ts).emotionVocab. */
  expression: string;
  /** 0..1 strength. Renderer can fade between the rest pose and full pose. */
  intensity: number;
  /** Wall-clock ms; lets renderers decay back to neutral after a quiet beat. */
  updatedAt: number;
}

export const DEFAULT_EMOTION: EmotionState = {
  expression: 'neutral',
  intensity: 0,
  updatedAt: 0,
};
