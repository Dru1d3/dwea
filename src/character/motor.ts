/**
 * Anthropic Claude motor — streams a user message with the 5-tool schema and
 * dispatches each `tool_use` block as soon as its input JSON closes, before
 * the rest of the message arrives. Required from day one (per the plan):
 * streaming + parallel tool use enabled.
 *
 * Browser-direct via the Anthropic REST API; sets
 * `anthropic-dangerous-direct-browser-access: true`. Mirrors the
 * OpenRouter wiring in src/llm/openrouter.ts but for Anthropic and tool calls.
 */

import { TOOLS, type ToolCall, ToolCallParseError, parseToolCall } from './schema.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MOTOR_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 1024;

export interface MotorClient {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface CreateMotorClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export function createMotorClient(opts: CreateMotorClientOptions): MotorClient {
  return {
    apiKey: opts.apiKey,
    model: opts.model ?? DEFAULT_MOTOR_MODEL,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

export type MotorTurnRole = 'user' | 'assistant';

export interface MotorTurn {
  role: MotorTurnRole;
  /**
   * Compact transcript text used as conversation history. For assistant
   * turns we render text content as-is and tool_use blocks as
   * `<tool name {…json…}>` so subsequent turns retain the tool context
   * without us having to hand back a full structured message.
   */
  text: string;
}

export interface MotorStreamHandlers {
  onFirstEvent?: (latencyMs: number) => void;
  onText?: (delta: string) => void;
  onToolCall: (call: ToolCall) => void;
  onToolCallParseError?: (err: ToolCallParseError) => void;
  onError?: (err: Error) => void;
  onFinal?: (turn: MotorTurn) => void;
}

export interface StreamMotorOptions {
  client: MotorClient;
  systemPrompt: string;
  history: readonly MotorTurn[];
  userMessage: string;
  signal?: AbortSignal;
  handlers: MotorStreamHandlers;
  /** Override the fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
}

interface SseEvent {
  event: string;
  data: string;
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const nl = buffer.indexOf('\n\n');
      if (nl === -1) break;
      const frame = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      let evt = '';
      const dataLines: string[] = [];
      for (const raw of frame.split('\n')) {
        if (raw.startsWith('event:')) evt = raw.slice(6).trim();
        else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
      }
      if (evt) yield { event: evt, data: dataLines.join('\n') };
    }
  }
}

interface BlockState {
  type: 'text' | 'tool_use';
  toolName?: string;
  toolId?: string;
  partialJson: string;
  textParts: string[];
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function streamMotor(opts: StreamMotorOptions): Promise<void> {
  const { client, systemPrompt, history, userMessage, signal, handlers } = opts;
  const fetchFn = opts.fetchImpl ?? fetch;

  const messages = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: userMessage },
  ];

  const startedAt = performance.now();
  let firstEventSeen = false;

  let response: Response;
  try {
    response = await fetchFn(ANTHROPIC_URL, {
      method: 'POST',
      signal: signal ?? null,
      headers: {
        'content-type': 'application/json',
        'x-api-key': client.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for browser-origin requests; we ship as a static SPA so
        // there is no proxy to hide the key behind in v1.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: client.model,
        max_tokens: client.maxTokens,
        stream: true,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok || !response.body) {
    const txt = await response.text().catch(() => '');
    handlers.onError?.(
      new Error(`Anthropic ${response.status}: ${txt.slice(0, 300) || response.statusText}`),
    );
    return;
  }

  const blocks = new Map<number, BlockState>();
  const transcript: string[] = [];

  try {
    for await (const evt of parseSse(response.body)) {
      if (!firstEventSeen) {
        firstEventSeen = true;
        handlers.onFirstEvent?.(performance.now() - startedAt);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (typeof payload !== 'object' || payload === null) continue;
      const p = payload as Record<string, unknown>;

      switch (evt.event) {
        case 'content_block_start': {
          const idx = num(p.index);
          const cb = p.content_block as Record<string, unknown> | undefined;
          if (idx === undefined || !cb) break;
          const t = cb.type;
          if (t === 'text') {
            blocks.set(idx, { type: 'text', partialJson: '', textParts: [] });
          } else if (t === 'tool_use') {
            const block: BlockState = {
              type: 'tool_use',
              partialJson: '',
              textParts: [],
            };
            if (typeof cb.name === 'string') block.toolName = cb.name;
            if (typeof cb.id === 'string') block.toolId = cb.id;
            blocks.set(idx, block);
          }
          break;
        }
        case 'content_block_delta': {
          const idx = num(p.index);
          const delta = p.delta as Record<string, unknown> | undefined;
          if (idx === undefined || !delta) break;
          const block = blocks.get(idx);
          if (!block) break;
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            block.textParts.push(delta.text);
            handlers.onText?.(delta.text);
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            block.partialJson += delta.partial_json;
          }
          break;
        }
        case 'content_block_stop': {
          const idx = num(p.index);
          if (idx === undefined) break;
          const block = blocks.get(idx);
          if (!block) break;
          if (block.type === 'text') {
            const text = block.textParts.join('');
            if (text) transcript.push(text);
          } else if (block.type === 'tool_use' && block.toolName) {
            // Empty input is valid for tools with no required args, but our
            // schema marks every tool's args as required — treat empty as {}.
            let input: unknown;
            try {
              input = block.partialJson ? JSON.parse(block.partialJson) : {};
            } catch (err) {
              const parseErr = new ToolCallParseError(
                block.toolName,
                `invalid JSON: ${(err as Error).message}`,
              );
              handlers.onToolCallParseError?.(parseErr);
              break;
            }
            try {
              const call = parseToolCall(block.toolName, input);
              transcript.push(`<${block.toolName} ${block.partialJson || '{}'}>`);
              handlers.onToolCall(call);
            } catch (err) {
              if (err instanceof ToolCallParseError) {
                handlers.onToolCallParseError?.(err);
              } else {
                handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
              }
            }
          }
          blocks.delete(idx);
          break;
        }
        case 'message_stop':
          break;
        default:
          break;
      }
    }
    handlers.onFinal?.({ role: 'assistant', text: transcript.join('\n') });
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
