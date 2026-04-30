import { useEffect, useRef } from 'react';
import type { MicCaptureApi } from './useMicCapture.js';

export interface MicButtonProps {
  mic: MicCaptureApi;
  /** Disable the button (e.g. while the chat is busy or the API key is missing). */
  disabled?: boolean;
  /** Optional label override, e.g. for a-11y or layout tweaks. */
  label?: string;
}

/**
 * Push-to-talk button. Press to start, release to stop. Touch and mouse
 * are both wired up; we attach a window-level `pointerup` so a release
 * outside the button still ends the recording instead of getting stuck.
 */
export function MicButton(props: MicButtonProps) {
  const { mic, disabled = false, label } = props;
  const heldRef = useRef(false);

  useEffect(() => {
    function release(): void {
      if (!heldRef.current) return;
      heldRef.current = false;
      if (mic.state === 'listening') mic.stop();
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [mic]);

  const blocked = disabled || !mic.supported;

  const live = mic.state === 'listening';
  const processing = mic.state === 'processing';
  const errored = mic.state === 'error';

  let title = label ?? 'Hold to talk (or hold Space)';
  if (!mic.supported) title = 'Speech recognition is not supported in this browser.';
  else if (mic.errorMessage) title = mic.errorMessage;

  return (
    <button
      type="button"
      aria-label={label ?? 'Push to talk'}
      aria-pressed={live}
      title={title}
      disabled={blocked}
      onPointerDown={(e) => {
        if (blocked) return;
        // Capture the pointer so we always see the matching pointerup, even
        // if the cursor leaves the button before release.
        e.currentTarget.setPointerCapture(e.pointerId);
        heldRef.current = true;
        mic.start();
      }}
      style={{
        ...baseStyle,
        ...(live ? listeningStyle : null),
        ...(processing ? processingStyle : null),
        ...(errored ? errorStyle : null),
        ...(blocked ? disabledStyle : null),
      }}
    >
      {live ? '● rec' : processing ? '…' : errored ? '!' : '🎤'}
    </button>
  );
}

const baseStyle: React.CSSProperties = {
  appearance: 'none',
  width: 38,
  height: 38,
  borderRadius: 8,
  border: '1px solid rgba(155, 231, 255, 0.3)',
  background: 'rgba(0,0,0,0.35)',
  color: '#bff3ff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  touchAction: 'none',
  userSelect: 'none',
};

const listeningStyle: React.CSSProperties = {
  background: 'rgba(255, 90, 110, 0.85)',
  borderColor: 'rgba(255, 90, 110, 0.95)',
  color: '#fff',
  boxShadow: '0 0 0 4px rgba(255, 90, 110, 0.18)',
};

const processingStyle: React.CSSProperties = {
  background: 'rgba(255, 196, 90, 0.18)',
  borderColor: 'rgba(255, 196, 90, 0.45)',
  color: '#ffd58a',
};

const errorStyle: React.CSSProperties = {
  background: 'rgba(255, 90, 110, 0.18)',
  borderColor: 'rgba(255, 90, 110, 0.45)',
  color: '#ffb0bd',
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};
