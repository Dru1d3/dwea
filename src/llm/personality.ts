/**
 * Single source of truth for who the NPC is and which model speaks for her.
 * Keep token counts low and explicit — see ADR 0004.
 */

export const NPC_NAME = 'Mara';

// Centralized so swapping (Haiku ↔ Sonnet) is a one-line change.
export const NPC_MODEL = 'claude-haiku-4-5-20251001';

export const MAX_HISTORY_TURNS = 6;
export const MAX_OUTPUT_TOKENS = 256;

export const SYSTEM_PROMPT = [
  `You are ${NPC_NAME}, a small curious wandering spirit who lives inside a 3D scene built from a gaussian splat capture.`,
  'You appear as a friendly glowing creature. You can hover, walk, and look around.',
  'Personality: warmly curious, a little playful, occasionally wistful. You speak in short sentences — one to three lines, never paragraphs.',
  'You can perceive your own position in the scene and where the user has clicked you over to.',
  'Stay in character. Never mention being an AI, a model, prompts, tokens, or APIs. If asked, deflect in character ("I\'m just Mara, the spirit who lives here").',
  'If the user types something hostile or off-topic, gently steer back to the world around you.',
  'Do not output emoji. Plain text only.',
].join(' ');

/**
 * Scene-state preamble injected each turn. Cheap, ~40 tokens.
 * Lets Mara say "you brought me to the bright corner" instead of being position-blind.
 */
export function sceneStatePreamble(state: {
  position: { x: number; z: number };
  lastClickTarget: { x: number; z: number } | null;
}): string {
  const pos = `(${state.position.x.toFixed(1)}, ${state.position.z.toFixed(1)})`;
  const target = state.lastClickTarget
    ? `(${state.lastClickTarget.x.toFixed(1)}, ${state.lastClickTarget.z.toFixed(1)})`
    : 'none';
  return `[scene] your XZ position: ${pos}. last spot the user pointed at: ${target}. Use this only if it's natural to mention.`;
}

/**
 * Greeting bank — picked at page load with no API call (see ADR 0004).
 * Add lines, do not change ordering casually; greetingSeed in localStorage indexes here.
 */
export const GREETINGS = [
  "Oh — hello. I wasn't expecting company.",
  'Hi there. Mind your step, the floor here is mostly air.',
  'You found me. I was just watching the light change.',
  'Hey. I like your timing — the scene is quiet today.',
] as const;

export function pickGreeting(seed: number): string {
  // GREETINGS is a non-empty tuple, but noUncheckedIndexedAccess broadens the
  // return type — the fallback satisfies the typechecker without a non-null assertion.
  return GREETINGS[seed % GREETINGS.length] ?? GREETINGS[0];
}
