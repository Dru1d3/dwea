import { describe, expect, it, vi } from 'vitest';
import { type LipsyncMetricsSnapshot, createLipsyncTelemetry, percentile } from './telemetry.js';

describe('percentile', () => {
  it('returns 0 on empty input so sinks never see NaN', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });

  it('returns the single value when only one sample exists', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('linear-interpolates between samples', () => {
    // [0, 10, 20, 30] — rank for p50 is 1.5 → mean(10, 20) = 15.
    expect(percentile([0, 10, 20, 30], 50)).toBe(15);
    // rank for p95 is 2.85 → 20*0.15 + 30*0.85 = 28.5.
    expect(percentile([0, 10, 20, 30], 95)).toBeCloseTo(28.5, 5);
  });
});

describe('createLipsyncTelemetry', () => {
  it('emits one snapshot at audioEnd with the four named metrics', () => {
    const snapshots: LipsyncMetricsSnapshot[] = [];
    const emitter = createLipsyncTelemetry({
      engineId: 'a2f3d',
      sink: (s) => snapshots.push(s),
      now: () => 1000,
    });

    // 60 fps for 1 second worth of frames — 60 frames, 0 drift, jawOpen ramps
    // 0 → 1.
    emitter.audioStart(0);
    for (let i = 0; i < 60; i++) {
      const t = (i / 60) * 1000;
      emitter.frame(t, t, { jawOpen: i / 60 });
    }
    emitter.audioEnd();

    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0] as LipsyncMetricsSnapshot;
    expect(snap.lipsync_engine_id).toBe('a2f3d');
    expect(snap.viseme_frame_count).toBe(60);
    // Frame rate within rounding of 60 fps.
    expect(snap.viseme_frame_rate).toBeGreaterThan(59);
    expect(snap.viseme_frame_rate).toBeLessThan(62);
    expect(snap.viseme_audio_drift_ms_p50).toBe(0);
    expect(snap.viseme_audio_drift_ms_p95).toBe(0);
    expect(snap.jaw_open_amplitude_p95).toBeGreaterThan(0.9);
  });

  it('captures drift when viseme frames arrive late on the audio clock', () => {
    const sink = vi.fn();
    const emitter = createLipsyncTelemetry({
      engineId: 'convai',
      sink,
      now: () => 250,
    });

    // 10 frames, each meant for visemeTime = i*10ms, but each arrives 25 ms
    // after audio start (i.e. all of them landed late by 25-i*10 ms).
    emitter.audioStart(100);
    for (let i = 0; i < 10; i++) {
      const visemeTimeMs = i * 10;
      // nowMs = 100 (audio start) + 25 (lateness baseline) + i (slight ramp)
      emitter.frame(visemeTimeMs, 125 + i, { jawOpen: 0.3 });
    }
    emitter.audioEnd();

    const snap = sink.mock.calls[0]?.[0] as LipsyncMetricsSnapshot;
    expect(snap.lipsync_engine_id).toBe('convai');
    // Per-frame drift series:
    //   i=0: (125-100) - 0   = 25
    //   i=1: (126-100) - 10  = 16
    //   ...                     drops by ~9 each step
    //   i=9: (134-100) - 90  = -56
    // p95 should be near the top of that range — around 24 with interpolation.
    expect(snap.viseme_audio_drift_ms_p95).toBeGreaterThan(20);
  });

  it('does not emit when no frames were recorded', () => {
    const sink = vi.fn();
    const emitter = createLipsyncTelemetry({ engineId: 'none', sink });
    emitter.audioStart(0);
    emitter.audioEnd();
    expect(sink).not.toHaveBeenCalled();
  });

  it('cancel() drops the utterance', () => {
    const sink = vi.fn();
    const emitter = createLipsyncTelemetry({ engineId: 'a2f3d', sink });
    emitter.audioStart(0);
    emitter.frame(0, 0, { jawOpen: 0.5 });
    emitter.cancel();
    emitter.audioEnd();
    expect(sink).not.toHaveBeenCalled();
  });

  it('clamps out-of-range jawOpen values into [0, 1]', () => {
    const sink = vi.fn();
    const emitter = createLipsyncTelemetry({ engineId: 'a2f3d', sink });
    emitter.audioStart(0);
    emitter.frame(0, 0, { jawOpen: 2.5 });
    emitter.frame(16, 16, { jawOpen: -0.5 });
    emitter.frame(32, 32, { jawOpen: Number.NaN });
    emitter.audioEnd();
    const snap = sink.mock.calls[0]?.[0] as LipsyncMetricsSnapshot;
    expect(snap.jaw_open_amplitude_p95).toBeLessThanOrEqual(1);
    expect(snap.jaw_open_amplitude_p95).toBeGreaterThanOrEqual(0);
  });
});
