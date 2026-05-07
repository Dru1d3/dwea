/**
 * Structured-output "brain" for an LLM-driven 3D monster.
 *
 * Roll-your-own pattern: a frontier-class LLM hosted via OpenRouter, prompted
 * with a character bible, returns a strict JSON envelope each turn:
 *
 *   { schemaVersion, utterance, emotion, intention, actions[], world_model }
 *
 * The renderer never sees raw model text; it dispatches `actions[]` against
 * an action surface (walk_to / look_at / play_animation / set_face) and
 * speaks `utterance` through the configured TTS. `world_model` is consumed
 * by structured logs / QA harness — see [docs/decisions/0010-world-model-envelope.md](../../docs/decisions/0010-world-model-envelope.md).
 *
 * One round-trip per user turn, non-streaming. Streaming JSON-schema parsing
 * is fragile and the envelopes are short (~400 tokens), so the simpler shape
 * pays off in latency consistency.
 */
import type { MonsterBible } from './bible.js';
import {
  type BrainMemoryMutation,
  CORE_MEMORY_FILES,
  type CoreMemoryFile,
} from './memory/types.js';
import { MAX_HISTORY_TURNS, MAX_OUTPUT_TOKENS, sceneStatePreamble } from './personality.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Bumped from '1' -> '1.1' to mark the addition of the `world_model` block.
 * Consumers that pin an exact version must read [docs/decisions/0010-world-model-envelope.md](../../docs/decisions/0010-world-model-envelope.md)
 * — the envelope is additive (v1 fields unchanged) but the version moves so
 * downstream tooling can branch on shape without sniffing keys.
 */
export const BRAIN_SCHEMA_VERSION = '1.1';

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

/**
 * Theory-of-mind / persona-state block. Populated every turn so persona,
 * goals, and drift become *inspectable* outputs instead of implicit context
 * that the v1.5 QA harness has to reverse-engineer from chat logs.
 *
 * - `believes_user_knows`: facts the character thinks the user already
 *   knows. Drives whether the character re-explains things or trusts shared
 *   ground.
 * - `last_user_intent`: 1-line summary of what the user just asked/wanted.
 *   Lets the planner check that the model actually grokked the user's turn.
 * - `secrets_to_protect`: facts the character knows but the user shouldn't
 *   learn yet. Surfaces persona leak risk.
 * - `goal`: what the character is trying to achieve this turn / scene.
 *   Compared against utterance/actions to flag goal drift.
 * - `mood_drift`: signed [-1, 1] estimate of how far the character has
 *   drifted from base persona. >0.5 trips a QA-harness warning.
 */
export interface WorldModel {
  believes_user_knows: string[];
  last_user_intent: string;
  secrets_to_protect: string[];
  goal: string;
  mood_drift: number;
}

export interface MonsterResponse {
  schemaVersion: string;
  utterance: string;
  emotion: string;
  intention: string;
  actions: BrainAction[];
  world_model: WorldModel;
  /**
   * Memory mutations the brain wants to commit at end-of-turn. Applied by
   * `applyBrainMutations` (see ../memory/snapshot.ts) against the
   * (character, user) memory store. Empty arrays are normal — most turns
   * don't update memory. The snapshot/mutation loop is the OpenRouter-side
   * approximation of Claude's native memory tool; the same Claude path is
   * available via `executeMemoryCommand` in ../memory/anthropic.ts.
   */
  memory_writes: BrainMemoryMutation[];
}

const ACTION_FIELDS = ['kind', 'x', 'z', 'clip', 'expression', 'intensity'] as const;

const MEMORY_WRITE_FIELDS = ['file', 'op', 'content', 'secret'] as const;
const MEMORY_OPS = ['', 'append', 'replace'] as const;
const MEMORY_FILES_ENUM = ['', ...CORE_MEMORY_FILES] as const;
/** Hard cap on memory_writes per turn so a misfire can't stuff the store. */
const MAX_MEMORY_WRITES_PER_TURN = 4;

const WORLD_MODEL_FIELDS = [
  'believes_user_knows',
  'last_user_intent',
  'secrets_to_protect',
  'goal',
  'mood_drift',
] as const;

/** Bound the drift estimate to its declared range so a runaway model can't
 *  poison downstream warning thresholds. */
function clampMoodDrift(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return 1;
  if (n < -1) return -1;
  return n;
}

/** A safe `world_model` placeholder used when the model omits or mangles the
 *  block. We do NOT throw — v1.1 success criterion only requires ≥90%
 *  coverage; a default keeps the renderer/voice path running while the QA
 *  harness flags the gap from structured logs. */
