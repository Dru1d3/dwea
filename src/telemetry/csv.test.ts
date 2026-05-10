import { describe, expect, it } from 'vitest';
import { TELEMETRY_CSV_COLUMNS, csvCell, recordsToCsv } from './csv.js';
import type { TelemetryRecord } from './types.js';

function record(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    sessionId: 's1',
    turnId: 't1',
    ts: '2026-05-10T12:00:00.000Z',
    ttfa_ms: 1234,
    ttf_face_ms: 1280,
    npcId: 'mara',
    route: 'cold',
    llmProvider: 'openrouter:meta/llama',
    ttsProvider: 'web-speech',
    deviceTier: 'mid',
    inputModality: 'web-speech',
    schemaVersion: '1',
    ...overrides,
  };
}

describe('csvCell', () => {
  it('passes plain text through unquoted', () => {
    expect(csvCell('hello')).toBe('hello');
  });
  it('quotes commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });
  it('quotes newlines', () => {
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('escapes embedded quotes', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
  });
  it('stringifies numbers', () => {
    expect(csvCell(42)).toBe('42');
  });
});

describe('recordsToCsv', () => {
  it('emits header with σ_log columns first', () => {
    const csv = recordsToCsv([record()]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(TELEMETRY_CSV_COLUMNS.join(','));
    expect(lines[0]?.startsWith('ts,ttfa_ms,ttf_face_ms')).toBe(true);
  });

  it('serialises one row per record', () => {
    const r1 = record({ turnId: 't1', ttfa_ms: 1000 });
    const r2 = record({ turnId: 't2', ttfa_ms: 2000, ttf_face_ms: 2100 });
    const csv = recordsToCsv([r1, r2]);
    const lines = csv.split('\n');
    // header + 2 data rows + trailing empty (because of final newline)
    expect(lines.length).toBe(4);
    expect(lines[1]?.startsWith('2026-05-10T12:00:00.000Z,1000,1280,')).toBe(true);
    expect(lines[2]?.startsWith('2026-05-10T12:00:00.000Z,2000,2100,')).toBe(true);
    expect(lines[3]).toBe('');
  });

  it('quotes provider strings that contain commas', () => {
    const csv = recordsToCsv([record({ llmProvider: 'openrouter,meta/llama' })]);
    expect(csv).toContain('"openrouter,meta/llama"');
  });

  it('column count matches header for every row', () => {
    const csv = recordsToCsv([record(), record({ turnId: 't2' })]);
    const lines = csv.trim().split('\n');
    const expected = TELEMETRY_CSV_COLUMNS.length;
    for (const line of lines) {
      // Naive comma count is fine here — no quoted commas in fixture data.
      expect(line.split(',').length).toBe(expected);
    }
  });
});
