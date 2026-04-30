/**
 * Push-to-talk mic capture state machine on top of the Web Speech API.
 *
 * The browser SpeechRecognition surface is event-driven and a little fiddly
 * — `stop()` doesn't immediately deliver a transcript, late `onend` events
 * can fire after we've already moved on, and error codes vary by vendor. We
 * isolate that here so the hook (and its tests) can lean on a pure object
 * with a typed listener API and a single `snapshot()` projection.
 *
 * `lib.dom` only ships `SpeechRecognition` types in some TS releases, so we
 * declare the minimal subset we touch ourselves and accept any compatible
 * factory. The real-window factory lives in `useMicCapture`.
 */

export type MicState = 'idle' | 'listening' | 'processing' | 'error';

export type MicErrorKind =
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface MicSnapshot {
  readonly state: MicState;
  /** Best-so-far transcript (final + most recent interim). Cleared on next start(). */
  readonly transcript: string;
  readonly errorKind: MicErrorKind | null;
  readonly errorMessage: string | null;
}

export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  readonly results: SpeechRecognitionResultListLike;
  readonly resultIndex: number;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
}

export type SpeechRecognitionFactory = () => SpeechRecognitionLike;

export interface MicControllerOptions {
  /** Build a fresh SpeechRecognition instance. Called once per controller. */
  factory: SpeechRecognitionFactory | null;
  lang?: string;
  /** Fired exactly once per finished utterance, with the final transcript. */
  onTranscript?: (final: string) => void;
  /** Fired on every state/transcript change. */
  onChange?: (snap: MicSnapshot) => void;
}

export interface MicController {
  start(): void;
  stop(): void;
  abort(): void;
  snapshot(): MicSnapshot;
  destroy(): void;
}

const UNSUPPORTED_SNAPSHOT: MicSnapshot = {
  state: 'error',
  transcript: '',
  errorKind: 'unsupported',
  errorMessage: 'Speech recognition is not available in this browser.',
};

function classifyError(code: string): { kind: MicErrorKind; message: string } {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        kind: 'permission-denied',
        message: 'Microphone permission was denied. Allow mic access in your browser settings.',
      };
    case 'no-speech':
      return {
        kind: 'no-speech',
        message: "I didn't catch anything — try holding the button and speaking again.",
      };
    case 'audio-capture':
      return {
        kind: 'audio-capture',
        message: 'No microphone was found. Plug one in or switch input devices.',
      };
    case 'network':
      return { kind: 'network', message: 'Speech service is unreachable. Check your connection.' };
    case 'aborted':
      return { kind: 'aborted', message: 'Recording was cancelled.' };
    default:
      return { kind: 'unknown', message: `Speech recognition error: ${code}` };
  }
}

/**
 * Build a controller. If `factory` is null (no browser support), the
 * controller is permanently in the unsupported error state and start/stop
 * are no-ops.
 */
