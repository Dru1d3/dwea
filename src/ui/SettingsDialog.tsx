import { useEffect, useState } from 'react';
import type { SpeechEngineChoice } from './speechEngineStorage.js';

export interface SettingsDialogSpeechSettings {
  /** Current saved engine. `null` means "follow env auto-detect". */
  engine: SpeechEngineChoice | null;
  /** Saved Groq key (or empty string when none). */
  groqApiKey: string;
  /** True when `VITE_GROQ_API_KEY` is present in the env-built bundle. */
  envHasGroqKey: boolean;
}

export interface SettingsDialogProps {
  open: boolean;
  initialKey: string;
  onClose: () => void;
  onSave: (key: string) => void;
  /** Optional: when provided, the dialog also renders speech-engine controls. */
  speech?: SettingsDialogSpeechSettings;
  /** Called with the chosen engine/key when Save is pressed. Required when `speech` is set. */
  onSaveSpeech?: (next: { engine: SpeechEngineChoice | null; groqApiKey: string }) => void;
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
  speech,
  onSaveSpeech,
}: SettingsDialogProps) {
  const [key, setKey] = useState(initialKey);
  const [reveal, setReveal] = useState(false);
  const [engine, setEngine] = useState<SpeechEngineChoice>(speech?.engine ?? 'web-speech');
  const [groqKey, setGroqKey] = useState<string>(speech?.groqApiKey ?? '');
  const [revealGroq, setRevealGroq] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(initialKey);
      setReveal(false);
      setEngine(speech?.engine ?? 'web-speech');
      setGroqKey(speech?.groqApiKey ?? '');
      setRevealGroq(false);
    }
  }, [open, initialKey, speech?.engine, speech?.groqApiKey]);

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

        {speech && onSaveSpeech ? (
          <SpeechSection
            engine={engine}
            onEngineChange={setEngine}
            groqKey={groqKey}
            onGroqKeyChange={setGroqKey}
            revealGroq={revealGroq}
            onToggleRevealGroq={() => setRevealGroq((v) => !v)}
            envHasGroqKey={speech.envHasGroqKey}
          />
        ) : null}

        <div style={rowStyle}>
          <button type="button" onClick={onClose} style={ghostBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(key.trim());
              if (speech && onSaveSpeech) {
                onSaveSpeech({ engine, groqApiKey: groqKey.trim() });
              }
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

interface SpeechSectionProps {
  engine: SpeechEngineChoice;
  onEngineChange: (next: SpeechEngineChoice) => void;
  groqKey: string;
  onGroqKeyChange: (next: string) => void;
  revealGroq: boolean;
  onToggleRevealGroq: () => void;
  envHasGroqKey: boolean;
}

function SpeechSection({
  engine,
  onEngineChange,
  groqKey,
  onGroqKeyChange,
  revealGroq,
  onToggleRevealGroq,
  envHasGroqKey,
}: SpeechSectionProps) {
  const showGroqField = engine === 'groq';
  return (
    <section style={speechSectionStyle} aria-labelledby="settings-speech-title">
      <h3 id="settings-speech-title" style={{ margin: '0 0 6px 0', fontSize: 13 }}>
        Speech engine
      </h3>
      <p style={{ margin: '0 0 8px 0', fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
        Web Speech is the browser default — fast in Chrome but unsupported in Firefox/Safari and
        weak on accents. Whisper via{' '}
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#9be7ff' }}
        >
          Groq's free tier
        </a>{' '}
        works everywhere a mic does and handles non-English better. Stored locally; never sent to
        OpenRouter. (See DWEA-36.)
      </p>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Engine</legend>
        <label style={radioRowStyle}>
          <input
            type="radio"
            name="dwea-speech-engine"
            value="web-speech"
            checked={engine === 'web-speech'}
            onChange={() => onEngineChange('web-speech')}
          />
          <span>
            <strong>Web Speech</strong>
            <span style={{ opacity: 0.7 }}> — Chrome/Edge only</span>
          </span>
        </label>
        <label style={radioRowStyle}>
          <input
            type="radio"
            name="dwea-speech-engine"
            value="groq"
            checked={engine === 'groq'}
            onChange={() => onEngineChange('groq')}
          />
          <span>
            <strong>Whisper</strong>
            <span style={{ opacity: 0.7 }}> — Groq hosted, requires free API key</span>
          </span>
        </label>
      </fieldset>
      {showGroqField ? (
        <div style={{ marginTop: 10 }}>
          <label htmlFor="settings-groq-key" style={subLabelStyle}>
            Groq API key
            {envHasGroqKey && groqKey.length === 0 ? (
              <span style={{ opacity: 0.65, marginLeft: 6 }}>
                (env key in use — leave blank to keep it)
              </span>
            ) : null}
          </label>
          <div style={inputRowStyle}>
            <input
              id="settings-groq-key"
              type={revealGroq ? 'text' : 'password'}
              value={groqKey}
              onChange={(e) => onGroqKeyChange(e.target.value)}
              placeholder="gsk_…"
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={onToggleRevealGroq}
              style={revealBtnStyle}
              aria-pressed={revealGroq}
              aria-label={revealGroq ? 'Hide Groq key' : 'Show Groq key'}
            >
              {revealGroq ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
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

const speechSectionStyle: React.CSSProperties = {
  marginTop: 14,
  padding: 10,
  borderRadius: 8,
  border: '1px solid rgba(155, 231, 255, 0.18)',
  background: 'rgba(0,0,0,0.2)',
};

const fieldsetStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  border: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const legendStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 4,
  padding: 0,
};

const radioRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 13,
  cursor: 'pointer',
};

const subLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  opacity: 0.8,
  marginBottom: 4,
};
