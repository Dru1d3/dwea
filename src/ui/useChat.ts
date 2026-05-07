import { useCallback, useRef, useState } from 'react';
import type { CharacterIntentSurface } from '../character/intent.js';
import {
  type ChatTurn,
  type MotorClient,
  type SceneState,
  createMotorClient,
  renderToolCallSummary,
  streamMotorReply,
} from '../llm/motor.js';
import { NPC_MODEL, pickGreeting } from '../llm/personality.js';
import { rotateGreetingSeed } from '../llm/storage.js';
import type { ParsedToolCall } from '../llm/tools.js';
import type { ChatMessage } from './ChatPanel.js';

const LATENCY_AVERAGE_WINDOW = 5;

function uid(): string {
  return Math.random().toString(36).slice(2) + performance.now().toString(36);
}

export interface UseChatOptions {
  apiKey: string;
  getScene: () => SceneState;
  /** Optional override for the OpenRouter model id. */
  model?: string;
  /**
   * Returns the live `CharacterIntentSurface` so emitted tool calls drive
   * the rendered character. Pulled lazily because the surface only exists
   * after `<CharacterIntentBridge>` has mounted inside the Canvas.
   */
  getIntent?: () => CharacterIntentSurface | null;
}

/**
 * Single owner of chat state, OpenRouter motor client, and latency stats.
 * Drives the LLM motor described in `src/llm/motor.ts`: the model can both
 * stream a text reply AND emit tool calls that move Mara mid-stream.
 */
export function useChat(args: UseChatOptions) {
  const { apiKey, getScene, model, getIntent } = args;

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'greeting',
      role: 'assistant',
      text: pickGreeting(rotateGreetingSeed()),
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [lastFirstTokenMs, setLastFirstTokenMs] = useState<number | null>(null);
  const recentLatenciesRef = useRef<number[]>([]);

  const clientRef = useRef<MotorClient | null>(null);
  const lastKeyRef = useRef<string>('');
  const lastModelRef = useRef<string>('');
  const activeModel = model && model.length > 0 ? model : NPC_MODEL;
  if (apiKey && (apiKey !== lastKeyRef.current || activeModel !== lastModelRef.current)) {
    clientRef.current = createMotorClient({ apiKey, model: activeModel });
    lastKeyRef.current = apiKey;
    lastModelRef.current = activeModel;
  }
  if (!apiKey && lastKeyRef.current) {
    clientRef.current = null;
    lastKeyRef.current = '';
    lastModelRef.current = '';
  }

  const send = useCallback(
    async (text: string) => {
      const client = clientRef.current;
      if (!client || busy) return;

      const userMsg: ChatMessage = { id: uid(), role: 'user', text };
      const assistantId = uid();
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, placeholder]);
      setBusy(true);

      const priorTurns: ChatTurn[] = messages
        .filter(
          (m): m is ChatMessage & { role: 'user' | 'assistant' } => !m.pending && m.text.length > 0,
        )
        .map((m) => ({ role: m.role, text: m.text }));

      let streamed = '';
      const collectedToolCalls: ParsedToolCall[] = [];

      const intent = getIntent?.() ?? undefined;

      await streamMotorReply({
        client,
        history: priorTurns,
        userMessage: text,
        scene: getScene(),
        ...(intent ? { intent } : {}),
        handlers: {
          onFirstToken: (latencyMs) => {
            setLastFirstTokenMs(latencyMs);
            const buf = recentLatenciesRef.current;
            buf.push(latencyMs);
            if (buf.length > LATENCY_AVERAGE_WINDOW) buf.shift();
          },
          onTextDelta: (delta) => {
            streamed += delta;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: streamed } : m)),
            );
          },
          onToolCall: (call) => {
            collectedToolCalls.push(call);
            // If the model only emits tool calls and no `speak` text, surface
            // a humanized echo so the chat panel doesn't go silent. `speak`
            // tool already prints its own text, so skip the echo for it.
            if (call.name === 'speak') {
              const next = streamed.length > 0 ? `${streamed} ${call.text}` : call.text;
              streamed = next;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, text: streamed } : m)),
              );
            }
          },
          onToolCallParseError: (err) => {
            // Dev-visible only: log so we can spot models that are emitting
            // malformed tool calls without surfacing it to the founder.
            console.warn('[motor] tool call parse error:', err.message);
          },
          onFinal: (final) => {
            // If the model emitted only tool calls (no content text), keep a
            // small action summary in the chat history so the user sees that
            // something happened.
            const fallback =
              final.text.trim().length === 0 && final.toolCalls.length > 0
                ? final.toolCalls.map(renderToolCallSummary).join('  ·  ')
                : final.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      text: fallback,
                      pending: false,
                    }
                  : m,
              ),
            );
            setBusy(false);
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      text: `(Mara wavers — ${err.message})`,
                      pending: false,
                    }
                  : m,
              ),
            );
            setBusy(false);
          },
        },
      });
    },
    [busy, messages, getScene, getIntent],
  );

  const buf = recentLatenciesRef.current;
  const averageFirstTokenMs = buf.length === 0 ? null : buf.reduce((a, b) => a + b, 0) / buf.length;
  void lastFirstTokenMs;

  return {
    messages,
    busy,
    send,
    lastFirstTokenMs,
    averageFirstTokenMs,
  };
}