export function createMicController(opts: MicControllerOptions): MicController {
  const { factory, lang = 'en-US', onTranscript, onChange } = opts;

  if (!factory) {
    const snap = UNSUPPORTED_SNAPSHOT;
    onChange?.(snap);
    return {
      start: () => {},
      stop: () => {},
      abort: () => {},
      snapshot: () => snap,
      destroy: () => {},
    };
  }
  // Narrow once so the closures below can call without a re-null-check.
  const buildRecognition: SpeechRecognitionFactory = factory;

  let recognition: SpeechRecognitionLike | null = null;
  let state: MicState = 'idle';
  let transcript = '';
  let finalText = '';
  let errorKind: MicErrorKind | null = null;
  let errorMessage: string | null = null;
  /** Set true while we are actively running an utterance owned by this controller. */
  let alive = false;
  /** Set true when stop() has been called and we are awaiting onend. */
  let stopping = false;
  let destroyed = false;

  function emit(): void {
    onChange?.({ state, transcript, errorKind, errorMessage });
  }

  function setState(next: MicState): void {
    if (state === next) return;
    state = next;
    emit();
  }

  function reset(): void {
    transcript = '';
    finalText = '';
    errorKind = null;
    errorMessage = null;
  }

  function teardown(): void {
    if (recognition) {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition = null;
    }
    alive = false;
    stopping = false;
  }

  function handleResult(event: SpeechRecognitionEventLike): void {
    if (!alive) return;
    // Rebuild from the full results list each emit. The browser is allowed
    // to re-emit a previous index when an interim flips to final, so the
    // safe move is to ignore `resultIndex` and trust the running list.
    const finals: string[] = [];
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result || result.length === 0) continue;
      const alt = result[0];
      if (!alt) continue;
      if (result.isFinal) {
        finals.push(alt.transcript);
      } else {
        interim += alt.transcript;
      }
    }
    finalText = finals.join(' ').replace(/\s+/g, ' ').trim();
    transcript = `${finalText} ${interim}`.replace(/\s+/g, ' ').trim();
    emit();
  }

  function handleError(event: SpeechRecognitionErrorEventLike): void {
    const { kind, message } = classifyError(event.error);
    errorKind = kind;
    errorMessage = event.message ?? message;
    // `aborted` after a clean stop() is normal — the upstream lib reports it
    // when we tear down before recognition finishes a turn. Don't surface it
    // as a user-visible error in that case.
    if (kind === 'aborted' && stopping) {
      errorKind = null;
      errorMessage = null;
      return;
    }
    setState('error');
  }

  function handleEnd(): void {
    if (!alive) return;
    const wasStopping = stopping;
    const settled = finalText.trim();
    teardown();

    if (state === 'error') {
      // error already published; leave it.
      return;
    }
    if (settled.length > 0) {
      onTranscript?.(settled);
    }
    setState('idle');
    void wasStopping;
  }

  function start(): void {
    if (destroyed) return;
    if (state === 'listening' || state === 'processing') return;
    reset();
    try {
      const r = buildRecognition();
      r.continuous = false;
      r.interimResults = true;
      r.lang = lang;
      r.onstart = () => {
        if (!alive) return;
        setState('listening');
      };
      r.onresult = handleResult;
      r.onerror = handleError;
      r.onend = handleEnd;
      recognition = r;
      alive = true;
      stopping = false;
      // Optimistic: surface the listening state immediately so the UI can
      // light up the button without waiting for `onstart`. The real onstart
      // is a no-op if we're already in 'listening'.
      setState('listening');
      r.start();
    } catch (err) {
      teardown();
      errorKind = 'unknown';
      errorMessage = err instanceof Error ? err.message : String(err);
      setState('error');
    }
  }

  function stop(): void {
    if (!alive || !recognition) return;
    if (stopping) return;
    stopping = true;
    setState('processing');
    try {
      recognition.stop();
    } catch {
      // Some browsers throw if stop() is called before recognition has
      // actually started. Force-cleanup and emit whatever we have.
      handleEnd();
    }
  }

  function abort(): void {
    if (!alive || !recognition) return;
    stopping = true;
    try {
      recognition.abort();
    } catch {
      // ignore — onend (or our manual cleanup) will follow
    }
    finalText = '';
    transcript = '';
    teardown();
    setState('idle');
  }

  function snapshot(): MicSnapshot {
    return { state, transcript, errorKind, errorMessage };
  }

  function destroy(): void {
    destroyed = true;
    abort();
  }

  return { start, stop, abort, snapshot, destroy };
}

/**
 * Resolve the browser's SpeechRecognition constructor, if any. Returns a
 * factory that constructs new instances, or null when unsupported.
 */
export function resolveBrowserSpeechRecognition(): SpeechRecognitionFactory | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: vendor-prefixed globals aren't typed.
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof Ctor !== 'function') return null;
  return () => new Ctor() as SpeechRecognitionLike;
}
