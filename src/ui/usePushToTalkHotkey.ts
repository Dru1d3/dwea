import { useEffect, useRef } from 'react';

const FORM_TAG_RE = /^(input|textarea|select)$/i;

/**
 * Returns true when the active key event would normally type into a form
 * field — Space inside an input must keep its native behavior.
 */
function isTypingInForm(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return FORM_TAG_RE.test(target.tagName);
}

export interface PushToTalkHotkeyOptions {
  /** When false, the hotkey is fully disabled (no keydown/keyup listening). */
  enabled: boolean;
  onPress: () => void;
  onRelease: () => void;
  /** Default: `Space`. Match `KeyboardEvent.code`, not `key`. */
  code?: string;
}

/**
 * Global push-to-talk hotkey: hold the configured key (default Space) to
 * record, release to submit. Auto-repeat keydowns are ignored, and we never
 * fire while the user is typing in the chat input.
 */
export function usePushToTalkHotkey(opts: PushToTalkHotkeyOptions): void {
  const { enabled, onPress, onRelease, code = 'Space' } = opts;
  const heldRef = useRef(false);
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (!enabled) return;

    function down(e: KeyboardEvent): void {
      if (e.code !== code) return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingInForm(e)) return;
      e.preventDefault();
      if (heldRef.current) return;
      heldRef.current = true;
      onPressRef.current();
    }
    function up(e: KeyboardEvent): void {
      if (e.code !== code) return;
      if (!heldRef.current) return;
      heldRef.current = false;
      e.preventDefault();
      onReleaseRef.current();
    }
    function blur(): void {
      if (!heldRef.current) return;
      heldRef.current = false;
      onReleaseRef.current();
    }

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, code]);
}
