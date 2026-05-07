/**
 * MonsterBible — the per-character config that shapes one creature's brain.
 *
 * The brain ([brain.ts](./brain.ts)) is character-agnostic; everything that
 * varies per monster (name, persona, emotion vocabulary, voice tuning,
 * model choice) lives here. Swap a bible at config time to ship a different
 * personality without touching the runtime.
 */

import { MAX_OUTPUT_TOKENS, NPC_MODEL, NPC_NAME, SYSTEM_PROMPT } from './personality.js';

export interface MonsterBible {
  /** Internal id; used for telemetry and per-character localStorage keys. */
  id: string;
  /** Display name for the chat header and TTS voice profile picking. */
  name: string;
  /** Brief species/silhouette tag for the bubble UI ("husky pup", "spirit"). */
  species: string;
  /** OpenRouter model id. Free-tier compatible by default. */
  model: string;
  /** Per-call cap; bibles can ask for tighter/looser ceilings. */
  maxOutputTokens?: number;
  /** Persona text — the brain's system prompt up to the action-rules block. */
  systemPrompt: string;
  /** Allowed emotion keywords. The first one is the implicit default. */
  emotionVocab: ReadonlyArray<string>;
  /** Resting emotion when the model output is empty/invalid. */
  defaultEmotion?: string;
  /** Animation clips the renderer can satisfy. Empty string is valid. */
  clipVocab: ReadonlyArray<string>;
  /** TTS voice profile. Web Speech maps `voiceHint` against the OS voice list. */
  voice: {
    rate: number;
    pitch: number;
    /** Substring matched (case-insensitive) against SpeechSynthesisVoice.name. */
    voiceHint?: string;
    /** BCP-47 language tag preference (e.g. 'en-GB'). */
    lang?: string;
  };
  /** Emoji shown in the floating face badge per emotion. Used as a v0 stand-in
   *  for blendshapes; the husky model has none. */
  emotionEmoji: Readonly<Record<string, string>>;
}

/**
 * Mara — the default ("hero monster") bible. Mirrors the existing
 * [personality.ts](./personality.ts) prompt so the prototype demos against
 * the character we already have art and tests for. CEO can swap to a
 * different bible by editing `defaultBible` in [App.tsx](../App.tsx).
 */
export const MARA_BIBLE: MonsterBible = {
  id: 'mara',
  name: NPC_NAME,
  species: 'small wandering spirit',
  model: NPC_MODEL,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  systemPrompt: SYSTEM_PROMPT,
  emotionVocab: [
    'neutral',
    'happy',
    'curious',
    'wistful',
    'playful',
    'surprised',
    'uneasy',
    'sleepy',
  ],
  defaultEmotion: 'neutral',
  clipVocab: ['idle', 'walk', ''],
  voice: {
    rate: 1.05,
    pitch: 1.15,
    voiceHint: 'samantha',
    lang: 'en-US',
  },
  emotionEmoji: {
    neutral: '🙂',
    happy: '😊',
    curious: '🤨',
    wistful: '🥺',
    playful: '😋',
    surprised: '😲',
    uneasy: '😟',
    sleepy: '😴',
  },
};

export const defaultBible: MonsterBible = MARA_BIBLE;
