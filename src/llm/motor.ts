/**
 * OpenRouter tool-calling motor for Mara (DWEA-30).
 *
 * Streams a chat completion against an OpenRouter chat model with the 5-tool
 * schema attached, parses each `tool_calls` chunk as it arrives, and
 * dispatches to a `CharacterIntentSurface` so the rendered character moves
 * while the model is still generating. Free OpenRouter models speak the
 * OpenAI streaming dialect (`delta.tool_calls[].function.arguments` deltas)
 * so we follow that protocol verbatim.
 *
 * What this is NOT:
 *  - the strict-FIFO ActionQueue from the DWEA-18 prototype (deferred to a
 *    follow-up; not required for the first end-to-end demo).
 *  - a server-side gateway. Browser-direct, key in `.env` per DWEA-30 brief.
 */

import type { CharacterIntentSurface } from '../character/intent.js';
import {
  MAX_HISTORY_TURNS,
  MAX_OUTPUT_TOKENS,
  NPC_MODEL,
  SYSTEM_PROMPT,
  sceneStatePreamble,
} from './personality.js';
import {
  CHARACTER_TOOLS,
  type ParsedToolCall,
  ToolCallParseError,
  parseToolCall,
} from './tools.js';

export const MOTOR_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  text: string;
}

export interface SceneState {
  position: { x: number; z: number };
  lastClickTarget: { x: number; z: number } | null;
}

export interface MotorClient {
  apiKey: string;
  model: string;
}

export function createMotorClient(opts: { apiKey: string; model?: string }): MotorClient {
  return {
    apiKey: opts.apiKey,
    model: opts.model && opts.model.length > 0 ? opts.model : NPC_MODEL,
  };
}

export interface MotorStreamHandlers {
  onFirstToken?: (latencyMs: number) => void;
  onTextDelta?: (delta: string) => void;
  onToolCall?: (call: ParsedToolCall) => void;
  onToolCallParseError?: (err: ToolCallParseError) => void;
  onFinal: (final: { text: string; toolCalls: ReadonlyArray<ParsedToolCall> }) => void;
  onError: (err: Error) => void;
}

export interface StreamMotorOptions {
  client: MotorClient;
  history: readonly ChatTurn[];
  userMessage: string;
  scene: SceneState;
  /** When provided, parsed tool calls also dispatch immediately to the character. */
  intent?: CharacterIntentSurface;
  signal?: AbortSignal;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  handlers: MotorStreamHandlers;
}

interface ToolCallAccumulator {
  index: number;
  id: string;
  name: string;
  argsBuffer: string;
}

interface DeltaChunk {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number };
}

function trimHistory(history: readonly ChatTurn[]): ChatTurn[] {
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  while (trimmed.length > 0 && trimmed[0]?.role !== 'user') {
    trimmed.shift();
  }
  return trimmed;
}

/**
 * Parse one SSE frame's payload and pump deltas into the accumulator state.
 * Returns true when the frame indicated end-of-stream.
 */
function processFrame(
  frame: string,
  state: {
    assembled: string;
    pending: Map<number, ToolCallAccumulator>;
    completed: ParsedToolCall[];
    finished: boolean;
    firstTokenSeen: boolean;
    startedAt: number;
  },
  handlers: MotorStreamHandlers,
  intent: CharacterIntentSurface | undefined,
): boolean {
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') {
      if (payload === '[DONE]') state.finished = true;
      continue;
    }
    let parsed: DeltaChunk;
    try {
      parsed = JSON.parse(payload) as DeltaChunk;
    } catch {
      continue;
    }
    if (parsed.error) {
      throw new Error(parsed.error.message ?? `OpenRouter error ${parsed.error.code ?? ''}`);
    }
    const choice = parsed.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;

    const text = typeof delta?.content === 'string' ? delta.content : '';
    if (text.length > 0) {
      if (!state.firstTokenSeen) {
        state.firstTokenSeen = true;
        handlers.onFirstToken?.(performance.now() - state.startedAt);
      }
      state.assembled += text;
      handlers.onTextDelta?.(text);
    }

    const toolCalls = delta?.tool_calls ?? [];
    for (const tc of toolCalls) {
      // Index is always present in OpenAI's protocol; default to 0 for
      // single-tool replies in case a provider drops it.
      const idx = typeof tc.index === 'number' ? tc.index : 0;
      let acc = state.pending.get(idx);
      if (!acc) {
        acc = {
          index: idx,
          id: tc.id ?? `tc-${idx}`,
          name: tc.function?.name ?? '',
          argsBuffer: '',
        };
        state.pending.set(idx, acc);
      } else {
        if (tc.id && !acc.id) acc.id = tc.id;
      }
      if (tc.function?.name && !acc.name) {
        acc.name = tc.function.name;
      }
      if (typeof tc.function?.arguments === 'string') {
        acc.argsBuffer += tc.function.arguments;
      }
    }

    if (choice.finish_reason) {
      // The provider closed the assistant turn — flush pending tool calls.
      flushPending(state, handlers, intent);
      state.finished = true;
    }
  }
  return state.finished;
}

