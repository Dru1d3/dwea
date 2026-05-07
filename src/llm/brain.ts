/**
 * Structured-output "brain" for an LLM-driven 3D monster.
 *
 * Roll-your-own pattern: a frontier-class LLM hosted via OpenRouter, prompted
 * with a character bible, returns a strict JSON envelope each turn:
 *
 *   { schemaVersion, utterance, emotion, intention, actions[] }
 *
 * The renderer never sees raw model text; it dispatches `actions[]` against
 * an action surface (walk_to / look_at / play_animation / set_face) and
 * speaks `utterance` through the configured TTS.
 *
 * One round-trip per user turn, non-streaming. Streaming JSON-schema parsing
 * is fragile and the envelopes are short (~250 tokens), so the simpler shape
 * pays off in latency consistency.
 */
import type { MonsterBible } from './bible.js';
import { MAX_HISTORY_TURNS, MAX_OUTPUT_TOKENS, sceneStatePreamble } from './personality.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const BRAIN_SCHEMA_VERSION = '1';

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  text: string;
}

export interface SceneState {
  position: { x: number; z: number };
  lastClickTarget: { x: number; z: number } | null;
}

/**
 * Action shape sent by the brain. We use a flat schema (every field present
 * on every action) because OpenAI / OpenRouter strict json_schema mode does
 * not accept oneOf / discriminated unions. The dispatcher reads `kind` and
 * picks the relevant fields per action.
 */
export interface BrainAction {
  kind: 'walk_to' | 'look_at' | 'play_animation' | 'set_face';
  /** walk_to / look_at — world-space XZ. Zero for non-positional actions. */
  x: number;
  z: number;
  /** play_animation — clip name. Empty string for non-animation actions. */
  clip: string;
  /** set_face — expression keyword (mirrors `emotion`). Empty otherwise. */
  expression: string;
  /** set_face — 0..1 strength. Zero otherwise. */
  intensity: number;
}

export interface MonsterResponse {
  schemaVersion: string;
  utterance: string;
  emotion: string;
  intention: string;
  actions: BrainAction[];
}

const ACTION_FIELDS = ['kind', 'x', 'z', 'clip', 'expression', 'intensity'] as const;

function buildSchema(bible: MonsterBible): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'utterance', 'emotion', 'intention', 'actions'],
    properties: {
      schemaVersion: { type: 'string', const: BRAIN_SCHEMA_VERSION },
      utterance: { type: 'string' },
      emotion: { type: 'string', enum: [...bible.emotionVocab] },
      intention: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...ACTION_FIELDS],
          properties: {
            kind: { type: 'string', enum: ['walk_to', 'look_at', 'play_animation', 'set_face'] },
            x: { type: 'number' },
            z: { type: 'number' },
            clip: { type: 'string' },
            expression: { type: 'string' },
            intensity: { type: 'number' },
          },
        },
      },
    },
  };
}

