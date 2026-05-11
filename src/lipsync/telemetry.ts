/**
 * Engine-agnostic lip-sync telemetry.
 *
 * Emits the four named metrics requested by SystemsArchitect's observability
 * pass ([DWEA-108](/DWEA/issues/DWEA-108) §2.1) and committed to the v1
 * frame in the Spike B issue ([DWEA-118](/DWEA/issues/DWEA-118)):
 *
 *   - viseme_audio_drift_ms   per-frame drift between audio playback time and
 *                             the viseme frame's intended playback time. p95
 *                             of this is the uncanny-floor signal — AR cites
 *                             ITU-R BT.1359 as the 80 ms threshold.
 *   - viseme_frame_rate       observed viseme frames per second (target: 60).
 *   - jaw_open_amplitude_p95  p95 of `jawOpen` over the utterance. Lets us
 *                             tell "rubber face" (low) from a healthy
 *                             talking-monster envelope.
 *   - lipsync_engine_id       which engine produced this stream — `convai`,
 *                             `a2f3d`, `webspeech`, or `none`.
 *
 * The same emitter wires under v1.2 Convai (per the FE commitment in
 * [DWEA-41](/DWEA/issues/DWEA-41) follow-up) so we're collecting drift signal
 * against the v1 default from day one, not at v1.5.
 */

export type LipsyncEngineId = 'convai' | 'a2f3d' | 'webspeech' | 'none';

/**
 * Snapshot of the metrics an utterance produced. Emitted exactly once per
 * utterance at the end (audioEnd or cancel), unless the utterance produced
 * zero frames in which case nothing is emitted.
 */
export interface LipsyncMetricsSnapshot {
  lipsync_engine_id: LipsyncEngineId;
  /** Total viseme frames observed during the utterance. */
  viseme_frame_count: number;
  /** Observed frame rate = frames / utteranceDurationSec. */
  viseme_frame_rate: number;
  /** p50 of per-frame drift, in milliseconds. */
  viseme_audio_drift_ms_p50: number;
  /** p95 of per-frame drift, in milliseconds. */
  viseme_audio_drift_ms_p95: number;
  /** p95 of jaw-open amplitude across the utterance. Range [0, 1]. */
  jaw_open_amplitude_p95: number;
  /** Wall-clock duration of the utterance, in milliseconds. */
  utterance_duration_ms: number;
}

export type LipsyncMetricsSink = (snapshot: LipsyncMetricsSnapshot) => void;

/** Subset of ARKit-52 blendshape names the emitter consumes. Full list lives
 *  in `./arkit52.ts`; the emitter intentionally only knows about `jawOpen`
 *  so it stays cheap and engine-agnostic. */
export interface FrameBlendshapes {
  /** ARKit-52 `jawOpen`, range [0, 1]. */
  jawOpen?: number;
}

export interface LipsyncTelemetryEmitter {
  /** Mark audio playback start. `audioTimeMs` is the audio clock origin
   *  (typically `performance.now()` at the moment audio begins). */
  audioStart(audioTimeMs: number): void;
  /** Record one viseme frame.
   *  @param visemeTimeMs The viseme's intended playback time on the audio
   *                      clock (i.e. when it should land in the audio).
   *  @param nowMs        Wall-clock arrival time (`performance.now()`).
   *  @param frame        Blendshape values for this frame. */
  frame(visemeTimeMs: number, nowMs: number, frame: FrameBlendshapes): void;
  /** Mark audio playback end. Emits the snapshot to the sink. */
  audioEnd(): void;
  /** Discard the utterance without emitting. Use on cancel/error. */
  cancel(): void;
}

export interface CreateLipsyncTelemetryOptions {
  engineId: LipsyncEngineId;
  sink: LipsyncMetricsSink;
  /** Wall clock for tests. Defaults to `performance.now()`. */
  now?: () => number;
}

export function createLipsyncTelemetry(
  options: CreateLipsyncTelemetryOptions,
): LipsyncTelemetryEmitter {
  const { engineId, sink } = options;
  const now = options.now ?? (() => performance.now());

  let audioStartedAtMs: number | null = null;
  let drifts: number[] = [];
  let jawOpens: number[] = [];
  let frameCount = 0;
  let lastFrameNowMs = 0;

  return {
    audioStart(audioTimeMs) {
      audioStartedAtMs = audioTimeMs;
      drifts = [];
      jawOpens = [];
      frameCount = 0;
      lastFrameNowMs = audioTimeMs;
    },
    frame(visemeTimeMs, nowMs, frame) {
      if (audioStartedAtMs === null) return;
      // Drift = wall-clock elapsed since audio start minus the viseme's
      // intended playback time. Positive => viseme arrived late.
      const elapsedAudioMs = nowMs - audioStartedAtMs;
      const drift = elapsedAudioMs - visemeTimeMs;
      drifts.push(drift);
      if (typeof frame.jawOpen === 'number') jawOpens.push(clamp01(frame.jawOpen));
      frameCount += 1;
      lastFrameNowMs = nowMs;
    },
    audioEnd() {
      if (audioStartedAtMs === null || frameCount === 0) {
        audioStartedAtMs = null;
        return;
      }
      const endMs = Math.max(lastFrameNowMs, now());
      const durationMs = endMs - audioStartedAtMs;
      const durationSec = durationMs / 1000;
      const snapshot: LipsyncMetricsSnapshot = {
        lipsync_engine_id: engineId,
        viseme_frame_count: frameCount,
        viseme_frame_rate: durationSec > 0 ? frameCount / durationSec : 0,
        viseme_audio_drift_ms_p50: percentile(drifts, 50),
        viseme_audio_drift_ms_p95: percentile(drifts, 95),
        jaw_open_amplitude_p95: percentile(jawOpens, 95),
        utterance_duration_ms: durationMs,
      };
      audioStartedAtMs = null;
      sink(snapshot);
    },
    cancel() {
      audioStartedAtMs = null;
      drifts = [];
      jawOpens = [];
      frameCount = 0;
    },
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Linear-interpolation percentile. Returns 0 on empty input so the sink
 *  never sees NaN — a missing `jawOpen` channel is meaningfully zero, not
 *  "unknown", because the channel's job is to drive the mouth. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const single = sorted[0];
  if (sorted.length === 1) return single ?? 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] ?? 0;
  const hiV = sorted[hi] ?? 0;
  if (lo === hi) return loV;
  const frac = rank - lo;
  return loV * (1 - frac) + hiV * frac;
}

/** Convenience: console sink, useful in development and tests. */
export const consoleSink: LipsyncMetricsSink = (snapshot) => {
  console.info('[lipsync.telemetry]', snapshot);
};
