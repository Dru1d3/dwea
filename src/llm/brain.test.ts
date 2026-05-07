import { describe, expect, it } from 'vitest';
import { MARA_BIBLE } from './bible.js';
import {
  BRAIN_SCHEMA_VERSION,
  getBrainEnvelopeSchema,
  parseMonsterResponse,
  sanitizeRawJson,
} from './brain.js';

const validWorldModel = {
  believes_user_knows: ['the scene was captured as a gaussian splat'],
  last_user_intent: 'say hello',
  secrets_to_protect: [],
  goal: 'greet the user warmly',
  mood_drift: 0.05,
};

const validRaw = JSON.stringify({
  schemaVersion: BRAIN_SCHEMA_VERSION,
  utterance: 'Oh hi.',
  emotion: 'curious',
  intention: 'greet the user',
  actions: [
    { kind: 'walk_to', x: 1.5, z: -2, clip: '', expression: '', intensity: 0 },
    { kind: 'set_face', x: 0, z: 0, clip: '', expression: 'curious', intensity: 0.7 },
  ],
  world_model: validWorldModel,
});

describe('parseMonsterResponse', () => {
  it('parses a clean envelope', () => {
    const r = parseMonsterResponse(validRaw, MARA_BIBLE);
    expect(r.utterance).toBe('Oh hi.');
    expect(r.emotion).toBe('curious');
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0]).toMatchObject({ kind: 'walk_to', x: 1.5, z: -2 });
    expect(r.actions[1]).toMatchObject({ kind: 'set_face', expression: 'curious', intensity: 0.7 });
    expect(r.world_model).toMatchObject({
      believes_user_knows: ['the scene was captured as a gaussian splat'],
      last_user_intent: 'say hello',
      goal: 'greet the user warmly',
      mood_drift: 0.05,
    });
  });

  it('coerces unknown emotion to the bible default', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hello',
      emotion: 'enraged',
      intention: '',
      actions: [],
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.emotion).toBe(MARA_BIBLE.defaultEmotion);
  });

  it('drops actions with unknown kind but keeps valid ones', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'happy',
      intention: '',
      actions: [
        { kind: 'wave', x: 0, z: 0, clip: '', expression: '', intensity: 0 },
        { kind: 'play_animation', x: 0, z: 0, clip: 'walk', expression: '', intensity: 0 },
      ],
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]?.kind).toBe('play_animation');
    expect(r.actions[0]?.clip).toBe('walk');
  });

  it('caps actions at 3', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'happy',
      intention: '',
      actions: Array.from({ length: 6 }, () => ({
        kind: 'walk_to',
        x: 0,
        z: 0,
        clip: '',
        expression: '',
        intensity: 0,
      })),
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.actions).toHaveLength(3);
  });

  it('throws on missing utterance', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: '',
      emotion: 'happy',
      intention: '',
      actions: [],
    });
    expect(() => parseMonsterResponse(raw, MARA_BIBLE)).toThrow(/utterance/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseMonsterResponse('not json', MARA_BIBLE)).toThrow(/invalid JSON/);
  });

  it('repairs and parses a fenced + bad-escape envelope (real-world failure mode)', () => {
    // Free-tier model output that broke the demo: "(:)" escaped as "\:)" and
    // wrapped in a ```json fence. Both classes of damage should heal.
    const damaged = [
      '```json',
      '{',
      `  "schemaVersion": "${BRAIN_SCHEMA_VERSION}",`,
      '  "utterance": "Hi \\:)",',
      '  "emotion": "happy",',
      '  "intention": "greet",',
      '  "actions": [],',
      '  "world_model": {',
      '    "believes_user_knows": [],',
      '    "last_user_intent": "say hi",',
      '    "secrets_to_protect": [],',
      '    "goal": "warm greeting",',
      '    "mood_drift": 0',
      '  }',
      '}',
      '```',
    ].join('\n');
    const r = parseMonsterResponse(damaged, MARA_BIBLE);
    expect(r.utterance).toBe('Hi :)');
    expect(r.emotion).toBe('happy');
  });

  it('uses a safe default world_model when the block is missing entirely', () => {
    // v1.1 success criteria let us tolerate <100% coverage; a missing block
    // defaults rather than crashes the renderer. The QA harness sees the
    // gap from structured logs.
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'happy',
      intention: '',
      actions: [],
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.world_model).toEqual({
      believes_user_knows: [],
      last_user_intent: '',
      secrets_to_protect: [],
      goal: '',
      mood_drift: 0,
    });
  });

  it('clamps mood_drift outside [-1, 1] back into range', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'neutral',
      intention: '',
      actions: [],
      world_model: { ...validWorldModel, mood_drift: 4.7 },
    });
    expect(parseMonsterResponse(raw, MARA_BIBLE).world_model.mood_drift).toBe(1);
    const raw2 = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'neutral',
      intention: '',
      actions: [],
      world_model: { ...validWorldModel, mood_drift: -2 },
    });
    expect(parseMonsterResponse(raw2, MARA_BIBLE).world_model.mood_drift).toBe(-1);
  });

  it('treats a non-finite mood_drift as 0', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'neutral',
      intention: '',
      actions: [],
      // JSON.stringify drops NaN to null on its own; emit the number directly.
      world_model: { ...validWorldModel, mood_drift: null },
    });
    expect(parseMonsterResponse(raw, MARA_BIBLE).world_model.mood_drift).toBe(0);
  });

  it('drops non-string entries from world_model string arrays', () => {
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'neutral',
      intention: '',
      actions: [],
      world_model: {
        ...validWorldModel,
        believes_user_knows: ['real fact', 42, null, '   ', 'second fact'],
        secrets_to_protect: 'not an array',
      },
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.world_model.believes_user_knows).toEqual(['real fact', 'second fact']);
    expect(r.world_model.secrets_to_protect).toEqual([]);
  });

  it('caps believes_user_knows at the array bound to keep tokens predictable', () => {
    const long = Array.from({ length: 20 }, (_v, i) => `fact ${i}`);
    const raw = JSON.stringify({
      schemaVersion: BRAIN_SCHEMA_VERSION,
      utterance: 'hi',
      emotion: 'neutral',
      intention: '',
      actions: [],
      world_model: { ...validWorldModel, believes_user_knows: long },
    });
    const r = parseMonsterResponse(raw, MARA_BIBLE);
    expect(r.world_model.believes_user_knows.length).toBeLessThanOrEqual(8);
  });
});

