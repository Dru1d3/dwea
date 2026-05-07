/**
 * Push-to-talk Whisper STT via Groq's free /openai/v1/audio/transcriptions
 * endpoint. Mirrors the controller surface of `micCapture.ts` so the React
 * hook can swap providers without changing the component contract.
 *
 * Why Groq, not browser whisper.cpp / transformers.js: zero bundle cost, sub-
 * second latency on short utterances, and strong multilingual transcription
 * (incl. German, the founder's mixed-language case in DWEA-30). Audio is
 * captured via MediaRecorder (webm/opus) and posted as multipart form data.
 *
 * Key handling: the API key is read from `import.meta.env` at app start (see
 * `sttProvider.ts`). For DWEA-30 the brief explicitly accepts a browser-
 * direct `.env` key — a server-side voice gateway is out of scope.
 */

import type { MicController, MicErrorKind, MicSnapshot, MicState } from './micCapture.js';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const DEFAULT_GROQ_MODEL = 'whisper-large-v3-turbo';

/**
 * Minimal MediaRecorder shape we touch — the DOM type ships in lib.dom but
 * we narrow it for testability and to avoid relying on `MediaRecorder` being
 * defined at typecheck time on non-DOM environments.
 */
export interface MediaRecorderLike {
  start(timeslice?: number): void;
  stop(): void;
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type MediaStreamLike = {
  getTracks(): Array<{ stop(): void }>;
};

export interface GroqSttOptions {
  apiKey: string;
  /**
   * BCP-47 language tag (e.g. `de`, `en`). Whisper auto-detects when omitted,
   * which is what the founder usually wants for German-mixed input — but
   * scoping a known language gives a noticeable accuracy bump on short clips.
   */
  language?: string;
  model?: string;
  /**
   * Hint passed to Whisper to bias the transcript (proper nouns, jargon).
   * Useful for Mara/scene-name spelling, capped at 224 tokens by Whisper.
   */
  prompt?: string;
  fetchImpl?: typeof fetch;
  /**
   * Test seam — if omitted we call `navigator.mediaDevices.getUserMedia`.
   * Returns a media stream we hand to MediaRecorder.
   */
  getUserMedia?: () => Promise<MediaStreamLike>;
  /**
   * Test seam — if omitted we call `new MediaRecorder(stream)` and pick the
   * best mime type the platform accepts (audio/webm;codecs=opus first).
   */
  mediaRecorderFactory?: (stream: MediaStreamLike) => MediaRecorderLike;
  onTranscript?: (final: string) => void;
  onChange?: (snap: MicSnapshot) => void;
}

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

function pickSupportedMimeType(): string | undefined {
  // biome-ignore lint/suspicious/noExplicitAny: MediaRecorder is a runtime global.
  const MR = (globalThis as any).MediaRecorder as
    | { isTypeSupported?: (t: string) => boolean }
    | undefined;
  if (!MR?.isTypeSupported) return undefined;
  for (const t of SUPPORTED_MIME_TYPES) {
    if (MR.isTypeSupported(t)) return t;
  }
  return undefined;
}

function defaultMediaRecorderFactory(stream: MediaStreamLike): MediaRecorderLike {
  const mimeType = pickSupportedMimeType();
  // biome-ignore lint/suspicious/noExplicitAny: MediaRecorder is a runtime global.
  const Ctor = (globalThis as any).MediaRecorder;
  if (typeof Ctor !== 'function') {
    throw new Error('MediaRecorder is not available in this browser.');
  }
  const opts = mimeType ? { mimeType } : undefined;
  return new Ctor(stream, opts) as MediaRecorderLike;
}

function defaultGetUserMedia(): Promise<MediaStreamLike> {
  // biome-ignore lint/suspicious/noExplicitAny: navigator types vary.
  const nav = (globalThis as any).navigator;
  if (!nav?.mediaDevices?.getUserMedia) {
    return Promise.reject(
      new DOMException(
        'navigator.mediaDevices.getUserMedia is not available — Whisper STT requires a secure context.',
        'NotSupportedError',
      ),
    );
  }
  return nav.mediaDevices.getUserMedia({ audio: true }) as Promise<MediaStreamLike>;
}

function classifyMediaError(err: unknown): { kind: MicErrorKind; message: string } {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          kind: 'permission-denied',
          message: 'Microphone permission was denied. Allow mic access in your browser settings.',
        };
      case 'NotFoundError':
      case 'OverconstrainedError':
        return {
          kind: 'audio-capture',
          message: 'No microphone was found. Plug one in or switch input devices.',
        };
      default:
        break;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { kind: 'unknown', message: `Microphone error: ${msg}` };
}