function buildBrainPrompt(bible: MonsterBible): string {
  return [
    bible.systemPrompt,
    '',
    'You speak through a strict JSON envelope. The renderer parses each field and animates your body — the user only ever hears the utterance. Every reply MUST be valid JSON matching the schema you were given. No code fences, no commentary outside the JSON, no trailing text.',
    'Inside string values, use ONLY valid JSON escapes (\\", \\\\, \\n, \\t, \\uXXXX). Plain text only — no emoticons, no smileys, no markdown formatting.',
    '',
    'Vocabulary you must stay inside:',
    `- emotion: one of ${bible.emotionVocab.join(', ')}`,
    `- play_animation.clip: one of ${bible.clipVocab.join(', ')} (empty string when no clip)`,
    '',
    'Action rules:',
    '- walk_to sets x and z to a scene XZ point in metres. Use it freely — trot toward something the user is curious about, scamper a few metres to a new spot, or bound back to them. Stay roughly within 3 m of your current XZ to keep the world readable. Set clip="", expression="", intensity=0.',
    '- look_at turns your head and body toward a scene XZ point. Use it before speaking about something nearby. Set clip="", expression="", intensity=0.',
    '- play_animation plays a known clip. Set x=0, z=0, expression="", intensity=0. Pick from the clip vocabulary above.',
    '- set_face expresses an emotion. expression must match the emotion vocabulary; intensity is a 0..1 float. Set x=0, z=0, clip="".',
    '',
    'You are a real, embodied creature — never just stand still. EVERY reply must include at least one action, and most replies should include 2 or 3. Combine actions: a typical turn is look_at, walk_to, and set_face together, or walk_to with play_animation. Idle staring is dull; pick a destination, react with your face, move.',
    'Stay short. utterance: 1 to 2 sentences. actions: 1 to 3 entries. Do not repeat the same action kind twice in one turn.',
    'Never narrate (no parentheticals, no stage directions). Never mention being an AI, a model, or a JSON schema. If the user is hostile or off-topic, gently steer back to the world around you in character.',
  ].join('\n');
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterChoice {
  message?: { content?: string | null };
  finish_reason?: string | null;
}

interface OpenRouterReply {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number };
}

function trimHistory(history: readonly ChatTurn[]): ChatTurn[] {
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  while (trimmed.length > 0 && trimmed[0]?.role !== 'user') {
    trimmed.shift();
  }
  return trimmed;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Repair common ways the free-tier model breaks JSON:
 *   - Wraps the envelope in ```json fences.
 *   - Emits non-standard backslash escapes inside strings (e.g. `\:`, `\!`,
 *     `\ ` for emoticons), which is the actual error class observed in the
 *     wild ("Invalid escape character :)" was a `\)` next to a smiley).
 *
 * Everything that survives sanitisation still has to satisfy `JSON.parse` —
 * we do NOT silently drop content, just neutralise the bytes we know strict
 * parsers refuse.
 */
export function sanitizeRawJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
    s = s.trim();
  }
  // Replace any backslash escape that isn't one of the JSON-allowed forms
  // ("\\\\", "\\\"", "\\/", "\\b", "\\f", "\\n", "\\r", "\\t", "\\uXXXX") with
  // just the literal character that followed the slash. This kills the
  // "\\:" / "\\)" / "\\(" sequences free models like to emit.
  s = s.replace(/\\([^"\\/bfnrtu])/g, '$1');
  // A trailing "\\u" with fewer than four hex digits is also fatal — drop it.
  s = s.replace(/\\u(?![0-9a-fA-F]{4})/g, '');
  return s;
}

/**
 * Defensive parser. Strict json_schema mode usually gives clean output, but
 * fallback (json_object) and provider drift mean we still validate every
 * field and coerce away the obvious junk before dispatch.
 */
export function parseMonsterResponse(raw: string, bible: MonsterBible): MonsterResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (firstErr) {
    // Free models occasionally emit ```json fences or non-JSON backslash
    // escapes (e.g. "\:" inside a smiley). Repair-and-retry once before
    // surfacing the error to the chat panel.
    try {
      parsed = JSON.parse(sanitizeRawJson(raw));
    } catch {
      throw new Error(`brain: invalid JSON (${(firstErr as Error).message})`);
    }
  }
  if (!isObject(parsed)) throw new Error('brain: response is not an object');

  const utterance = typeof parsed.utterance === 'string' ? parsed.utterance.trim() : '';
  if (!utterance) throw new Error('brain: missing utterance');

  const emotion =
    typeof parsed.emotion === 'string' && bible.emotionVocab.includes(parsed.emotion)
      ? parsed.emotion
      : (bible.defaultEmotion ?? bible.emotionVocab[0] ?? 'neutral');

  const intention = typeof parsed.intention === 'string' ? parsed.intention.trim() : '';

  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions: BrainAction[] = [];
  for (const entry of rawActions) {
    if (!isObject(entry)) continue;
    const kind = entry.kind;
    if (
      kind !== 'walk_to' &&
      kind !== 'look_at' &&
      kind !== 'play_animation' &&
      kind !== 'set_face'
    )
      continue;
    actions.push({
      kind,
      x: typeof entry.x === 'number' ? entry.x : 0,
      z: typeof entry.z === 'number' ? entry.z : 0,
      clip: typeof entry.clip === 'string' ? entry.clip : '',
      expression: typeof entry.expression === 'string' ? entry.expression : '',
      intensity: typeof entry.intensity === 'number' ? entry.intensity : 0,
    });
    if (actions.length >= 3) break;
  }

  return {
    schemaVersion: BRAIN_SCHEMA_VERSION,
    utterance,
    emotion,
    intention,
    actions,
  };
}

