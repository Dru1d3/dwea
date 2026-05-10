import { describe, expect, it } from 'vitest';
import { createTelemetry } from './emitter.js';
import type { SessionContext } from './session.js';
import { createMemoryBackend } from './store.js';
import type { TelemetryRecord } from './types.js';

function setup(opts: { isCold?: boolean } = {}) {
  const backend = createMemoryBackend();
  const session: SessionContext = {
    sessionId: 'sess-1',
    isCold: opts.isCold ?? true,
    deviceTier: 'high',
  };
  const sent: TelemetryRecord[] = [];
  const t = 1000;
  let mockNowMs = t;
  const now = () => new Date('2026-05-10T12:00:00.000Z');
  const perfNow = () => mockNowMs;
  const emitter = createTelemetry({
    session,
    backend,
    send: (r) => sent.push(r),
    now,
    perfNow,
  });
  return {
    backend,
    session,
    sent,
    emitter,
    advance(ms: number) {
      mockNowMs += ms;
    },
    perfNow: () => mockNowMs,
  };
}

const beginArgs = {
  userDoneSpeakingAt: 1000,
  npcId: 'mara',
  llmProvider: 'openrouter:meta/llama',
  ttsProvider: 'web-speech',
  inputModality: 'web-speech' as const,
};

describe('createTelemetry', () => {
  it('emits a record once both first-audio and first-face fire', async () => {
    const { backend, sent, emitter, advance, perfNow } = setup();
    const turn = emitter.beginTurn(beginArgs);
    advance(800);
    turn.markFirstAudio(perfNow());
    advance(50);
    turn.markFirstFace(perfNow());

    const all = await backend.list();
    expect(all.length).toBe(1);
    expect(sent.length).toBe(1);
    const r = all[0];
    if (!r) throw new Error('expected record');
    expect(r.ttfa_ms).toBe(800);
    expect(r.ttf_face_ms).toBe(850);
    expect(r.sessionId).toBe('sess-1');
    expect(r.npcId).toBe('mara');
    expect(r.deviceTier).toBe('high');
  });

  it('order of mark calls does not matter', async () => {
    const { backend, emitter, advance, perfNow } = setup();
    const turn = emitter.beginTurn(beginArgs);
    advance(900);
    turn.markFirstFace(perfNow());
    advance(20);
    turn.markFirstAudio(perfNow());
    const all = await backend.list();
    expect(all.length).toBe(1);
    const r = all[0];
    if (!r) throw new Error('expected record');
    expect(r.ttf_face_ms).toBe(900);
    expect(r.ttfa_ms).toBe(920);
  });

  it('first turn is route=cold, subsequent turns are warm', async () => {
    const { backend, emitter, advance, perfNow } = setup({ isCold: true });
    const t1 = emitter.beginTurn(beginArgs);
    advance(500);
    t1.markFirstAudio(perfNow());
    t1.markFirstFace(perfNow());
    const t2 = emitter.beginTurn({ ...beginArgs, userDoneSpeakingAt: perfNow() });
    advance(300);
    t2.markFirstAudio(perfNow());
    t2.markFirstFace(perfNow());

    const all = await backend.list();
    expect(all.map((r) => r.route)).toEqual(['cold', 'warm']);
  });

  it('aborting the open turn drops it without emitting', async () => {
    const { backend, sent, emitter, advance, perfNow } = setup();
    const turn = emitter.beginTurn(beginArgs);
    advance(100);
    turn.markFirstAudio(perfNow());
    turn.abort('user-cancelled');
    expect((await backend.list()).length).toBe(0);
    expect(sent.length).toBe(0);
  });

  it('starting a new turn while one is still open silently drops the old turn', async () => {
    const { backend, emitter, advance, perfNow } = setup();
    const stale = emitter.beginTurn(beginArgs);
    advance(50);
    stale.markFirstAudio(perfNow());
    // user submits again before face/audio settle
    const fresh = emitter.beginTurn({ ...beginArgs, userDoneSpeakingAt: perfNow() });
    advance(200);
    // stale handle should now be inert
    stale.markFirstFace(perfNow());
    expect((await backend.list()).length).toBe(0);
    fresh.markFirstAudio(perfNow());
    fresh.markFirstFace(perfNow());
    const all = await backend.list();
    expect(all.length).toBe(1);
  });

  it('repeated mark calls on the same handle are no-ops', async () => {
    const { backend, emitter, advance, perfNow } = setup();
    const turn = emitter.beginTurn(beginArgs);
    advance(400);
    turn.markFirstAudio(perfNow());
    advance(50);
    turn.markFirstAudio(perfNow()); // ignored
    turn.markFirstFace(perfNow());
    advance(20);
    turn.markFirstFace(perfNow()); // ignored

    const all = await backend.list();
    expect(all.length).toBe(1);
    expect(all[0]?.ttfa_ms).toBe(400);
    expect(all[0]?.ttf_face_ms).toBe(450);
  });

  it('lastRecord() returns the most recently completed turn', async () => {
    const { emitter, advance, perfNow } = setup();
    expect(emitter.lastRecord()).toBeNull();
    const turn = emitter.beginTurn(beginArgs);
    advance(700);
    turn.markFirstAudio(perfNow());
    turn.markFirstFace(perfNow());
    expect(emitter.lastRecord()?.ttfa_ms).toBe(700);
  });
});
