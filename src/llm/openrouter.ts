import {
  MAX_HISTORY_TURNS,
  MAX_OUTPUT_TOKENS,
  NPC_MODEL,
  SYSTEM_PROMPT,
  sceneStatePreamble,
} from './personality.js';

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  text: string;
}

export interface SceneState {
  position: { x: number; z: number };
  lastClickTarget: { x: number; z: number } | null;
}

export interface StreamHandlers {
  onFirstToken: (latencyMs: number) => void;
  onTextDelta: (delta: string) => void;
  onFinal: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface NpcClient {
  apiKey: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Browser-direct factory. The "client" is just the API key — there is no SDK.
 * When a backend lands, replace the body of `streamNpcReply` with a fetch to
 * `/api/chat` that proxies the same SSE shape, and drop the localStorage key.
 * See ADR 0005's "Provider swap" section.
 */
export function createNpcClient(apiKey: string): NpcClient {
  return { apiKey };
}

/**
 * Trim history to the last MAX_HISTORY_TURNS turns. We anchor on user turns
 * so the model never sees a dangling assistant turn at the start.
 */
function trimHistory(history: readonly ChatTurn[]): ChatTurn[] {
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  while (trimmed.length > 0 && trimmed[0]?.role !== 'user') {
    trimmed.shift();
  }
  return trimmed;
}

interface DeltaChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number };
}

/**
 * Read an SSE stream from OpenRouter and call handlers as content deltas
 * arrive. We deliberately ignore `delta.reasoning` chunks — gpt-oss models
 * stream their chain-of-thought first; only the post-reasoning `content`
 * deltas are user-visible.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  startedAt: number,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let assembled = '';
  let firstTokenSeen = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines. A frame is one or more lines,
    // each starting with a field name (`data: …`, `event: …`, etc.).
    while (true) {
      const nl = buffer.indexOf('\n\n');
      if (nl === -1) break;
      const frame = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;

        let parsed: DeltaChunk;
        try {
          parsed = JSON.parse(payload) as DeltaChunk;
        } catch {
          continue;
        }
        if (parsed.error) {
          throw new Error(parsed.error.message ?? `OpenRouter error ${parsed.error.code ?? ''}`);
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            handlers.onFirstToken(performance.now() - startedAt);
          }
          assembled += delta;
          handlers.onTextDelta(delta);
        }
      }
    }
  }
  return assembled;
}

export async function streamNpcReply(args: {
  client: NpcClient;
  history: readonly ChatTurn[];
  userMessage: string;
  scene: SceneState;
  signal?: AbortSignal;
  handlers: StreamHandlers;
}): Promise<void> {
  const { client, history, userMessage, scene, signal, handlers } = args;

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
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter uses these for analytics + free-tier attribution; both
        // are optional but recommended in their docs.
        'HTTP-Referer':
          typeof window === 'undefined' ? 'https://dwea.local' : window.location.origin,
        'X-Title': 'DWEA',
      },
      body: JSON.stringify({
        model: NPC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        // Suppresses gpt-oss's chain-of-thought stream so first-token
        // latency tracks visible content, not thinking tokens.
        reasoning: { exclude: true, effort: 'low' },
        // Free models share rate-limited backends; ask for the fastest one.
        provider: { sort: 'throughput' },
        messages,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter ${response.status}: ${errText.slice(0, 200) || response.statusText}`,
      );
    }

    const final = await consumeStream(response.body, handlers, startedAt);
    handlers.onFinal(final);
  } catch (err) {
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