/**
 * Returns true when the controller is in a state Groq STT cannot start from
 * — used by start() to dedupe overlapping presses.
 */
function isBusy(state: MicState): boolean {
  return state === 'listening' || state === 'processing';
}

interface GroqTranscriptionResponse {
  text?: string;
  error?: { message?: string; type?: string };
}

/**
 * Build a controller that records audio while pressed, then transcribes via
 * Groq Whisper on release. Stateful, single-utterance — the React hook
 * (`useMicCapture`) keeps one instance for the component lifetime.
 */
export function createGroqSttController(opts: GroqSttOptions): MicController {
  const {
    apiKey,
    language,
    model = DEFAULT_GROQ_MODEL,
    prompt,
    fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    getUserMedia = defaultGetUserMedia,
    mediaRecorderFactory = defaultMediaRecorderFactory,
    onTranscript,
    onChange,
  } = opts;

  if (!fetchImpl) {
    throw new Error('Groq STT requires a fetch implementation.');
  }

  let state: MicState = 'idle';
  let transcript = '';
  let errorKind: MicErrorKind | null = null;
  let errorMessage: string | null = null;

  let recorder: MediaRecorderLike | null = null;
  let stream: MediaStreamLike | null = null;
  let chunks: Blob[] = [];
  let mimeType = '';
  /** Generation counter so a stop() during start() ignores its own resolution. */
  let generation = 0;
  /** Track the in-flight start() promise so destroy() can cancel cleanly. */
  let startPending = false;
  /** True between stop() being called and onstop firing — guards re-entry. */
  let awaitingStop = false;
  /** True when stop() was a no-op cancel (start hadn't resolved yet). */
  let cancelOnReady = false;
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
    errorKind = null;
    errorMessage = null;
  }

  function teardownStream(): void {
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          // ignore
        }
      }
      stream = null;
    }
  }

  function teardownRecorder(): void {
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      recorder = null;
    }
    chunks = [];
    awaitingStop = false;
  }

  function failWith(kind: MicErrorKind, message: string): void {
    errorKind = kind;
    errorMessage = message;
    setState('error');
  }

  async function transcribe(blob: Blob): Promise<string> {
    if (!fetchImpl) throw new Error('fetch is not available'); // narrowing
    if (blob.size === 0) {
      // No audio captured — treat as no-speech, not an API error.
      throw makeNoSpeech();
    }
    const form = new FormData();
    // Whisper requires a filename even for blob uploads. Match the recorded
    // mime so the server doesn't reject the multipart on extension sniffing.
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    form.append('file', blob, `utterance.${ext}`);
    form.append('model', model);
    form.append('response_format', 'json');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);

    const res = await fetchImpl(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = errText.slice(0, 240) || res.statusText;
      try {
        const parsed = JSON.parse(errText) as GroqTranscriptionResponse;
        if (parsed.error?.message) errMsg = parsed.error.message;
      } catch {
        // raw text already captured
      }
      throw new Error(`Groq STT ${res.status}: ${errMsg}`);
    }
    const json = (await res.json()) as GroqTranscriptionResponse;
    return (json.text ?? '').trim();
  }

  async function start(): Promise<void> {
    if (destroyed) return;
    if (isBusy(state) || startPending) return;
    reset();
    setState('listening');
    startPending = true;
    cancelOnReady = false;
    const myGen = ++generation;

    let mediaStream: MediaStreamLike;
    try {
      mediaStream = await getUserMedia();
    } catch (err) {
      startPending = false;
      if (myGen !== generation) return;
      const { kind, message } = classifyMediaError(err);
      failWith(kind, message);
      return;
    }

    if (myGen !== generation || destroyed) {
      // start was superseded or controller torn down while permission was pending.
      try {
        for (const t of mediaStream.getTracks()) t.stop();
      } catch {
        // ignore
      }
      startPending = false;
      return;
    }

    if (cancelOnReady) {
      // stop() was called while awaiting permission; just release the mic.
      cancelOnReady = false;
      startPending = false;
      try {
        for (const t of mediaStream.getTracks()) t.stop();
      } catch {
        // ignore
      }
      setState('idle');
      return;
    }

    stream = mediaStream;
    chunks = [];

    let mr: MediaRecorderLike;
    try {
      mr = mediaRecorderFactory(stream);
    } catch (err) {
      startPending = false;
      teardownStream();
      const message = err instanceof Error ? err.message : String(err);
      failWith('audio-capture', message);
      return;
    }

    mimeType = mr.mimeType || 'audio/webm';
    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    mr.onerror = (ev) => {
      const message =
        ev && typeof ev === 'object' && 'error' in ev && ev.error instanceof Error
          ? ev.error.message
          : 'Recording failed.';
      failWith('audio-capture', message);
      teardownRecorder();
      teardownStream();
    };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      teardownRecorder();
      teardownStream();
      void finalize(blob, myGen);
    };

    recorder = mr;
    startPending = false;
    try {
      mr.start();
    } catch (err) {
      teardownRecorder();
      teardownStream();
      const message = err instanceof Error ? err.message : String(err);
      failWith('audio-capture', message);
    }
  }

  async function finalize(blob: Blob, gen: number): Promise<void> {
    if (gen !== generation || destroyed) return;
    setState('processing');
    try {
      const text = await transcribe(blob);
      if (gen !== generation || destroyed) return;
      if (text.length === 0) {
        failWith(
          'no-speech',
          "I didn't catch anything — try holding the button and speaking again.",
        );
        return;
      }
      transcript = text;
      emit();
      onTranscript?.(text);
      setState('idle');
    } catch (err) {
      if (gen !== generation || destroyed) return;
      if (err instanceof NoSpeechSignal) {
        failWith(
          'no-speech',
          "I didn't catch anything — try holding the button and speaking again.",
        );
        return;
      }
      const message =
        err instanceof Error ? err.message : `Whisper transcription failed: ${String(err)}`;
      const kind: MicErrorKind = /network|fetch|failed to fetch/i.test(message)
        ? 'network'
        : 'unknown';
      failWith(kind, message);
    }
  }

  function stop(): void {
    if (destroyed) return;
    if (state === 'idle' || state === 'error') return;
    if (state === 'processing') return; // upload already in flight
    if (awaitingStop) return;
    if (recorder && recorder.state === 'recording') {
      awaitingStop = true;
      try {
        recorder.stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failWith('unknown', message);
        teardownRecorder();
        teardownStream();
      }
      return;
    }
    // Recorder hasn't actually started yet — flag the cancel so start() bails
    // when permission resolves.
    cancelOnReady = true;
    if (!startPending) {
      // Edge: state==listening but no recorder and no pending start. Treat as
      // a clean cancel.
      teardownStream();
      setState('idle');
    }
  }

  function abort(): void {
    if (destroyed) return;
    generation += 1; // invalidate any in-flight start/finalize
    awaitingStop = false;
    cancelOnReady = false;
    if (recorder) {
      try {
        if (recorder.state === 'recording') recorder.stop();
      } catch {
        // ignore
      }
    }
    teardownRecorder();
    teardownStream();
    reset();
    setState('idle');
  }

  function snapshot(): MicSnapshot {
    return { state, transcript, errorKind, errorMessage };
  }

  function destroy(): void {
    destroyed = true;
    abort();
  }

  return {
    start: () => {
      void start();
    },
    stop,
    abort,
    snapshot,
    destroy,
  };
}

/** Internal sentinel — Groq returned a 200 but with empty text. */
class NoSpeechSignal extends Error {
  constructor() {
    super('no-speech');
    this.name = 'NoSpeechSignal';
  }
}

function makeNoSpeech(): NoSpeechSignal {
  return new NoSpeechSignal();
}
