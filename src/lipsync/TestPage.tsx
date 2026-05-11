/**
 * Spike B test page. Renders a live ARKit-52 channel bar chart plus the four
 * named telemetry metrics, driven either by the stub stream or a live A2F-3D
 * relay. Opt in by visiting `/?lipsync-test`.
 *
 * Reader's note: this page does NOT need a face mesh. The acceptance criteria
 * are "telemetry metrics emitting from a working test page" and "A2F-3D
 * drives a stub rig without re-rigging". The bar chart is the cheapest
 * artefact that proves both, and side-steps the V1 face-rig work that is the
 * VisualDesigner's responsibility, not FE's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createA2F3dClient } from './a2f3dClient.js';
import {
  ARKIT_52_CHANNELS,
  ARKIT_52_LENGTH,
  type Arkit52Frame,
  frameFromSparse,
} from './arkit52.js';
import { createStubStream } from './stubStream.js';
import {
  type LipsyncEngineId,
  type LipsyncMetricsSnapshot,
  createLipsyncTelemetry,
} from './telemetry.js';

type Mode = 'stub' | 'live';

const DEFAULT_RELAY_URL = 'ws://localhost:7890/lipsync';

export function LipsyncTestPage() {
  const [mode, setMode] = useState<Mode>('stub');
  const [running, setRunning] = useState(false);
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [frame, setFrame] = useState<Arkit52Frame>(() => frameFromSparse({}));
  const [lastSnapshot, setLastSnapshot] = useState<LipsyncMetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const handleStart = useCallback(() => {
    if (running) return;
    setError(null);
    setLastSnapshot(null);
    const engineId: LipsyncEngineId = mode === 'stub' ? 'a2f3d' : 'a2f3d';
    const telemetry = createLipsyncTelemetry({
      engineId,
      sink: (s) => setLastSnapshot(s),
    });

    if (mode === 'stub') {
      const stub = createStubStream({
        durationSec: 3,
        telemetry,
        onFrame: (f) => setFrame(f),
        onEnd: () => {
          setRunning(false);
        },
      });
      stopRef.current = () => stub.stop();
      stub.start();
      setRunning(true);
      return;
    }

    const client = createA2F3dClient({
      url: relayUrl,
      telemetry,
      onFrame: (f) => setFrame(f),
      onReady: () => {
        // The relay flushes a canned 3-second clip; client just listens.
      },
      onEnd: () => {
        setRunning(false);
      },
      onError: (err) => {
        setError(err.message);
        setRunning(false);
      },
    });
    stopRef.current = () => client.close();
    client
      .open()
      .then(() => setRunning(true))
      .catch((err: Error) => {
        setError(err.message);
        setRunning(false);
      });
  }, [mode, relayUrl, running]);

  const handleStop = useCallback(() => {
    stopRef.current?.();
    setRunning(false);
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        padding: 24,
        boxSizing: 'border-box',
        background: '#0a0a0e',
        color: '#e8e8f4',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'auto',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        Spike B — lip-sync telemetry harness
      </h1>
      <p style={{ color: '#a8a8c8', fontSize: 13, marginTop: 4 }}>
        Engine-agnostic ARKit-52 + four named metrics. See{' '}
        <code>docs/runbooks/spike-b-a2f3d-activation.md</code>.
      </p>

      <section style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>
          Mode:{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            disabled={running}
            style={selectStyle}
          >
            <option value="stub">stub (no GPU)</option>
            <option value="live">live A2F-3D relay</option>
          </select>
        </label>
        {mode === 'live' && (
          <label style={{ fontSize: 13 }}>
            Relay:{' '}
            <input
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              disabled={running}
              style={{ ...selectStyle, width: 280 }}
            />
          </label>
        )}
        {!running ? (
          <button type="button" onClick={handleStart} style={buttonStyle}>
            Start
          </button>
        ) : (
          <button type="button" onClick={handleStop} style={buttonStyle}>
            Stop
          </button>
        )}
        {error && <span style={{ color: '#f87171', fontSize: 13 }}>{error}</span>}
      </section>

      <MetricsPanel snapshot={lastSnapshot} />

      <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 8, color: '#a8a8c8' }}>
        ARKit-52 channels (live)
      </h2>
      <ChannelBars frame={frame} />
    </div>
  );
}

function MetricsPanel({ snapshot }: { snapshot: LipsyncMetricsSnapshot | null }) {
  const rows: Array<[string, string]> = snapshot
    ? [
        ['lipsync_engine_id', snapshot.lipsync_engine_id],
        ['viseme_frame_rate (fps)', snapshot.viseme_frame_rate.toFixed(1)],
        ['viseme_audio_drift_ms_p50', snapshot.viseme_audio_drift_ms_p50.toFixed(1)],
        [
          'viseme_audio_drift_ms_p95',
          `${snapshot.viseme_audio_drift_ms_p95.toFixed(1)}${
            snapshot.viseme_audio_drift_ms_p95 > 80 ? '  ⚠ above 80 ms uncanny floor' : ''
          }`,
        ],
        ['jaw_open_amplitude_p95', snapshot.jaw_open_amplitude_p95.toFixed(3)],
        ['viseme_frame_count', String(snapshot.viseme_frame_count)],
        ['utterance_duration_ms', snapshot.utterance_duration_ms.toFixed(0)],
      ]
    : [];

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 14, marginBottom: 8, color: '#a8a8c8' }}>
        Last utterance — four named metrics
      </h2>
      {snapshot ? (
        <table style={{ borderCollapse: 'collapse', fontFamily: 'ui-monospace, monospace' }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '2px 12px 2px 0', color: '#a8a8c8' }}>{k}</td>
                <td style={{ padding: '2px 0' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: '#6a6a8a' }}>Run a stream to populate.</div>
      )}
    </section>
  );
}

function ChannelBars({ frame }: { frame: Arkit52Frame }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '2px 16px',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      }}
    >
      {ARKIT_52_CHANNELS.map((name, i) => {
        const value = frame[i] ?? 0;
        const pct = Math.max(0, Math.min(1, value)) * 100;
        return (
          <div
            key={name}
            style={{ display: 'grid', gridTemplateColumns: '160px 1fr 40px', alignItems: 'center' }}
          >
            <div style={{ color: name === 'jawOpen' ? '#fbbf24' : '#a8a8c8' }}>{name}</div>
            <div
              style={{
                height: 6,
                background: '#1a1a22',
                borderRadius: 3,
                overflow: 'hidden',
                margin: '0 8px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: name === 'jawOpen' ? '#fbbf24' : '#60a5fa',
                  transition: 'width 16ms linear',
                }}
              />
            </div>
            <div style={{ color: '#6a6a8a' }}>{value.toFixed(2)}</div>
          </div>
        );
      })}
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#6a6a8a', marginTop: 4 }}>
        {ARKIT_52_LENGTH} channels · canonical Apple ARKit-52 order
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: '#1f1f2b',
  color: '#e8e8f4',
  border: '1px solid #2f2f3f',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const selectStyle: React.CSSProperties = {
  background: '#1f1f2b',
  color: '#e8e8f4',
  border: '1px solid #2f2f3f',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 13,
};
