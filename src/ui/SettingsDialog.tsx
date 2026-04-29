import { useEffect, useState } from 'react';

export interface SettingsDialogProps {
  open: boolean;
  initialKey: string;
  onClose: () => void;
  onSave: (key: string) => void;
}

export function SettingsDialog({ open, initialKey, onClose, onSave }: SettingsDialogProps) {
  const [key, setKey] = useState(initialKey);

  useEffect(() => {
    if (open) setKey(initialKey);
  }, [open, initialKey]);

  if (!open) return null;

  return (
    <div style={backdropStyle}>
      <dialog open style={dialogStyle} aria-labelledby="settings-title">
        <h2 id="settings-title" style={{ margin: '0 0 8px 0', fontSize: 16 }}>
          API key
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, lineHeight: 1.4, opacity: 0.8 }}>
          Mara talks to you via the Anthropic API. Paste your own key — it stays in this browser (
          <code>localStorage</code>) and is sent only to <code>api.anthropic.com</code>. We will
          remove this field once we have a server-side proxy (see ADR&nbsp;0004).
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          style={inputStyle}
        />
        <div style={rowStyle}>
          <button type="button" onClick={onClose} style={ghostBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(key.trim());
              onClose();
            }}
            style={primaryBtnStyle}
          >
            Save
          </button>
        </div>
      </dialog>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
  padding: 16,
};

const dialogStyle: React.CSSProperties = {
  // Override <dialog>'s default browser positioning so flex centering wins.
  position: 'static',
  margin: 0,
  inset: 'auto',
  width: 'min(440px, 100%)',
  background: 'rgba(12, 18, 28, 0.95)',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  borderRadius: 12,
  padding: 16,
  color: '#e6f6ff',
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  borderRadius: 8,
  color: '#e6f6ff',
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 12,
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#bff3ff',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  borderRadius: 8,
  padding: '8px 12px',
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'rgba(93, 212, 255, 0.85)',
  color: '#0c1f2c',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};
