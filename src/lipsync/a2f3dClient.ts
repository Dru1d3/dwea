/**
 * Browser-side client for the A2F-3D ARKit-52 stream.
 *
 * NVIDIA A2F-3D NIM speaks gRPC (no browser-native binding). Spike B's runtime
 * shape is: **browser ← WebSocket → relay → gRPC → NIM**. This module is the
 * WebSocket half, plus a `stub` mode that replays a canned ARKit-52 stream so
 * the rest of the pipeline (apply blendshapes + telemetry) is exercisable
 * without a GPU host. The relay server lives under `infra/a2f-3d/` and is
 * not in this module's scope.
 *
 * WS message shape (versioned for the relay's compatibility shim):
 *
 *   client → server
 *     { type: 'start', protoVersion: 1, sampleRate, format, sessionTag }
 *     { type: 'audio', sequence, dataB64 }         // PCM16LE chunks
 *     { type: 'stop' }
 *
 *   server → client
 *     { type: 'session', sessionId, serverTimeMs }
 *     { type: 'frame',   sequence, audioTimeMs, coefficients[52] }
 *     { type: 'end' }
 *     { type: 'error',   code, message }
 *
 * `audioTimeMs` is the frame's intended landing time on the audio clock,
 * referenced to the start of audio playback (audioStart). The telemetry
 * emitter compares `audioTimeMs` against wall-clock arrival to compute
 * `viseme_audio_drift_ms`.
 */

import { ARKIT_52_LENGTH, type Arkit52Frame, jawOpenOf } from './arkit52.js';
import type { LipsyncTelemetryEmitter } from './telemetry.js';

export interface A2F3dStartMessage {
  type: 'start';
  protoVersion: 1;
  sampleRate: number;
  format: 'pcm16le';
  sessionTag?: string;
}

export interface A2F3dAudioMessage {
  type: 'audio';
  sequence: number;
  dataB64: string;
}

export interface A2F3dStopMessage {
  type: 'stop';
}

export type A2F3dClientMessage = A2F3dStartMessage | A2F3dAudioMessage | A2F3dStopMessage;

export interface A2F3dSessionMessage {
  type: 'session';
  sessionId: string;
  serverTimeMs: number;
}

export interface A2F3dFrameMessage {
  type: 'frame';
  sequence: number;
  audioTimeMs: number;
  coefficients: number[];
}

export interface A2F3dEndMessage {
  type: 'end';
}

export interface A2F3dErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type A2F3dServerMessage =
  | A2F3dSessionMessage
  | A2F3dFrameMessage
  | A2F3dEndMessage
  | A2F3dErrorMessage;

/** Minimal WebSocket surface — typed against the methods we actually use so
 *  the client unit-tests against a fake without the jsdom WebSocket polyfill. */