function tryDispatch(
  call: ParsedToolCall,
  intent: CharacterIntentSurface | undefined,
  handlers: MotorStreamHandlers,
): void {
  handlers.onToolCall?.(call);
  if (!intent) return;
  switch (call.name) {
    case 'move_to':
      intent.move_to(call.point.x, call.point.y, call.point.z);
      return;
    case 'look_at':
      if (call.target.kind === 'camera') intent.look_at('camera');
      else if (call.target.kind === 'self') intent.look_at({ x: 0, y: 0, z: 0 });
      else intent.look_at(call.target.point);
      return;
    case 'point_at':
      if (call.target.kind === 'camera') {
        // No camera-pointing on the intent surface; point at origin instead.
        intent.point_at({ x: 0, y: 0, z: 0 });
      } else if (call.target.kind === 'self') {
        intent.point_at({ x: 0, y: 0, z: 0 });
      } else {
        intent.point_at(call.target.point);
      }
      return;
    case 'play_animation':
      intent.play_animation(call.clip, call.mode);
      return;
    case 'speak':
      intent.speak(call.text);
      return;
  }
}

function flushPending(
  state: {
    pending: Map<number, ToolCallAccumulator>;
    completed: ParsedToolCall[];
  },
  handlers: MotorStreamHandlers,
  intent: CharacterIntentSurface | undefined,
): void {
  // Sort by index so multi-tool replies dispatch in the order the model
  // emitted them — important when one tool sets up state for the next.
  const ordered = Array.from(state.pending.values()).sort((a, b) => a.index - b.index);
  for (const acc of ordered) {
    if (!acc.name) continue;
    let raw: unknown;
    try {
      raw = acc.argsBuffer.length > 0 ? JSON.parse(acc.argsBuffer) : {};
    } catch {
      handlers.onToolCallParseError?.(
        new ToolCallParseError(acc.name, `arguments JSON invalid: ${acc.argsBuffer.slice(0, 200)}`),
      );
      continue;
    }
    try {
      const parsed = parseToolCall(acc.name, raw);
      state.completed.push(parsed);
      tryDispatch(parsed, intent, handlers);
    } catch (err) {
      if (err instanceof ToolCallParseError) {
        handlers.onToolCallParseError?.(err);
      } else {
        handlers.onToolCallParseError?.(new ToolCallParseError(acc.name, String(err)));
      }
    }
  }
  state.pending.clear();
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  handlers: MotorStreamHandlers,
  intent: CharacterIntentSurface | undefined,
  startedAt: number,
): Promise<{ text: string; toolCalls: ParsedToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const state = {
    assembled: '',
    pending: new Map<number, ToolCallAccumulator>(),
    completed: [] as ParsedToolCall[],
    finished: false,
    firstTokenSeen: false,
    startedAt,
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const nl = buffer.indexOf('\n\n');
      if (nl === -1) break;
      const frame = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      processFrame(frame, state, handlers, intent);
    }
  }
  // Flush trailing buffer (no \n\n at EOF) and any tool calls the provider
  // didn't terminate with finish_reason.
  if (buffer.trim().length > 0) {
    processFrame(buffer, state, handlers, intent);
  }
  if (state.pending.size > 0) {
    flushPending(state, handlers, intent);
  }
  return { text: state.assembled, toolCalls: state.completed };
}

export async function streamMotorReply(args: StreamMotorOptions): Promise<void> {
  const { client, history, userMessage, scene, intent, signal, handlers } = args;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const trimmed = trimHistory(history);
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...trimmed.map((turn) => ({ role: turn.role, content: turn.text })),
    {
      role: 'user' as const,
      content: `${sceneStatePreamble(scene)}\n\n${userMessage}`,
    },
  ];

  const startedAt = performance.now();

  try {
    const response = await fetchImpl(MOTOR_OPENROUTER_URL, {
      method: 'POST',
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          typeof window === 'undefined' ? 'https://dwea.local' : window.location.origin,
        'X-Title': 'DWEA',
      },
      body: JSON.stringify({
        model: client.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        // Suppress chain-of-thought from gpt-oss/etc. so first-token latency
        // tracks visible content.
        reasoning: { exclude: true, effort: 'low' },
        provider: { sort: 'throughput' },
        tools: CHARACTER_TOOLS,
        tool_choice: 'auto',
        messages,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter ${response.status}: ${errText.slice(0, 200) || response.statusText}`,
      );
    }

    const final = await consumeStream(response.body, handlers, intent, startedAt);
    handlers.onFinal(final);
  } catch (err) {
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Convenience: render a parsed call as a one-line transcript hint for chat
 * UI / dev logs. Mirrors the format used in DWEA-18 so existing scripts /
 * tests can stay readable.
 */
export function renderToolCallSummary(call: ParsedToolCall): string {
  switch (call.name) {
    case 'move_to':
      return `move_to(${call.point.x.toFixed(1)}, ${call.point.y.toFixed(1)}, ${call.point.z.toFixed(1)})`;
    case 'look_at':
      return call.target.kind === 'camera'
        ? 'look_at(camera)'
        : call.target.kind === 'self'
          ? 'look_at(self)'
          : `look_at(${call.target.point.x.toFixed(1)}, ${call.target.point.y.toFixed(1)}, ${call.target.point.z.toFixed(1)})`;
    case 'play_animation':
      return `play_animation(${call.clip}, ${call.mode})`;
    case 'point_at':
      return call.target.kind === 'camera'
        ? 'point_at(camera)'
        : call.target.kind === 'self'
          ? 'point_at(self)'
          : `point_at(${call.target.point.x.toFixed(1)}, ${call.target.point.y.toFixed(1)}, ${call.target.point.z.toFixed(1)})`;
    case 'speak':
      return `speak(${call.text.length > 30 ? `${call.text.slice(0, 30)}…` : call.text})`;
  }
}