function defaultWorldModel(): WorldModel {
  return {
    believes_user_knows: [],
    last_user_intent: '',
    secrets_to_protect: [],
    goal: '',
    mood_drift: 0,
  };
}

function parseStringArray(v: unknown, cap = 8): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function isCoreMemoryFile(s: string): s is CoreMemoryFile {
  return (CORE_MEMORY_FILES as readonly string[]).includes(s);
}

function parseMemoryWrites(v: unknown): BrainMemoryMutation[] {
  if (!Array.isArray(v)) return [];
  const out: BrainMemoryMutation[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const fileRaw = typeof entry.file === 'string' ? entry.file : '';
    const opRaw = typeof entry.op === 'string' ? entry.op : '';
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    const secret = entry.secret === true;
    const file: BrainMemoryMutation['file'] =
      fileRaw === '' ? '' : isCoreMemoryFile(fileRaw) ? fileRaw : '';
    const op: BrainMemoryMutation['op'] = opRaw === 'append' || opRaw === 'replace' ? opRaw : '';
    if (!content) continue;
    if (!secret && (!file || !op)) continue;
    out.push({ file, op, content, secret });
    if (out.length >= MAX_MEMORY_WRITES_PER_TURN) break;
  }
  return out;
}

function parseWorldModel(v: unknown): WorldModel {
  if (!isObject(v)) return defaultWorldModel();
  const goal = typeof v.goal === 'string' ? v.goal.trim() : '';
  const lastUserIntent = typeof v.last_user_intent === 'string' ? v.last_user_intent.trim() : '';
  const moodDrift = typeof v.mood_drift === 'number' ? clampMoodDrift(v.mood_drift) : 0;
  return {
    believes_user_knows: parseStringArray(v.believes_user_knows),
    last_user_intent: lastUserIntent,
    secrets_to_protect: parseStringArray(v.secrets_to_protect),
    goal,
    mood_drift: moodDrift,
  };
}

function buildSchema(bible: MonsterBible): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'utterance',
      'emotion',
      'intention',
      'actions',
      'world_model',
      'memory_writes',
    ],
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
      world_model: {
        type: 'object',
        additionalProperties: false,
        required: [...WORLD_MODEL_FIELDS],
        properties: {
          believes_user_knows: { type: 'array', items: { type: 'string' } },
          last_user_intent: { type: 'string' },
          secrets_to_protect: { type: 'array', items: { type: 'string' } },
          goal: { type: 'string' },
          mood_drift: { type: 'number', minimum: -1, maximum: 1 },
        },
      },
      memory_writes: {
        type: 'array',
        maxItems: MAX_MEMORY_WRITES_PER_TURN,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...MEMORY_WRITE_FIELDS],
          properties: {
            file: { type: 'string', enum: [...MEMORY_FILES_ENUM] },
            op: { type: 'string', enum: [...MEMORY_OPS] },
            content: { type: 'string' },
            secret: { type: 'boolean' },
          },
        },
      },
    },
  };
}

/**
 * Stand-alone export of the JSON schema for the v1.1 envelope. The brain
 * itself uses `buildSchema` (above) which inlines the bible-specific emotion
 * vocab; this helper is for external consumers (planner, FE, QA harness)
 * that just need to validate the envelope shape without instantiating a
 * bible. Keep them in sync.
 */
export function getBrainEnvelopeSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'MonsterBrainEnvelope',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'utterance',
      'emotion',
      'intention',
      'actions',
      'world_model',
      'memory_writes',
    ],
    properties: {
      schemaVersion: { type: 'string', const: BRAIN_SCHEMA_VERSION },
      utterance: { type: 'string' },
      emotion: { type: 'string' },
      intention: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
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
      world_model: {
        type: 'object',
        required: [...WORLD_MODEL_FIELDS],
        properties: {
          believes_user_knows: { type: 'array', items: { type: 'string' } },
          last_user_intent: { type: 'string' },
          secrets_to_protect: { type: 'array', items: { type: 'string' } },
          goal: { type: 'string' },
          mood_drift: { type: 'number', minimum: -1, maximum: 1 },
        },
      },
      memory_writes: {
        type: 'array',
        maxItems: MAX_MEMORY_WRITES_PER_TURN,
        items: {
          type: 'object',
          required: [...MEMORY_WRITE_FIELDS],
          properties: {
            file: { type: 'string', enum: [...MEMORY_FILES_ENUM] },
            op: { type: 'string', enum: [...MEMORY_OPS] },
            content: { type: 'string' },
            secret: { type: 'boolean' },
          },
        },
      },
    },
  };
}