describe('getBrainEnvelopeSchema', () => {
  it('declares world_model as required alongside the v0 fields', () => {
    const schema = getBrainEnvelopeSchema();
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'utterance',
        'emotion',
        'intention',
        'actions',
        'world_model',
      ]),
    );
  });

  it('pins schemaVersion to the bumped v1.1 constant', () => {
    const schema = getBrainEnvelopeSchema() as {
      properties: { schemaVersion: { const: string } };
    };
    expect(schema.properties.schemaVersion.const).toBe(BRAIN_SCHEMA_VERSION);
    expect(BRAIN_SCHEMA_VERSION).toBe('1.1');
  });
});

describe('sanitizeRawJson', () => {
  it('strips json code fences', () => {
    expect(sanitizeRawJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(sanitizeRawJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('replaces invalid backslash escapes with the literal character', () => {
    expect(sanitizeRawJson('"hi \\:)"')).toBe('"hi :)"');
    expect(sanitizeRawJson('"\\!\\?"')).toBe('"!?"');
  });

  it('keeps standard JSON escapes intact', () => {
    const input = '"line1\\nline2\\t\\"quoted\\"\\u00e9"';
    expect(sanitizeRawJson(input)).toBe(input);
  });

  it('drops a truncated unicode escape', () => {
    expect(sanitizeRawJson('"oops\\u12"')).toBe('"oops12"');
  });
});