export interface A2F3dSocket {
  send(payload: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export type A2F3dSocketFactory = (url: string) => A2F3dSocket;

export interface A2F3dClientOptions {
  url: string;
  sampleRate?: number;
  sessionTag?: string;
  telemetry?: LipsyncTelemetryEmitter;
  /** Called for every ARKit-52 frame in arrival order. Apply this frame to
   *  the mesh via `applyFrameToMesh` from `./arkit52.ts`. */
  onFrame: (frame: Arkit52Frame, audioTimeMs: number) => void;
  /** Called once when the server confirms the session is open. */
  onReady?: (sessionId: string) => void;
  /** Called when the server signals end-of-stream. */
  onEnd?: () => void;
  /** Called on protocol/socket errors. */
  onError?: (error: Error) => void;
  socketFactory?: A2F3dSocketFactory;
  /** Wall clock; defaults to `performance.now()`. */
  now?: () => number;
}

export interface A2F3dClient {
  /** Open the WS, send `start`. Resolves on `session`. */
  open(): Promise<void>;
  /** Push a PCM16LE chunk. Encodes as base64 before send. */
  sendAudio(chunk: Uint8Array): void;
  /** Send `stop`. The server is expected to flush remaining frames and emit
   *  `end`. */
  stop(): void;
  /** Close the socket immediately. Use on cancel/error. */
  close(): void;
}

export function createA2F3dClient(options: A2F3dClientOptions): A2F3dClient {
  const {
    url,
    sampleRate = 16000,
    sessionTag,
    telemetry,
    onFrame,
    onReady,
    onEnd,
    onError,
    socketFactory = defaultSocketFactory,
    now = () => performance.now(),
  } = options;

  let socket: A2F3dSocket | null = null;
  let audioStartedAtMs: number | null = null;
  let nextAudioSeq = 0;

  function handleServerMessage(raw: string) {
    let msg: A2F3dServerMessage;
    try {
      msg = JSON.parse(raw) as A2F3dServerMessage;
    } catch (err) {
      onError?.(new Error(`a2f3d: malformed server frame: ${(err as Error).message}`));
      return;
    }
    switch (msg.type) {
      case 'session': {
        onReady?.(msg.sessionId);
        return;
      }
      case 'frame': {
        if (msg.coefficients.length !== ARKIT_52_LENGTH) {
          onError?.(
            new Error(
              `a2f3d: frame had ${msg.coefficients.length} coefficients, expected ${ARKIT_52_LENGTH}`,
            ),
          );
          return;
        }
        if (audioStartedAtMs === null) {
          // First frame doubles as audio-start anchor — the relay emits the
          // first frame at the first audio chunk's landing time, so this is
          // the correct origin even when the browser is preroll-buffering.
          audioStartedAtMs = now();
          telemetry?.audioStart(audioStartedAtMs);
        }
        const frame = msg.coefficients as Arkit52Frame;
        telemetry?.frame(msg.audioTimeMs, now(), { jawOpen: jawOpenOf(frame) });
        onFrame(frame, msg.audioTimeMs);
        return;
      }
      case 'end': {
        telemetry?.audioEnd();
        onEnd?.();
        return;
      }
      case 'error': {
        telemetry?.cancel();
        onError?.(new Error(`a2f3d[${msg.code}]: ${msg.message}`));
        return;
      }
    }
  }

  return {
    open() {
      return new Promise<void>((resolve, reject) => {
        try {
          socket = socketFactory(url);
        } catch (err) {
          reject(err as Error);
          return;
        }
        socket.addEventListener('open', () => {
          const start: A2F3dStartMessage = {
            type: 'start',
            protoVersion: 1,
            sampleRate,
            format: 'pcm16le',
            ...(sessionTag !== undefined ? { sessionTag } : {}),
          };
          socket?.send(JSON.stringify(start));
          resolve();
        });
        socket.addEventListener('message', (event) => handleServerMessage(event.data));
        socket.addEventListener('error', (event) => {
          onError?.(new Error(`a2f3d: socket error ${describeSocketError(event)}`));
          reject(new Error('a2f3d: socket error during open'));
        });
        socket.addEventListener('close', () => {
          if (audioStartedAtMs !== null) telemetry?.cancel();
          socket = null;
          audioStartedAtMs = null;
        });
      });
    },
    sendAudio(chunk) {
      if (!socket) return;
      const audio: A2F3dAudioMessage = {
        type: 'audio',
        sequence: nextAudioSeq++,
        dataB64: encodeBase64(chunk),
      };
      socket.send(JSON.stringify(audio));
    },
    stop() {
      if (!socket) return;
      const stop: A2F3dStopMessage = { type: 'stop' };
      socket.send(JSON.stringify(stop));
    },
    close() {
      if (!socket) return;
      socket.close();
      socket = null;
      audioStartedAtMs = null;
    },
  };
}

function defaultSocketFactory(url: string): A2F3dSocket {
  if (typeof WebSocket === 'undefined') {
    throw new Error('a2f3d: WebSocket is not available in this environment');
  }
  return new WebSocket(url) as unknown as A2F3dSocket;
}

function describeSocketError(event: unknown): string {
  if (event && typeof event === 'object' && 'message' in event) {
    const m = (event as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'unknown';
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
    return btoa(binary);
  }
  // Node fallback for vitest. `Buffer` is the only practical encoder in
  // CommonJS without pulling a polyfill.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new Error('a2f3d: no base64 encoder available');
}
