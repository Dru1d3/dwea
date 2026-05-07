/**
 * OpenAI-compatible tool definitions for the 5-tool LLM motor (DWEA-30).
 *
 * The motor sends these as `tools: [...]` on every OpenRouter chat call, and
 * dispatches the streamed `tool_calls` back through the existing
 * `CharacterIntentSurface` defined in `src/character/intent.ts`. Names and
 * arg shapes track the original DWEA-18 schema so a future swap back to
 * Anthropic-direct (or any other tool-calling provider) is a one-file edit.
 *
 * Why an OpenAI tool format here, even though the runtime intent surface
 * already exists in `src/character/intent.ts`: the runtime surface is keyed
 * to live `Object3D`/`Vector3` instances (great for in-app dispatch, useless
 * to send to a model). The schema below is the LLM-facing contract — JSON
 * primitives only, plus a small target-id vocabulary the resolver below
 * understands.
 */

import { type ClipName, KNOWN_ANIMATION_CLIPS } from '../character/intent.js';

/** Reserved scene-graph ids the model may pass to look_at / point_at. */
export const KNOWN_TARGET_IDS = ['camera', 'user', 'player', 'self', 'origin'] as const;
export type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];

/**
 * OpenAI-style tool spec sent to OpenRouter. Each entry is a plain object so
 * we can serialize directly into the `tools` array on the request body.
 */
export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export const CHARACTER_TOOLS: ReadonlyArray<OpenAiTool> = [
  {
    type: 'function',
    function: {
      name: 'move_to',
      description:
        'Walk the character to a world-space coordinate (meters). Y is the floor anchor; the runtime locks to the navigation surface. Use small offsets relative to the character; values typically fall in [-30, 30].',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'World X coordinate in meters.' },
          y: { type: 'number', description: 'World Y coordinate in meters. Usually 0 (floor).' },
          z: { type: 'number', description: 'World Z coordinate in meters.' },
        },
        required: ['x', 'y', 'z'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at',
      description:
        "Aim the character's head/spine at a target. `target_id` accepts: 'camera' or 'user' (look at the viewer), 'self' or 'origin' (reset). For an arbitrary world point, pass `point: { x, y, z }` instead and omit `target_id`.",
      parameters: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            description: "One of 'camera', 'user', 'player', 'self', 'origin'.",
            enum: [...KNOWN_TARGET_IDS],
          },
          point: {
            type: 'object',
            description: 'World-space point to look at. Use instead of target_id.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_animation',
      description:
        "Cross-fade into a named animation clip. Use mode 'queue' to run after pending full-body actions; use 'interrupt' for stops, idles, or any urgent reset.",
      parameters: {
        type: 'object',
        properties: {
          clip: {
            type: 'string',
            enum: [...KNOWN_ANIMATION_CLIPS],
            description: `Animation clip id. One of: ${KNOWN_ANIMATION_CLIPS.join(', ')}.`,
          },
          mode: {
            type: 'string',
            enum: ['queue', 'interrupt'],
            description: 'queue = run after pending actions; interrupt = run now.',
          },
        },
        required: ['clip', 'mode'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'point_at',
      description:
        "Aim the character's right arm at a target. Same target rules as look_at: pass `target_id` for a known anchor, or `point` for a world coordinate.",
      parameters: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            enum: [...KNOWN_TARGET_IDS],
          },
          point: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speak',
      description:
        "Speak a short utterance aloud. Keep it to one or two short sentences — the player sees this in the chat panel as Mara's reply, and a future TTS layer will voice it.",
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The utterance.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * The motor's parsed view of a tool call. Targets resolve to enum-ish unions
 * the renderer can dispatch directly.
 */
export type Point3 = { readonly x: number; readonly y: number; readonly z: number };

export type ParsedTarget =
  | { readonly kind: 'camera' }
  | { readonly kind: 'self' }
  | { readonly kind: 'point'; readonly point: Point3 };

export type ParsedToolCall =
  | { readonly name: 'move_to'; readonly point: Point3 }
  | { readonly name: 'look_at'; readonly target: ParsedTarget }
  | {
      readonly name: 'play_animation';
      readonly clip: ClipName;
      readonly mode: 'queue' | 'interrupt';
    }
  | { readonly name: 'point_at'; readonly target: ParsedTarget }
  | { readonly name: 'speak'; readonly text: string };

export class ToolCallParseError extends Error {
  readonly toolName: string;
  constructor(toolName: string, message: string) {
    super(`tool ${toolName}: ${message}`);
    this.name = 'ToolCallParseError';
    this.toolName = toolName;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parsePoint(name: string, raw: unknown): Point3 {
  if (!isObj(raw)) {
    throw new ToolCallParseError(name, 'point is not an object');
  }
  const x = num(raw.x);
  const y = num(raw.y);
  const z = num(raw.z);
  if (x === undefined || y === undefined || z === undefined) {
    throw new ToolCallParseError(name, 'point requires numeric x, y, z');
  }
  return { x, y, z };
}

function parseTarget(name: string, input: Record<string, unknown>): ParsedTarget {
  const id = str(input.target_id);
  if (id) {
    switch (id) {
      case 'camera':
      case 'user':
      case 'player':
        return { kind: 'camera' };
      case 'self':
      case 'origin':
        return { kind: 'self' };
      default:
        // Unknown id — point at world origin so the model gets visible
        // feedback rather than a silent no-op.
        return { kind: 'self' };
    }
  }
  if (input.point !== undefined) {
    return { kind: 'point', point: parsePoint(name, input.point) };
  }
  throw new ToolCallParseError(name, 'requires target_id or point');
}

/**
 * Parse a (name, raw input) pair from the SSE stream into a typed call.
 * Throws ToolCallParseError for shape problems — the motor reports + skips.
 */
export function parseToolCall(name: string, input: unknown): ParsedToolCall {
  if (!isObj(input)) {
    throw new ToolCallParseError(name, 'input is not an object');
  }
  switch (name) {
    case 'move_to':
      return { name: 'move_to', point: parsePoint(name, input) };
    case 'look_at':
      return { name: 'look_at', target: parseTarget(name, input) };
    case 'play_animation': {
      const clip = str(input.clip);
      const mode = input.mode;
      if (!clip || !KNOWN_ANIMATION_CLIPS.includes(clip as ClipName)) {
        throw new ToolCallParseError(
          name,
          `clip must be one of ${KNOWN_ANIMATION_CLIPS.join(', ')}`,
        );
      }
      if (mode !== 'queue' && mode !== 'interrupt') {
        throw new ToolCallParseError(name, "mode must be 'queue' or 'interrupt'");
      }
      return { name: 'play_animation', clip: clip as ClipName, mode };
    }
    case 'point_at':
      return { name: 'point_at', target: parseTarget(name, input) };
    case 'speak': {
      const text = str(input.text);
      if (!text) throw new ToolCallParseError(name, 'requires non-empty text');
      return { name: 'speak', text };
    }
    default:
      throw new ToolCallParseError(name, 'unknown tool name');
  }
}
