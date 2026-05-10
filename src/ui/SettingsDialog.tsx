import { useEffect, useState } from 'react';
import type { TelemetryStore } from '../telemetry/index.js';
import { recordsToCsv } from '../telemetry/index.js';

export interface SettingsDialogProps {
  open: boolean;
  initialKey: string;
  onClose: () => void;
  onSave: (key: string) => void;
  /**
   * Optional — when present, the dialog renders a "Download telemetry CSV"
   * button that exports the local TTFA / TTF-Face buffer (DWEA-100). Tests
   * can omit it; production wiring in [App.tsx](../App.tsx) always passes.
   */
  telemetryStore?: TelemetryStore;
}

// Mask all but the leading prefix and trailing 4 chars so the user can confirm
// "yes, that's my key" without the dialog leaking the secret to a shoulder.
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function SettingsDialog({
  open,
  initialKey,
  onClose,
  onSave,
  telemetryStore,
}: SettingsDialogProps) {
  const [key, setKey] = useState(initialKey);
  const [reveal, setReveal] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey(initialKey);
      setReveal(false);
      setExportStatus(null);
    }
  }, [open, initialKey]);

  if (!open) return null;

  const hasSavedKey = initialKey.length > 0;
  const matchesSaved = key === initialKey;

  return (
    <div style={backdropStyle}>
      <dialog open style={dialogStyle} aria-labelledby="settings-title">
        <h2 id="settings-title" style={{ margin: '0 0 8px 0', fontSize: 16 }}>
          OpenRouter API key
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, lineHeight: 1.4, opacity: 0.8 }}>
          Mara talks to you through{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#9be7ff' }}
          >
            OpenRouter
          </a>{' '}
          using a free model. Paste your own key — it stays in this browser (
          <code>localStorage</code>) and is sent only to <code>openrouter.ai</code>. We will remove
          this field once we have a server-side proxy (see ADR&nbsp;0005).
        </p>
        {hasSavedKey ? (
          <div style={savedBannerStyle} aria-live="polite">
            <span>
              Last saved: <code style={savedKeyStyle}>{maskKey(initialKey)}</code>
            </span>
            <span style={{ opacity: 0.75 }}>
              {matchesSaved ? 'using saved key — just press Save.' : 'edited; Save to overwrite.'}
            </span>
          </div>
        ) : null}
        <div style={inputRowStyle}>
          <input
            type={reveal ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            style={revealBtnStyle}
            aria-pressed={reveal}
            aria-label={reveal ? 'Hide API key' : 'Show API key'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        {telemetryStore ? (
          <div style={telemetrySectionStyle}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: 13 }}>Latency telemetry</h3>
            <p style={{ margin: '0 0 8px 0', fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
              Per-session TTFA / TTF-Face latencies are stored locally for{' '}
              <a
                href="https://github.com/Dru1d3/dwea/issues"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#9be7ff' }}
              >
                σ_log dogfood measurement
              </a>
              . Download the CSV and hand it to whoever owns DWEA-98 / DWEA-97.
            </p>
            <div style={rowStyle}>
              <button
                type="button"
                onClick={() => {
                  void downloadTelemetryCsv(telemetryStore, setExportStatus);
                }}
                style={ghostBtnStyle}
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Clear the telemetry buffer? σ_log measurements will be lost.')) {
                    return;
                  }
                  void telemetryStore.clear().then(() => {
                    setExportStatus('Buffer cleared.');
                  });
                }}
                style={ghostBtnStyle}
              >
                Clear
              </button>
            </div>
            {exportStatus ? (
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>{exportStatus}</div>
            ) : null}
          </div>
        ) : null}
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

async function downloadTelemetryCsv(
  store: TelemetryStore,
  setStatus: (s: string | null) => void,
): Promise<void> {
  try {
    const records = await store.list();
    if (records.length === 0) {
      setStatus('No telemetry recorded yet — talk to Mara at least once first.');
      return;
    }
    const csv = recordsToCsv(records);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dwea-telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${records.length} session${records.length === 1 ? '' : 's'}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Export failed: ${msg}`);
  }
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

const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'stretch',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  borderRadius: 8,
  color: '#e6f6ff',
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
};

const revealBtnStyle: React.CSSProperties = {
  background: 'rgba(155, 231, 255, 0.08)',
  color: '#bff3ff',
  border: '1px solid rgba(155, 231, 255, 0.25)',
  borderRadius: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 12,
};

const savedBannerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  margin: '0 0 8px 0',
  padding: '6px 8px',
  borderRadius: 8,
  background: 'rgba(93, 212, 255, 0.08)',
  border: '1px solid rgba(155, 231, 255, 0.2)',
  color: '#bff3ff',
  fontSize: 12,
};

const savedKeyStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  letterSpacing: 0.4,
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

const telemetrySectionStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 8,
  border: '1px solid rgba(155, 231, 255, 0.18)',
  background: 'rgba(0,0,0,0.2)',
};
