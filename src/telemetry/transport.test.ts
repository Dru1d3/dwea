import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport } from './transport.js';
import type { TelemetryRecord } from './types.js';

const sample: TelemetryRecord = {
  sessionId: 's',
  turnId: 't',
  ts: '2026-05-10T12:00:00.000Z',
  ttfa_ms: 1000,
  ttf_face_ms: 1100,
  npcId: 'mara',
  route: 'cold',
  llmProvider: 'openrouter',
  ttsProvider: 'web-speech',
  deviceTier: 'mid',
  inputModality: 'text',
  schemaVersion: '1',
};

describe('createHttpTransport', () => {
  it('is a no-op when endpoint is empty', () => {
    const fetchImpl = vi.fn();
    const send = createHttpTransport({
      endpoint: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    send(sample);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs JSON to the configured endpoint when sendBeacon is unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const send = createHttpTransport({
      endpoint: 'https://telemetry.example/ingest',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    send(sample);
    // microtask drain so the fire-and-forget fetch is enqueued
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://telemetry.example/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(sample);
  });

  it('swallows fetch rejection — never throws into the chat path', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const send = createHttpTransport({
      endpoint: 'https://telemetry.example/ingest',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(() => send(sample)).not.toThrow();
    // give the rejection a tick to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalled();
  });
});
