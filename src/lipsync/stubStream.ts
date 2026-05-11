/**
 * Stub ARKit-52 stream generator.
 *
 * Drives the test page and side-by-side scaffolding without a GPU. It does
 * NOT replicate A2F-3D's acoustic mapping — it just gives the apply-to-mesh
 * and telemetry path a believable 60 fps sine-wave jaw envelope so the rest
 * of the pipeline is exercisable end-to-end.
 *
 * For the actual side-by-side comparison clip the relay (not this module)
 * forwards real A2F-3D frames. The stub remains useful for CI and local dev.
 */

import { ARKIT_52_LENGTH, type Arkit52Frame, frameFromSparse } from './arkit52.js';
import type { LipsyncTelemetryEmitter } from './telemetry.js';

export interface StubStreamOptions {
  /** Total stream duration in seconds. */
  durationSec: number;
  /** Target frame rate. Defaults to 60. */
  frameRate?: number;
  /** Jaw oscillation frequency in Hz. Defaults to 4 (~ syllable rate). */
  jawHz?: number;
  /** Optional telemetry emitter. */
  telemetry?: LipsyncTelemetryEmitter;
  /** Called for every frame. Apply via `applyFrameToMesh`. */
  onFrame: (frame: Arkit52Frame, audioTimeMs: number) => void;
  /** Called when the stream ends naturally. */
  onEnd?: () => void;
  /** Wall clock, defaults to `performance.now()`. */
  now?: () => number;
  /** Scheduler, defaults to `setTimeout`. Tests inject a synchronous one. */
  schedule?: (cb: () => void, ms: number) => void;
}

export interface StubStreamHandle {
  start(): void;
  stop(): void;
}

export function createStubStream(options: StubStreamOptions): StubStreamHandle {
  const {
    durationSec,
    frameRate = 60,
    jawHz = 4,
    telemetry,
    onFrame,
    onEnd,
    now = () => performance.now(),
    schedule = (cb, ms) => {
      setTimeout(cb, ms);
    },
  } = options;

  const totalFrames = Math.max(1, Math.floor(durationSec * frameRate));
  const frameIntervalMs = 1000 / frameRate;
  let cancelled = false;
  let started = false;

  function emitFrame(i: number, audioStartedAtMs: number) {
    if (cancelled) return;
    const audioTimeMs = (i / frameRate) * 1000;
    // Sine wave [0, 1] for jawOpen.
    const phase = (i / frameRate) * 2 * Math.PI * jawHz;
    const jaw = (Math.sin(phase) + 1) / 2;
    const frame = frameFromSparse({ jawOpen: jaw });
    telemetry?.frame(audioTimeMs, now(), { jawOpen: frame[17] ?? 0 });
    onFrame(frame, audioTimeMs);

    if (i + 1 >= totalFrames) {
      telemetry?.audioEnd();
      onEnd?.();
      return;
    }
    schedule(() => emitFrame(i + 1, audioStartedAtMs), frameIntervalMs);
  }

  return {
    start() {
      if (started) return;
      started = true;
      const audioStartedAtMs = now();
      telemetry?.audioStart(audioStartedAtMs);
      schedule(() => emitFrame(0, audioStartedAtMs), 0);
    },
    stop() {
      cancelled = true;
      telemetry?.cancel();
    },
  };
}

export const STUB_ENGINE_ID = 'a2f3d-stub' as const;

/** Convenience: build a single static "talking" frame at peak jaw open. */
export function peakTalkingFrame(): Arkit52Frame {
  return frameFromSparse({ jawOpen: 0.6, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 });
}

/** Sanity check used by tests. */
export const STUB_ARKIT_52_LENGTH = ARKIT_52_LENGTH;
