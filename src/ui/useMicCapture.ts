import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type MicController,
  type MicSnapshot,
  type SpeechRecognitionFactory,
  createMicController,
  resolveBrowserSpeechRecognition,
} from './micCapture.js';

const INITIAL_SUPPORTED_SNAPSHOT: MicSnapshot = {
  state: 'idle',
  transcript: '',
  errorKind: null,
  errorMessage: null,
};

const INITIAL_UNSUPPORTED_SNAPSHOT: MicSnapshot = {
  state: 'error',
  transcript: '',
  errorKind: 'unsupported',
  errorMessage: 'Speech recognition is not available in this browser.',
};

export interface UseMicCaptureOptions {
  /** Called once per utterance with the final transcript. */
  onTranscript: (text: string) => void;
  lang?: string;
  /** Test seam — if omitted, resolves the real browser global. */
  factory?: SpeechRecognitionFactory | null;
}

export interface MicCaptureApi extends MicSnapshot {
  readonly supported: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * React adapter for `createMicController`. The hook owns one controller
 * for the lifetime of the component and re-renders on every state /
 * transcript change.
 */
export function useMicCapture(opts: UseMicCaptureOptions): MicCaptureApi {
  const { onTranscript, lang, factory } = opts;

  const factoryRef = useRef<SpeechRecognitionFactory | null | undefined>(factory);
  factoryRef.current = factory;

  // Keep onTranscript fresh without re-creating the controller on every render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const resolvedFactory =
    factory === undefined ? resolveBrowserSpeechRecognition() : (factory ?? null);
  const supported = resolvedFactory !== null;

  const [snapshot, setSnapshot] = useState<MicSnapshot>(() =>
    supported ? INITIAL_SUPPORTED_SNAPSHOT : INITIAL_UNSUPPORTED_SNAPSHOT,
  );

  const controllerRef = useRef<MicController | null>(null);

  useEffect(() => {
    const c = createMicController({
      factory: resolvedFactory,
      ...(lang !== undefined ? { lang } : {}),
      onTranscript: (text) => onTranscriptRef.current(text),
      onChange: (snap) => setSnapshot(snap),
    });
    controllerRef.current = c;
    return () => {
      c.destroy();
      controllerRef.current = null;
    };
    // We deliberately re-create the controller only when the factory or lang
    // actually change — not on every onTranscript identity change.
  }, [resolvedFactory, lang]);

  const start = useCallback(() => {
    controllerRef.current?.start();
  }, []);
  const stop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  return { ...snapshot, supported, start, stop };
}
