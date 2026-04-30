import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntentSurface } from '../character/intent.js';
import { type StubLogEntry, createStubIntentSurface } from '../character/intent.stub.js';
import { type MotorTurn, createMotorClient, streamMotor } from '../character/motor.js';
import { ActionQueue, type QueueEvent } from '../character/queue.js';
import type { ToolCall, ToolCallParseError } from '../character/schema.js';
import { loadMotorApiKey, saveMotorApiKey } from '../character/storage.js';
import { MOTOR_SYSTEM_PROMPT } from '../character/systemPrompt.js';

/**
 * Standalone chat UI for the LLM motor (DWEA-18 / T3).
 *
 * Self-contained — does not share state with the OpenRouter ChatPanel. This
 * lets us iterate on tool dispatch without disturbing the existing demo. The
 * panel mounts behind `?motor=1` until T2 lands and we can wire the real
 * intent surface into the main app flow.
 */

interface ChatLine {
  id: string;
  kind: 'user' | 'assistant-text' | 'tool' | 'error' | 'system';
  text: string;
  pending?: boolean;
}

let nextId = 0;
function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId.toString(36)}`;
}

function describeToolCall(call: ToolCall): string {
  switch (call.name) {
    case 'move_to':
      return `move_to(${call.input.x}, ${call.input.y}, ${call.input.z})`;
    case 'look_at':
      return `look_at("${call.input.target_id}")`;
    case 'play_animation':
      return `play_animation("${call.input.clip_id}", "${call.input.mode}")`;
    case 'point_at':
      return `point_at("${call.input.target_id}")`;
    case 'speak':
      return `speak("${call.input.text}")`;
  }
}

export interface MotorChatProps {
  intent?: IntentSurface;
  onOpenSettings: () => void;
  hasApiKey: boolean;
}

export function MotorChat({ intent: providedIntent, onOpenSettings, hasApiKey }: MotorChatProps) {
  const intent = useMemo<IntentSurface>(
    () => providedIntent ?? createStubIntentSurface(),
    [providedIntent],
  );
  const queue = useMemo(() => new ActionQueue({ intent }), [intent]);

  const [lines, setLines] = useState<ChatLine[]>(() => [
    {
      id: uid('sys'),
      kind: 'system',
      text:
        providedIntent === undefined
          ? 'Stub intent surface — actions are simulated until T2 lands. Try "walk to the rock and point at it" or "stop".'
          : 'Connected to live intent surface.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<MotorTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Autoscroll on new lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-on-change is the intent.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Surface queue lifecycle into the chat as tool chips.
  useEffect(() => {
    return queue.on((event: QueueEvent) => {
      if (event.type === 'started') {
        setLines((prev) => [
          ...prev,
          {
            id: uid('tool'),
            kind: 'tool',
            text: `▶ ${describeToolCall(event.action.call)}`,
          },
        ]);
      } else if (event.type === 'aborted') {
        setLines((prev) => [
          ...prev,
          {
            id: uid('tool'),
            kind: 'tool',
            text: `⨯ ${describeToolCall(event.action.call)} (${event.reason})`,
          },
        ]);
      }
    });
  }, [queue]);

  const append = useCallback((line: Omit<ChatLine, 'id'>) => {
    setLines((prev) => [...prev, { ...line, id: uid(line.kind) }]);
  }, []);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !hasApiKey) return;
    setDraft('');
    append({ kind: 'user', text });

    const apiKey = loadMotorApiKey();
    if (!apiKey) {
      append({ kind: 'error', text: 'Anthropic key not set. Open settings to add it.' });
      return;
    }

    const client = createMotorClient({ apiKey });
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    const assistantLineId = uid('assistant');
    setLines((prev) => [
      ...prev,
      { id: assistantLineId, kind: 'assistant-text', text: '', pending: true },
    ]);
    let assistantText = '';

    await streamMotor({
      client,
      systemPrompt: MOTOR_SYSTEM_PROMPT,
      history,
      userMessage: text,
      signal: controller.signal,
      handlers: {
        onText: (delta) => {
          assistantText += delta;
          setLines((prev) =>
            prev.map((l) => (l.id === assistantLineId ? { ...l, text: assistantText } : l)),
          );
        },
        onToolCall: (call) => {
          // Dispatch into the queue as soon as the model finishes the block.
          queue.enqueue(call);
        },
        onToolCallParseError: (err: ToolCallParseError) => {
          append({ kind: 'error', text: `Tool ${err.toolName} parse error: ${err.message}` });
        },
        onError: (err) => {
          append({ kind: 'error', text: err.message });
        },
        onFinal: (turn) => {
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantLineId
                ? {
                    ...l,
                    pending: false,
                    text: assistantText || (turn.text ? '(tool calls only)' : ''),
                  }
                : l,
            ),
          );
          setHistory((prev) => [
            ...prev,
            { role: 'user', text },
            { role: 'assistant', text: turn.text },
          ]);
        },
      },
    });
    setBusy(false);
  }, [draft, busy, hasApiKey, history, queue, append]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    queue.stop();
    append({ kind: 'system', text: '— action queue cleared —' });
  }, [queue, append]);

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <strong>Mara · motor</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={stop} style={iconBtnStyle} aria-label="Stop">
            ⏹
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            style={iconBtnStyle}
            aria-label="Motor settings"
          >
            ⚙
          </button>
        </div>
      </div>

      <div ref={scrollRef} style={transcriptStyle}>
        {lines.map((line) => (
          <div key={line.id} style={rowStyleFor(line.kind)}>
            <div style={bubbleStyleFor(line.kind)}>{line.text || (line.pending ? '…' : '')}</div>
          </div>
        ))}
      </div>

      <form
        style={formStyle}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hasApiKey ? 'Tell Mara what to do…' : 'Add Anthropic key in settings'}
          disabled={!hasApiKey || busy}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={!hasApiKey || busy || draft.trim().length === 0}
          style={sendBtnStyle}
        >
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function rowStyleFor(kind: ChatLine['kind']): React.CSSProperties {
  if (kind === 'user') return { display: 'flex', justifyContent: 'flex-end' };
  return { display: 'flex', justifyContent: 'flex-start' };
}

function bubbleStyleFor(kind: ChatLine['kind']): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 12,
    maxWidth: '85%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 13,
    lineHeight: 1.4,
  };
  switch (kind) {
    case 'user':
      return {
        ...base,
        background: 'rgba(93, 212, 255, 0.18)',
        border: '1px solid rgba(93, 212, 255, 0.35)',
      };
    case 'assistant-text':
      return {
        ...base,
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(155, 231, 255, 0.18)',
      };
    case 'tool':
      return {
        ...base,
        background: 'rgba(255, 211, 105, 0.10)',
        border: '1px solid rgba(255, 211, 105, 0.35)',
        color: '#ffd369',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 12,
      };
    case 'error':
      return {
        ...base,
        background: 'rgba(255, 90, 90, 0.10)',
        border: '1px solid rgba(255, 90, 90, 0.35)',
        color: '#ffb3b3',
      };
    default:
      return { ...base, color: 'rgba(230, 246, 255, 0.6)', fontStyle: 'italic' };
  }
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  width: 'min(420px, calc(100vw - 32px))',
  maxHeight: 'min(640px, calc(100vh - 32px))',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(12, 18, 28, 0.82)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 211, 105, 0.25)',
  borderRadius: 12,
  color: '#e6f6ff',
  fontSize: 14,
  boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
  zIndex: 10,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255, 211, 105, 0.18)',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255, 211, 105, 0.25)',
  color: '#ffd369',
  width: 28,
  height: 28,
  borderRadius: 6,
  cursor: 'pointer',
};

const transcriptStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 200,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 10,
  borderTop: '1px solid rgba(255, 211, 105, 0.18)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255, 211, 105, 0.25)',
  borderRadius: 8,
  color: '#e6f6ff',
  padding: '8px 10px',
  outline: 'none',
};

const sendBtnStyle: React.CSSProperties = {
  background: 'rgba(255, 211, 105, 0.85)',
  color: '#1a1402',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};

// Re-export so consumers can drive a tabular log if they want.
export type { StubLogEntry };
