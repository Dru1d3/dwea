import { describe, expect, it } from 'vitest';
import { MARA_BIBLE } from './bible.js';
import { BRAIN_SCHEMA_VERSION, parseMonsterResponse, sanitizeRawJson } from './brain.js';

const validRaw = JSON.stringify({
  schemaVersion: BRAIN_SCHEMA_VERSION,
  utterance: 'Oh hi.',
  emotion: 'curious',
  intention: 'greet the user',
  actions: [
    { kind: 'walk_to', x: 1.5, z: -2, clip: '', expression: '', intensity: 0 },
    { kind: 'set_face', x: 0, z: 0, clip: '', expression: 'curious', intensity: 0.7 },
  ],
});

describe('parseMonsterResponse', () => {
  it('parses a clean envelope', () => {
    const r = parseMonsterResponse(validRaw, MARA_BIBLE);
    expect(r.utterance).toBe('Oh hi.');
    expect(r.emotion).toBe('curious');
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0]).toMatchObject({ kind: 'walk_to', x: 1.5, z: -2 });
    expect(r.actions[1]).toMatchObject({ kind: 'set_face', expression: 'curious', intensity: 0.7 });
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
      '  "schemaVersion": "1",',
      '  "utterance": "Hi \\:)",',
      '  "emotion": "happy",',
      '  "intention": "greet",',
      '  "actions": []',
      '}',
      '```',
    ].join('\n');
    const r = parseMonsterResponse(damaged, MARA_BIBLE);
    expect(r.utterance).toBe('Hi :)');
    expect(r.emotion).toBe('happy');
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
