import Anthropic from '@anthropic-ai/sdk';
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

/**
 * Browser-direct factory. See ADR 0004 — when a backend lands, replace the
 * body of this function with a fetch to /api/chat that returns an
 * SSE/MessageStream-shaped readable stream and drop the localStorage key.
 */
export function createNpcClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
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

export async function streamNpcReply(args: {
  client: Anthropic;
  history: readonly ChatTurn[];
  userMessage: string;
  scene: SceneState;
  signal?: AbortSignal;
  handlers: StreamHandlers;
}): Promise<void> {
  const { client, history, userMessage, scene, signal, handlers } = args;

  const trimmed = trimHistory(history);
  const messages = [
    ...trimmed.map((turn) => ({ role: turn.role, content: turn.text })),
    {
      role: 'user' as const,
      content: `${sceneStatePreamble(scene)}\n\n${userMessage}`,
    },
  ];

  const startedAt = performance.now();
  let firstTokenSeen = false;

  try {
    const requestOptions = signal ? { signal } : undefined;
    const stream = client.messages.stream(
      {
        model: NPC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      },
      requestOptions,
    );

    stream.on('text', (delta) => {
      if (!firstTokenSeen) {
        firstTokenSeen = true;
        handlers.onFirstToken(performance.now() - startedAt);
      }
      handlers.onTextDelta(delta);
    });

    const final = await stream.finalText();
    handlers.onFinal(final);
  } catch (err) {
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
