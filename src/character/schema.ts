/**
 * 5-tool function-calling schema for the LLM motor (DWEA-18 / T3).
 *
 * The schema is the contract between Anthropic Claude and the action queue.
 * Tool names and arg shapes are exact-matches of the plan — T2's intent
 * surface (DWEA-17) dispatches by tool name, so any rename here breaks the
 * contract on both sides.
 */

export const HEAD = 'head';
export const ARMS = 'arms';
export const LEGS = 'legs';
export const VOICE = 'voice';

export type Resource = typeof HEAD | typeof ARMS | typeof LEGS | typeof VOICE;

export interface MoveToArgs {
  x: number;
  y: number;
  z: number;
}

export interface LookAtArgs {
  target_id: string;
}

export type AnimationMode = 'queue' | 'interrupt';

export interface PlayAnimationArgs {
  clip_id: string;
  mode: AnimationMode;
}

export interface PointAtArgs {
  target_id: string;
}

export interface SpeakArgs {
  text: string;
}

export type ToolCall =
  | { name: 'move_to'; input: MoveToArgs }
  | { name: 'look_at'; input: LookAtArgs }
  | { name: 'play_animation'; input: PlayAnimationArgs }
  | { name: 'point_at'; input: PointAtArgs }
  | { name: 'speak'; input: SpeakArgs };

export type ToolName = ToolCall['name'];

// Per-resource locks per the plan: head (look_at), right-arm (point_at,
// play_animation), legs (move_to, play_animation). play_animation claims
// the full body so it can override head/arm IK on cross-fade. speak holds
// only the voice channel — it never blocks motion.
export const TOOL_RESOURCES: Record<ToolName, ReadonlyArray<Resource>> = {
  move_to: [LEGS],
  look_at: [HEAD],
  play_animation: [HEAD, ARMS, LEGS],
  point_at: [ARMS],
  speak: [VOICE],
};

interface AnthropicTool {
  name: ToolName;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const TOOLS: ReadonlyArray<AnthropicTool> = [
  {
    name: 'move_to',
    description:
      'Walk the character to a world-space coordinate (meters). Y is the floor anchor; the runtime locks to the navigation surface.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'World X coordinate in meters.' },
        y: {
          type: 'number',
          description: 'World Y coordinate in meters. Usually the floor (often 0).',
        },
        z: { type: 'number', description: 'World Z coordinate in meters.' },
      },
      required: ['x', 'y', 'z'],
    },
  },
  {
    name: 'look_at',
    description:
      "Aim the character's head/spine at a registered scene-graph id. Common ids: 'camera', 'user', or any named anchor or NPC. Releases automatically when superseded.",
    input_schema: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: "Scene-graph id (e.g. 'camera', 'rock', 'npc.guide').",
        },
      },
      required: ['target_id'],
    },
  },
  {
    name: 'play_animation',
    description:
      "Cross-fade into a named animation clip. Use mode 'queue' to run after pending full-body actions; use mode 'interrupt' to clear the action queue and start immediately. Use 'interrupt' for stops, idles, or any urgent reset.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: {
          type: 'string',
          description: "Animation clip id from the loaded GLB (e.g. 'idle', 'wave', 'dance').",
        },
        mode: {
          type: 'string',
          enum: ['queue', 'interrupt'],
          description:
            'queue = run after pending actions; interrupt = clear the action queue and run now.',
        },
      },
      required: ['clip_id', 'mode'],
    },
  },
  {
    name: 'point_at',
    description:
      "Aim the character's right arm at a registered scene-graph id via IK. Releases the arm when superseded by play_animation or another point_at.",
    input_schema: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: 'Scene-graph id of the target to point at.',
        },
      },
      required: ['target_id'],
    },
  },
  {
    name: 'speak',
    description:
      'Speak a short utterance through the browser TTS surface. Non-blocking — text appears in the chat panel as well. Keep lines conversational and short.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to say.' },
      },
      required: ['text'],
    },
  },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export class ToolCallParseError extends Error {
  readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(`tool ${toolName}: ${message}`);
    this.name = 'ToolCallParseError';
    this.toolName = toolName;
  }
}

/**
 * Parse a model-emitted (name, raw input) pair into a typed ToolCall.
 * Throws ToolCallParseError when the input doesn't conform to the schema —
 * the caller (motor) reports the error and skips the dispatch.
 */
export function parseToolCall(name: string, input: unknown): ToolCall {
  if (!isObj(input)) {
    throw new ToolCallParseError(name, 'input is not an object');
  }
  switch (name) {
    case 'move_to': {
      const x = num(input.x);
      const y = num(input.y);
      const z = num(input.z);
      if (x === undefined || y === undefined || z === undefined) {
        throw new ToolCallParseError(name, 'requires numeric x, y, z');
      }
      return { name: 'move_to', input: { x, y, z } };
    }
    case 'look_at': {
      const target = str(input.target_id);
      if (!target) throw new ToolCallParseError(name, 'requires target_id string');
      return { name: 'look_at', input: { target_id: target } };
    }
    case 'play_animation': {
      const clip = str(input.clip_id);
      const mode = input.mode;
      if (!clip) throw new ToolCallParseError(name, 'requires clip_id string');
      if (mode !== 'queue' && mode !== 'interrupt') {
        throw new ToolCallParseError(name, "mode must be 'queue' or 'interrupt'");
      }
      return { name: 'play_animation', input: { clip_id: clip, mode } };
    }
    case 'point_at': {
      const target = str(input.target_id);
      if (!target) throw new ToolCallParseError(name, 'requires target_id string');
      return { name: 'point_at', input: { target_id: target } };
    }
    case 'speak': {
      const text = str(input.text);
      if (!text) throw new ToolCallParseError(name, 'requires text string');
      return { name: 'speak', input: { text } };
    }
    default:
      throw new ToolCallParseError(name, 'unknown tool name');
  }
}
