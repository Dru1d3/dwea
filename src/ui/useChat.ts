import { useCallback, useRef, useState } from 'react';
import {
  type ChatTurn,
  type NpcClient,
  type SceneState,
  createNpcClient,
  streamNpcReply,
} from '../llm/openrouter.js';
import { pickGreeting } from '../llm/personality.js';
import { rotateGreetingSeed } from '../llm/storage.js';
import type { ChatMessage } from './ChatPanel.js';

const LATENCY_AVERAGE_WINDOW = 5;

function uid(): string {
  return Math.random().toString(36).slice(2) + performance.now().toString(36);
}

/**
 * Single owner of chat state, the Anthropic client lifecycle, and latency
 * stats. App.tsx wires `apiKey`, `getScene`, and renders the messages.
 */
export function useChat(args: {
  apiKey: string;
  getScene: () => SceneState;
}) {
  const { apiKey, getScene } = args;

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

  const clientRef = useRef<NpcClient | null>(null);
  const lastKeyRef = useRef<string>('');
  if (apiKey && apiKey !== lastKeyRef.current) {
    clientRef.current = createNpcClient(apiKey);
    lastKeyRef.current = apiKey;
  }
  if (!apiKey && lastKeyRef.current) {
    clientRef.current = null;
    lastKeyRef.current = '';
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

      // Build the history for the model from the messages we had BEFORE this
      // turn. We deliberately exclude the just-added placeholder so the model
      // doesn't see its own empty turn.
      const priorTurns: ChatTurn[] = messages
        .filter(
          (m): m is ChatMessage & { role: 'user' | 'assistant' } => !m.pending && m.text.length > 0,
        )
        .map((m) => ({ role: m.role, text: m.text }));

      let streamed = '';

      await streamNpcReply({
        client,
        history: priorTurns,
        userMessage: text,
        scene: getScene(),
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
          onFinal: (full) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: full, pending: false } : m)),
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
    [busy, messages, getScene],
  );

  // Computed each render from the rolling buffer. Cheap (window of 5).
  const buf = recentLatenciesRef.current;
  const averageFirstTokenMs = buf.length === 0 ? null : buf.reduce((a, b) => a + b, 0) / buf.length;
  // Reference lastFirstTokenMs so the average appears reactive — it updates
  // alongside the latency state we just set.
  void lastFirstTokenMs;

  return {
    messages,
    busy,
    send,
    lastFirstTokenMs,
    averageFirstTokenMs,
  };
}
