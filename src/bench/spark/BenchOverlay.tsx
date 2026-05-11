import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { type BenchSummary, type FrameSampler, type TtfaMarks, deltasToStats } from './perf.js';

export type BenchOverlayProps = {
  readonly sampler: FrameSampler;
  readonly assetUrl: string;
  /** Splat count; supplied by SparkSplatScene's `onLoaded`. */
  readonly numSplats: number | null;
  /** Bytes-on-the-wire; supplied by App once the fetch HEAD probe resolves. */
  readonly bytesOnTheWire: number | null;
  /** Wall-clock ms since navigation when the splat finished loading. */
  readonly splatLoadedMs: number | null;
  /** Wall-clock ms since navigation for first frame Spark contributed pixels. */
  readonly firstSplatFrameMs: number | null;
  /** Wall-clock ms since navigation for first frame both splat + monster painted. */
  readonly bothVisibleMs: number | null;
  /** Recording window length in ms (default 60_000). */
  readonly durationMs?: number;
  /** Warmup window length in ms (default 1_500) discarded before recording. */
  readonly warmupMs?: number;
};

type Phase = 'pending' | 'warming' | 'recording' | 'done';

/**
 * The bench overlay lives inside <Canvas> only for `useFrame` — it returns
 * `null` for the R3F render output and renders its DOM via a portal-free
 * sibling effect. Keeping all DOM out of the canvas avoids issues with R3F's
 * `<html>` extension dependency.
 */
export function BenchOverlayInsideCanvas({
  onSample,
}: { readonly onSample: (deltaMs: number, ts: number) => void }) {
  useFrame((_state, delta) => {
    onSample(delta * 1000, performance.now());
  });
  return null;
}

export function BenchOverlay(props: BenchOverlayProps) {
  const duration = props.durationMs ?? 60_000;
  const warmup = props.warmupMs ?? 1_500;

  const samplerRef = useRef(props.sampler);
  samplerRef.current = props.sampler;

  const [phase, setPhase] = useState<Phase>('pending');
  const [livePhase, setLivePhase] = useState<{ ms: number; fps: number }>({ ms: 0, fps: 0 });
  const [summary, setSummary] = useState<BenchSummary | null>(null);
  const recordingStartRef = useRef<number | null>(null);

  const ready = props.bothVisibleMs != null;

  // Phase machine: pending → warming (when both splat + monster visible) →
  // recording (after warmup) → done (after recording window).
  useEffect(() => {
    if (!ready) {
      setPhase('pending');
      return;
    }
    setPhase('warming');
    const warmupTimer = window.setTimeout(() => {
      samplerRef.current.reset();
      recordingStartRef.current = performance.now();
      setPhase('recording');
    }, warmup);
    return () => {
      window.clearTimeout(warmupTimer);
    };
  }, [ready, warmup]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const recordingTimer = window.setTimeout(() => {
      const snap = samplerRef.current.snapshot();
      const marks: TtfaMarks = {
        splatLoadedMs: props.splatLoadedMs,
        firstSplatFrameMs: props.firstSplatFrameMs,
        bothVisibleMs: props.bothVisibleMs,
      };
      const startedAtMs = recordingStartRef.current ?? performance.now();
      const result: BenchSummary = {
        schema: 'dwea-111-spark-bench/v1',
        source: {
          url: props.assetUrl,
          numSplats: props.numSplats ?? null,
          bytesOnTheWire: props.bytesOnTheWire ?? null,
        },
        ttfa: marks,
        recording: {
          startedAtMs,
          durationMs: duration,
          stats: snap.stats,
        },
        env: {
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio,
          viewportPx: { width: window.innerWidth, height: window.innerHeight },
          hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
        },
      };
      setSummary(result);
      setPhase('done');
      const w = window as unknown as { __benchSummary?: BenchSummary };
      w.__benchSummary = result;
      // Console mirror so a runner can copy from devtools without touching DOM.
      console.info('[dwea-bench] complete', result);
    }, duration);
    return () => {
      window.clearTimeout(recordingTimer);
    };
  }, [
    phase,
    duration,
    props.assetUrl,
    props.numSplats,
    props.bytesOnTheWire,
    props.splatLoadedMs,
    props.firstSplatFrameMs,
    props.bothVisibleMs,
  ]);

  // Live HUD updater — sample sampler size + last 30 frames every 250ms.
  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = window.setInterval(() => {
      const snap = samplerRef.current.snapshot();
      const tail = snap.samples.slice(-30).map((s) => s.deltaMs);
      const fps = tail.length ? deltasToStats(tail).meanFps : 0;
      const ms = recordingStartRef.current ? performance.now() - recordingStartRef.current : 0;
      setLivePhase({ ms, fps });
    }, 250);
    return () => {
      window.clearInterval(tick);
    };
  }, [phase]);

  return (
    <output
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        minWidth: 260,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'rgba(10, 10, 14, 0.7)',
        backdropFilter: 'blur(6px)',
        color: '#e8e8f4',
        font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
        zIndex: 50,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        DWEA-111 Spark bench · {phaseLabel(phase)}
      </div>
      <div>
        <span style={{ opacity: 0.7 }}>splats:</span> {fmtNum(props.numSplats)}
      </div>
      <div>
        <span style={{ opacity: 0.7 }}>wire:</span> {fmtBytes(props.bytesOnTheWire)}
      </div>
      <div>
        <span style={{ opacity: 0.7 }}>TTFA splat:</span> {fmtMs(props.splatLoadedMs)}
      </div>
      <div>
        <span style={{ opacity: 0.7 }}>TTFA both:</span> {fmtMs(props.bothVisibleMs)}
      </div>
      {phase === 'recording' ? (
        <div style={{ marginTop: 6 }}>
          <div>
            <span style={{ opacity: 0.7 }}>elapsed:</span> {(livePhase.ms / 1000).toFixed(1)} /{' '}
            {(duration / 1000).toFixed(0)} s
          </div>
          <div>
            <span style={{ opacity: 0.7 }}>live fps (30-frame mean):</span>{' '}
            {livePhase.fps.toFixed(1)}
          </div>
        </div>
      ) : null}
      {summary ? (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
          <div>
            p50 {summary.recording.stats.p50Fps} · p95 {summary.recording.stats.p95Fps} · min{' '}
            {summary.recording.stats.minFps}
          </div>
          <button
            type="button"
            onClick={() => copySummary(summary)}
            style={{
              marginTop: 6,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#e8e8f4',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Copy JSON
          </button>
        </div>
      ) : null}
    </output>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case 'pending':
      return 'waiting for splat + monster';
    case 'warming':
      return 'warmup (1.5 s) — discarding';
    case 'recording':
      return 'recording (60 s)';
    case 'done':
      return 'done — copy JSON';
  }
}

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtMs(n: number | null): string {
  if (n == null) return '—';
  return `${n.toFixed(0)} ms`;
}

function copySummary(s: BenchSummary): void {
  const text = JSON.stringify(s, null, 2);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch((err) => {
      console.warn('[dwea-bench] clipboard write failed', err);
    });
  } else {
    console.info(text);
  }
}
