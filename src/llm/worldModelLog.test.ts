import { describe, expect, it } from 'vitest';
import type { MonsterResponse } from './brain.js';
import { BRAIN_SCHEMA_VERSION } from './brain.js';
import {
  MOOD_DRIFT_WARN_THRESHOLD,
  type WorldModelLogEntry,
  createWorldModelLogger,
} from './worldModelLog.js';

function makeResponse(moodDrift: number, utterance = 'hi'): MonsterResponse {
  return {
    schemaVersion: BRAIN_SCHEMA_VERSION,
    utterance,
    emotion: 'neutral',
    intention: '',
    actions: [],
    world_model: {
      believes_user_knows: [],
      last_user_intent: '',
      secrets_to_protect: [],
      goal: 'be helpful',
      mood_drift: moodDrift,
    },
  };
}

interface Captured {
  info: unknown[][];
  warn: unknown[][];
}

function captureConsole(): { console: { info: typeof console.info; warn: typeof console.warn }; out: Captured } {
  const out: Captured = { info: [], warn: [] };
  return {
    console: {
      info: (...args: unknown[]) => {
        out.info.push(args);
      },
      warn: (...args: unknown[]) => {
        out.warn.push(args);
      },
    },
    out,
  };
}

describe('createWorldModelLogger', () => {
  it('emits a structured info log on every recorded turn', () => {
    const sink: WorldModelLogEntry[] = [];
    const cap = captureConsole();
    const logger = createWorldModelLogger({
      bibleId: 'mara',
      sink: (e) => sink.push(e),
      console: cap.console,
    });
    logger.recordTurn(makeResponse(0));
    logger.recordTurn(makeResponse(0.1));
    expect(sink).toHaveLength(2);
    expect(cap.out.info).toHaveLength(2);
    expect(cap.out.info[0]?.[0]).toBe('[brain:world_model]');
    expect(sink[0]?.turnIndex).toBe(1);
    expect(sink[1]?.turnIndex).toBe(2);
    expect(sink[0]?.driftWarning).toBe(false);
    expect(sink[1]?.driftWarning).toBe(false);
    expect(cap.out.warn).toHaveLength(0);
  });

  it('fires the drift warning when |mood_drift| crosses the threshold', () => {
    const cap = captureConsole();
    const logger = createWorldModelLogger({ bibleId: 'mara', console: cap.console });
    expect(MOOD_DRIFT_WARN_THRESHOLD).toBe(0.5);
    const entry = logger.recordTurn(makeResponse(0.7));
    expect(entry.driftWarning).toBe(true);
    expect(cap.out.warn).toHaveLength(1);
    expect(cap.out.warn[0]?.[0]).toMatch(/\[brain:drift\]/);
    expect(cap.out.warn[0]?.[0]).toMatch(/0\.70/);
  });

  it('only fires the drift warning once per session even on repeated breaches', () => {
    const cap = captureConsole();
    const logger = createWorldModelLogger({ bibleId: 'mara', console: cap.console });
    const a = logger.recordTurn(makeResponse(0.6));
    const b = logger.recordTurn(makeResponse(0.9));
    const c = logger.recordTurn(makeResponse(-0.8));
    expect(a.driftWarning).toBe(true);
    expect(b.driftWarning).toBe(false);
    expect(c.driftWarning).toBe(false);
    expect(cap.out.warn).toHaveLength(1);
  });

  it('treats negative mood_drift the same as positive for the threshold check', () => {
    const cap = captureConsole();
    const logger = createWorldModelLogger({ bibleId: 'mara', console: cap.console });
    const entry = logger.recordTurn(makeResponse(-0.6));
    expect(entry.driftWarning).toBe(true);
    expect(cap.out.warn).toHaveLength(1);
  });

  it('does not warn at the threshold itself (strict greater-than)', () => {
    // mood_drift = 0.5 must NOT trip the warning — the threshold is strict so
    // a model nudging right up to it stays calm. This pins the comparator.
    const cap = captureConsole();
    const logger = createWorldModelLogger({ bibleId: 'mara', console: cap.console });
    const entry = logger.recordTurn(makeResponse(0.5));
    expect(entry.driftWarning).toBe(false);
    expect(cap.out.warn).toHaveLength(0);
  });

  it('truncates long utterances in the log preview', () => {
    const cap = captureConsole();
    const logger = createWorldModelLogger({ bibleId: 'mara', console: cap.console });
    const long = 'a'.repeat(200);
    const entry = logger.recordTurn(makeResponse(0, long));
    expect(entry.utterancePreview.length).toBeLessThanOrEqual(80);
    expect(entry.utterancePreview.endsWith('...')).toBe(true);
  });

  it('exposes turnCount for debug HUDs', () => {
    const logger = createWorldModelLogger({
      bibleId: 'mara',
      console: { info: () => undefined, warn: () => undefined },
    });
    expect(logger.turnCount).toBe(0);
    logger.recordTurn(makeResponse(0));
    logger.recordTurn(makeResponse(0));
    expect(logger.turnCount).toBe(2);
  });
});
