import { describe, expect, it, vi } from 'vitest';
import { type A2F3dServerMessage, type A2F3dSocket, createA2F3dClient } from './a2f3dClient.js';
import { ARKIT_52_LENGTH, frameFromSparse } from './arkit52.js';
import { type LipsyncMetricsSnapshot, createLipsyncTelemetry } from './telemetry.js';

interface FakeSocket extends A2F3dSocket {
  emit(type: 'open' | 'message' | 'close' | 'error', data?: unknown): void;
  sent: string[];
}

function createFakeSocket(): FakeSocket {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };
  const sent: string[] = [];
  return {
    sent,
    send(payload) {
      sent.push(payload);
    },
    close() {
      for (const fn of listeners.close ?? []) fn();
    },
    addEventListener(type: string, listener: (arg?: unknown) => void) {
      listeners[type]?.push(listener);
    },
    emit(type, data) {
      const payload = type === 'message' ? { data: data as string } : undefined;
      for (const fn of listeners[type] ?? []) fn(payload);
    },
  } as FakeSocket;
}

function frameMessage(audioTimeMs: number, jawOpen: number): A2F3dServerMessage {
  const coefficients = [...frameFromSparse({ jawOpen })] as number[];
  return { type: 'frame', sequence: 0, audioTimeMs, coefficients };
}

describe('createA2F3dClient', () => {
  it('sends a start message on socket open and resolves open()', async () => {
    const sock = createFakeSocket();
    const client = createA2F3dClient({
      url: 'ws://relay',
      onFrame: () => {},
      socketFactory: () => sock,
    });

    const pending = client.open();
    sock.emit('open');
    await pending;

    expect(sock.sent).toHaveLength(1);
    const start = JSON.parse(sock.sent[0] ?? '{}');
    expect(start.type).toBe('start');
    expect(start.protoVersion).toBe(1);
    expect(start.format).toBe('pcm16le');
  });

  it('dispatches frame messages to onFrame and feeds telemetry', async () => {
    const sock = createFakeSocket();
    const snapshots: LipsyncMetricsSnapshot[] = [];
    const telemetry = createLipsyncTelemetry({
      engineId: 'a2f3d',
      sink: (s) => snapshots.push(s),
      now: () => 100,
    });

    const seen: Array<{ audioTimeMs: number; jawOpen: number }> = [];
    let nowCounter = 0;
    const client = createA2F3dClient({
      url: 'ws://relay',
      telemetry,
      onFrame: (frame, audioTimeMs) => seen.push({ audioTimeMs, jawOpen: frame[17] ?? 0 }),
      socketFactory: () => sock,
      now: () => {
        // First frame triggers audioStart (uses now() once), then telemetry
        // frame uses now() again. Counter ramp drives drift across frames.
        nowCounter += 1;
        return nowCounter;
      },
    });

    const pending = client.open();
    sock.emit('open');
    await pending;

    sock.emit('message', JSON.stringify({ type: 'session', sessionId: 's', serverTimeMs: 0 }));
    sock.emit('message', JSON.stringify(frameMessage(0, 0.1)));
    sock.emit('message', JSON.stringify(frameMessage(16, 0.5)));
    sock.emit('message', JSON.stringify({ type: 'end' }));

    expect(seen).toHaveLength(2);
    expect(seen[0]?.audioTimeMs).toBe(0);
    expect(seen[1]?.audioTimeMs).toBe(16);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.lipsync_engine_id).toBe('a2f3d');
    expect(snapshots[0]?.viseme_frame_count).toBe(2);
  });

  it('rejects frames with a wrong coefficient count', async () => {
    const sock = createFakeSocket();
    const onError = vi.fn();
    const onFrame = vi.fn();
    const client = createA2F3dClient({
      url: 'ws://relay',
      onFrame,
      onError,
      socketFactory: () => sock,
    });

    const pending = client.open();
    sock.emit('open');
    await pending;

    const malformed = { type: 'frame', sequence: 0, audioTimeMs: 0, coefficients: [0, 0, 0] };
    sock.emit('message', JSON.stringify(malformed));

    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    const errArg = onError.mock.calls[0]?.[0] as Error;
    expect(errArg.message).toContain(`expected ${ARKIT_52_LENGTH}`);
  });

  it('serialises audio chunks as base64 in `audio` messages', async () => {
    const sock = createFakeSocket();
    const client = createA2F3dClient({
      url: 'ws://relay',
      onFrame: () => {},
      socketFactory: () => sock,
    });
    const pending = client.open();
    sock.emit('open');
    await pending;

    client.sendAudio(new Uint8Array([0x00, 0x01, 0xff]));

    const audioFrames = sock.sent.filter((s) => JSON.parse(s).type === 'audio');
    expect(audioFrames).toHaveLength(1);
    const parsed = JSON.parse(audioFrames[0] ?? '{}');
    expect(parsed.sequence).toBe(0);
    expect(typeof parsed.dataB64).toBe('string');
    // 3 bytes encode to 4 base64 chars (with padding).
    expect(parsed.dataB64).toHaveLength(4);
  });
});
