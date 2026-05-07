import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type MicController,
  type MicSnapshot,
  type SpeechRecognitionFactory,
  createMicController,
  resolveBrowserSpeechRecognition,
} from './micCapture.js';
import { type GroqSttOptions, createGroqSttController } from './sttGroq.js';
import type { SttProviderKind } from './sttProvider.js';

const INITIAL_IDLE_SNAPSHOT: MicSnapshot = {
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

export type UseMicCaptureProvider =
  | {
      readonly kind: 'web-speech';
      readonly lang?: string;
      /** Test seam — if omitted, resolves the real browser global. */
      readonly factory?: SpeechRecognitionFactory | null;
    }
  | {
      readonly kind: 'groq';
      readonly apiKey: string;
      readonly language?: string;
      /** Test/dev seams forwarded to `createGroqSttController`. */
      readonly fetchImpl?: GroqSttOptions['fetchImpl'];
      readonly getUserMedia?: GroqSttOptions['getUserMedia'];
      readonly mediaRecorderFactory?: GroqSttOptions['mediaRecorderFactory'];
    };

export interface UseMicCaptureOptions {
  /** Called once per utterance with the final transcript. */
  onTranscript: (text: string) => void;
  /** Provider config — defaults to Web Speech API for backwards-compat. */
  provider?: UseMicCaptureProvider;
  /** Legacy alias for `{ kind: 'web-speech', lang }`. */
  lang?: string;
  /** Legacy alias for `{ kind: 'web-speech', factory }`. */
  factory?: SpeechRecognitionFactory | null;
}

export interface MicCaptureApi extends MicSnapshot {
  readonly supported: boolean;
  readonly providerKind: SttProviderKind;
  start: () => void;
  stop: () => void;
}

function normalizeProvider(opts: UseMicCaptureOptions): UseMicCaptureProvider {
  if (opts.provider) return opts.provider;
  const next: UseMicCaptureProvider = { kind: 'web-speech' };
  // Spread legacy fields so old callers keep working.
  return Object.assign({}, next, {
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
    ...(opts.factory !== undefined ? { factory: opts.factory } : {}),
  });
}

/**
 * React adapter that owns one mic controller per provider config. The hook
 * re-creates the controller when the provider identity changes (kind +
 * stable inputs), and re-renders on every state / transcript change.
 */
export function useMicCapture(opts: UseMicCaptureOptions): MicCaptureApi {
  const provider = normalizeProvider(opts);
  const onTranscriptRef = useRef(opts.onTranscript);
  onTranscriptRef.current = opts.onTranscript;

  // Resolve a stable Web Speech factory once per render so the support flag
  // and controller agree, and tests can inject `factory: null` deterministically.
  const webSpeechFactory =
    provider.kind === 'web-speech'
      ? provider.factory === undefined
        ? resolveBrowserSpeechRecognition()
        : (provider.factory ?? null)
      : null;

  const supported =
    provider.kind === 'web-speech' ? webSpeechFactory !== null : provider.apiKey.trim().length > 0;

  const [snapshot, setSnapshot] = useState<MicSnapshot>(() =>
    supported ? INITIAL_IDLE_SNAPSHOT : INITIAL_UNSUPPORTED_SNAPSHOT,
  );

  const controllerRef = useRef<MicController | null>(null);

  // Identity key — re-build controller only when the meaningful config flips.
  const providerKey = useMemo(() => {
    if (provider.kind === 'web-speech') {
      return `web-speech:${provider.lang ?? ''}:${webSpeechFactory ? '1' : '0'}`;
    }
    return `groq:${provider.apiKey}:${provider.language ?? ''}`;
  }, [provider, webSpeechFactory]);

  // Stash the latest provider config so the effect (which we re-run only on
  // providerKey changes, not on every reference identity) can read it.
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const webSpeechFactoryRef = useRef(webSpeechFactory);
  webSpeechFactoryRef.current = webSpeechFactory;

  // biome-ignore lint/correctness/useExhaustiveDependencies: providerKey already encodes the meaningful provider state; webSpeechFactory and provider are read through refs to avoid effect churn.
  useEffect(() => {
    if (!supported) {
      setSnapshot(INITIAL_UNSUPPORTED_SNAPSHOT);
      return;
    }
    setSnapshot(INITIAL_IDLE_SNAPSHOT);

    const p = providerRef.current;
    let c: MicController;
    if (p.kind === 'web-speech') {
      c = createMicController({
        factory: webSpeechFactoryRef.current,
        ...(p.lang !== undefined ? { lang: p.lang } : {}),
        onTranscript: (text) => onTranscriptRef.current(text),
        onChange: (snap) => setSnapshot(snap),
      });
    } else {
      const groqOpts: GroqSttOptions = {
        apiKey: p.apiKey,
        onTranscript: (text) => onTranscriptRef.current(text),
        onChange: (snap) => setSnapshot(snap),
      };
      if (p.language !== undefined) groqOpts.language = p.language;
      if (p.fetchImpl !== undefined) groqOpts.fetchImpl = p.fetchImpl;
      if (p.getUserMedia !== undefined) groqOpts.getUserMedia = p.getUserMedia;
      if (p.mediaRecorderFactory !== undefined) {
        groqOpts.mediaRecorderFactory = p.mediaRecorderFactory;
      }
      c = createGroqSttController(groqOpts);
    }
    controllerRef.current = c;
    return () => {
      c.destroy();
      controllerRef.current = null;
    };
  }, [providerKey, supported]);

  const start = useCallback(() => {
    controllerRef.current?.start();
  }, []);
  const stop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  return {
    ...snapshot,
    supported,
    providerKind: provider.kind,
    start,
    stop,
  };
}