function buildBrainPrompt(bible: MonsterBible, memoryPreamble: string | null): string {
  return [
    bible.systemPrompt,
    '',
    ...(memoryPreamble && memoryPreamble.trim().length > 0 ? [memoryPreamble.trim(), ''] : []),
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
    '',
    'world_model — populate every turn. This is your private theory-of-mind state. The user never sees it; the renderer never reads it; it exists so we can inspect what you think is going on:',
    '- believes_user_knows: short list (0-5 items) of facts about the world or about you that you think the user already knows. Concrete and specific. Add to it as the conversation reveals shared ground; remove items only if the user shows they have forgotten.',
    '- last_user_intent: one short sentence summarising what the user just asked, wanted, or signalled in their most recent message. Plain language; no quotes.',
    '- secrets_to_protect: short list (0-5 items) of facts you know but the user has not yet learned. Use it to track persona depth; leave empty if you have no secrets in this scene.',
    '- goal: one short sentence describing what you are trying to achieve in this turn or scene. May change between turns.',
    '- mood_drift: a single number in [-1.0, 1.0] estimating how far you have drifted from your base persona. 0 means perfectly in character; positive means warmer/more familiar than baseline; negative means colder/more guarded. Be honest — if a long hostile thread has pulled you out of character, raise the magnitude.',
    'Populate world_model with your best honest estimate even on the very first turn (use empty arrays and short strings if you have nothing yet). Do not skip the block; the schema rejects any reply that omits it.',
    '',
    'memory_writes — at most 4 entries per turn. Use them to commit something memorable about the user back to your long-term memory. Each entry has:',
    `- file: one of "" (skip), ${CORE_MEMORY_FILES.map((f) => `"${f}"`).join(', ')}.`,
    '- op: "" (skip), "append" to add a bullet, or "replace" to rewrite the whole file.',
    '- content: the text to write. Short, concrete, factual. No quotes, no greetings, no narration.',
    '- secret: true ONLY when the fact is a persona secret the user must not learn (encrypted at rest). Otherwise false.',
    'Write sparingly: most turns should emit an empty memory_writes array. Only write when the user reveals their name, a strong preference, an event the character should remember next time, or an emotional beat worth carrying forward. Do NOT write memory entries that paraphrase a secret you were told to protect — keep secrets out of facts_about_user / relationship_state / important_events.',
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

  const world_model = parseWorldModel(parsed.world_model);
  const memory_writes = parseMemoryWrites(parsed.memory_writes);

  return {
    schemaVersion: BRAIN_SCHEMA_VERSION,
    utterance,
    emotion,
    intention,
    actions,
    world_model,
    memory_writes,
  };
}

export interface BrainCallArgs {
  apiKey: string;
  bible: MonsterBible;
  history: readonly ChatTurn[];
  userMessage: string;
  scene: SceneState;
  signal?: AbortSignal;
  /**
   * Markdown block produced by `renderMemoryPreamble` (../memory/snapshot.ts).
   * Spliced into the system prompt so the model sees memory before it
   * generates this turn. Optional — first-meet sessions pass `null` and the
   * brain still works (the preamble is empty by design).
   */
  memoryPreamble?: string | null;
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
  const { apiKey, bible, history, userMessage, scene, signal, memoryPreamble } = args;

  const trimmed = trimHistory(history);
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: buildBrainPrompt(bible, memoryPreamble ?? null) },
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
  const choice = replyJson.choices?.[0];
  const content = choice?.message?.content ?? '';
  if (choice?.finish_reason === 'length') {
    // Token budget cut the JSON mid-emit. Tell the user something useful
    // instead of leaking the JSON parser's "Unexpected EOF" downstream.
    throw new Error('brain: reply truncated (raise MAX_OUTPUT_TOKENS)');
  }
  const response = parseMonsterResponse(content, bible);
  const totalMs = performance.now() - startedAt;

  return { response, firstByteMs, totalMs, modeUsed: mode };
}

/**
 * Fire-and-forget warmup against OpenRouter. The free-tier providers we
 * route to have noticeable cold-starts on first request — pre-warming the
 * route while the user is still inspecting the scene saves ~3-8 s off the
 * first real reply. Failures are swallowed: a warm-up that fails just means
 * the next real call pays the full cold-start.
 */
export async function prewarmBrain(
  apiKey: string,
  bible: MonsterBible,
  signal?: AbortSignal,
): Promise<void> {
  if (!apiKey) return;
  try {
    await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          typeof window === 'undefined' ? 'https://dwea.local' : window.location.origin,
        'X-Title': 'DWEA',
      },
      body: JSON.stringify({
        model: bible.model,
        max_tokens: 1,
        stream: false,
        reasoning: { exclude: true, effort: 'low' },
        provider: { sort: 'throughput' },
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });
  } catch {
    // Warmup is best-effort; the next real call pays the cold-start instead.
  }
}
