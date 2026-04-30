import { useEffect, useRef, useState } from 'react';
import { NPC_NAME } from '../llm/personality.js';
import { MicButton } from './MicButton.js';
import type { MicCaptureApi } from './useMicCapture.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True while the assistant message is still streaming in. */
  pending?: boolean;
}

export interface ChatPanelProps {
  messages: readonly ChatMessage[];
  onSend: (text: string) => void;
  onOpenSettings: () => void;
  /** First-token latency of the most recent assistant turn, in ms. */
  lastFirstTokenMs: number | null;
  averageFirstTokenMs: number | null;
  hasApiKey: boolean;
  busy: boolean;
  /** Optional mic capture; if omitted, the mic affordance is hidden. */
  mic?: MicCaptureApi;
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    messages,
    onSend,
    onOpenSettings,
    lastFirstTokenMs,
    averageFirstTokenMs,
    hasApiKey,
    busy,
    mic,
  } = props;
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // We re-run on every messages change; the dep is correct even though
  // the body doesn't read messages directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-on-change is the intent.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setDraft('');
    onSend(trimmed);
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <strong>{NPC_NAME}</strong>
          <span style={subtleStyle}> · click the ground to walk her over</span>
        </div>
        <button type="button" onClick={onOpenSettings} style={iconBtnStyle} aria-label="Settings">
          ⚙
        </button>
      </div>

      <div ref={scrollRef} style={transcriptStyle}>
        {messages.map((m) => (
          <div key={m.id} style={m.role === 'user' ? userRowStyle : npcRowStyle}>
            <div style={m.role === 'user' ? userBubbleStyle : npcBubbleStyle}>
              {m.text || (m.pending ? '…' : '')}
            </div>
          </div>
        ))}
      </div>

      <div style={metaRowStyle}>
        {hasApiKey ? (
          <>
            <span>
              first token: {lastFirstTokenMs == null ? '—' : `${Math.round(lastFirstTokenMs)} ms`}
            </span>
            <span>
              avg: {averageFirstTokenMs == null ? '—' : `${Math.round(averageFirstTokenMs)} ms`}
            </span>
          </>
        ) : (
          <button type="button" onClick={onOpenSettings} style={linkBtnStyle}>
            Add Anthropic API key to chat →
          </button>
        )}
      </div>

      {mic?.errorMessage && mic.errorKind !== 'no-speech' ? (
        <div style={micErrorStyle}>{mic.errorMessage}</div>
      ) : null}

      <form
        style={formStyle}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mic ? <MicButton mic={mic} disabled={!hasApiKey || busy} /> : null}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            hasApiKey
              ? mic?.state === 'listening'
                ? 'Listening…'
                : `Talk to ${NPC_NAME}…`
              : 'Add an API key to talk'
          }
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

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  width: 'min(380px, calc(100vw - 32px))',
  maxHeight: 'min(560px, calc(100vh - 32px))',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(12, 18, 28, 0.78)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(155, 231, 255, 0.18)',
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
  borderBottom: '1px solid rgba(155, 231, 255, 0.12)',
};

const subtleStyle: React.CSSProperties = {
  color: 'rgba(230, 246, 255, 0.55)',
  fontWeight: 400,
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  color: '#bff3ff',
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
  minHeight: 140,
};

const userRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end' };
const npcRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-start' };

const userBubbleStyle: React.CSSProperties = {
  background: 'rgba(93, 212, 255, 0.18)',
  border: '1px solid rgba(93, 212, 255, 0.35)',
  padding: '6px 10px',
  borderRadius: 12,
  maxWidth: '85%',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const npcBubbleStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(155, 231, 255, 0.18)',
  padding: '6px 10px',
  borderRadius: 12,
  maxWidth: '85%',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '4px 12px',
  fontSize: 11,
  color: 'rgba(230, 246, 255, 0.55)',
  borderTop: '1px solid rgba(155, 231, 255, 0.08)',
};

const linkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#9be7ff',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  textDecoration: 'underline',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 10,
  borderTop: '1px solid rgba(155, 231, 255, 0.12)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(155, 231, 255, 0.2)',
  borderRadius: 8,
  color: '#e6f6ff',
  padding: '8px 10px',
  outline: 'none',
};

const sendBtnStyle: React.CSSProperties = {
  background: 'rgba(93, 212, 255, 0.85)',
  color: '#0c1f2c',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const micErrorStyle: React.CSSProperties = {
  margin: '0 12px 6px',
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(255, 90, 110, 0.12)',
  border: '1px solid rgba(255, 90, 110, 0.35)',
  color: '#ffb0bd',
  fontSize: 11,
  lineHeight: 1.35,
};