export interface BrainCallArgs {
  apiKey: string;
  bible: MonsterBible;
  history: readonly ChatTurn[];
  userMessage: string;
  scene: SceneState;
  signal?: AbortSignal;
}

export interface BrainCallResult {
  response: MonsterResponse;
  /** ms from request submit to first byte of body. */
  firstByteMs: number;
  /** ms from request submit to fully-parsed envelope. */
  totalMs: number;
  /** Which response_format mode the provider accepted. */
  modeUsed: 'json_schema' | 'json_object';
}

async function postOpenRouter(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ res: Response; firstByteMs: number; startedAt: number }> {
  const startedAt = performance.now();
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal: signal ?? null,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window === 'undefined' ? 'https://dwea.local' : window.location.origin,
      'X-Title': 'DWEA',
    },
    body: JSON.stringify(body),
  });
  const firstByteMs = performance.now() - startedAt;
  return { res, firstByteMs, startedAt };
}

/**
 * Run one turn of the brain. Tries strict json_schema; on provider rejection
 * (some free models on OpenRouter only accept json_object) retries once with
 * the looser format and the schema embedded in the system prompt.
 */
export async function runMonsterBrain(args: BrainCallArgs): Promise<BrainCallResult> {
  const { apiKey, bible, history, userMessage, scene, signal } = args;

  const trimmed = trimHistory(history);
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: buildBrainPrompt(bible) },
    ...trimmed.map((t) => ({ role: t.role, content: t.text })),
    {
      role: 'user',
      content: `${sceneStatePreamble(scene)}\n\n${userMessage}`,
    },
  ];

  const baseBody: Record<string, unknown> = {
    model: bible.model,
    max_tokens: bible.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    stream: false,
    reasoning: { exclude: true, effort: 'low' },
    provider: { sort: 'throughput' },
    messages,
  };

  const schema = buildSchema(bible);
  const strictBody = {
    ...baseBody,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'monster_response', strict: true, schema },
    },
  };

  let mode: 'json_schema' | 'json_object' = 'json_schema';
  let { res, firstByteMs, startedAt } = await postOpenRouter(apiKey, strictBody, signal);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const looksLikeFormatRejection =
      res.status === 400 && /(json_schema|response_format|structured)/i.test(text);
    if (!looksLikeFormatRejection) {
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }
    mode = 'json_object';
    const fallbackBody = { ...baseBody, response_format: { type: 'json_object' } };
    ({ res, firstByteMs, startedAt } = await postOpenRouter(apiKey, fallbackBody, signal));
    if (!res.ok) {
      const text2 = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${text2.slice(0, 200) || res.statusText}`);
    }
  }

  const replyJson = (await res.json()) as OpenRouterReply;
  if (replyJson.error) {
    throw new Error(replyJson.error.message ?? `OpenRouter error ${replyJson.error.code ?? ''}`);
  }
  const content = replyJson.choices?.[0]?.message?.content ?? '';
  const response = parseMonsterResponse(content, bible);
  const totalMs = performance.now() - startedAt;

  return { response, firstByteMs, totalMs, modeUsed: mode };
}
