import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, withRecentMirror } from './store.js';
import type { TelemetryRecord } from './types.js';

function rec(turnId: string, ttfa = 1000): TelemetryRecord {
  return {
    sessionId: 's1',
    turnId,
    ts: `2026-05-10T12:00:0${turnId.length}.000Z`,
    ttfa_ms: ttfa,
    ttf_face_ms: ttfa + 50,
    npcId: 'mara',
    route: 'warm',
    llmProvider: 'openrouter',
    ttsProvider: 'web-speech',
    deviceTier: 'high',
    inputModality: 'text',
    schemaVersion: '1',
  };
}

describe('createMemoryBackend', () => {
  it('appends and lists in insertion order', async () => {
    const b = createMemoryBackend();
    await b.append(rec('a'));
    await b.append(rec('b'));
    const all = await b.list();
    expect(all.map((r) => r.turnId)).toEqual(['a', 'b']);
  });

  it('clear() empties the buffer', async () => {
    const b = createMemoryBackend();
    await b.append(rec('a'));
    await b.clear();
    const all = await b.list();
    expect(all).toEqual([]);
  });

  it('list() returns a copy — caller mutation does not leak', async () => {
    const b = createMemoryBackend();
    await b.append(rec('a'));
    const all = await b.list();
    all.push(rec('b'));
    const all2 = await b.list();
    expect(all2.map((r) => r.turnId)).toEqual(['a']);
  });
});

describe('withRecentMirror', () => {
  let backend: ReturnType<typeof createMemoryBackend>;
  beforeEach(() => {
    backend = createMemoryBackend();
  });

  it('mirrors most recent appends synchronously', async () => {
    const store = withRecentMirror(backend, 3);
    await store.append(rec('a'));
    await store.append(rec('b'));
    expect(store.recentSync().map((r) => r.turnId)).toEqual(['a', 'b']);
  });

  it('caps mirror at capacity, keeping the tail', async () => {
    const store = withRecentMirror(backend, 2);
    await store.append(rec('a'));
    await store.append(rec('b'));
    await store.append(rec('c'));
    expect(store.recentSync().map((r) => r.turnId)).toEqual(['b', 'c']);
  });

  it('list() refreshes the mirror from the backend', async () => {
    await backend.append(rec('a'));
    await backend.append(rec('b'));
    const store = withRecentMirror(backend, 5);
    // Before list(), the wrapper has not seen any of the pre-existing records.
    expect(store.recentSync()).toEqual([]);
    const all = await store.list();
    expect(all.map((r) => r.turnId)).toEqual(['a', 'b']);
    expect(store.recentSync().map((r) => r.turnId)).toEqual(['a', 'b']);
  });

  it('clear() wipes both the backend and the mirror', async () => {
    const store = withRecentMirror(backend, 5);
    await store.append(rec('a'));
    await store.clear();
    expect(store.recentSync()).toEqual([]);
    expect(await store.list()).toEqual([]);
  });
});
