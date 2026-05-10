/**
 * CSV serializer for [TelemetryRecord](./types.ts).
 *
 * `compute_sigma_log.py` accepts column-name flags so order is flexible, but
 * we put `ts`, `ttfa_ms`, `ttf_face_ms` first to match the script's defaults
 * and keep `cat *.csv` readable for the dogfood operator.
 *
 * Quoting: RFC 4180 minimal — quote any field that contains comma, newline,
 * or double-quote, escape " as "". Numeric and timestamp fields don't need
 * quoting under our schema, but we run them through anyway so the function
 * is regular and audit-grep'd.
 */
import type { TelemetryRecord } from './types.js';

export const TELEMETRY_CSV_COLUMNS = [
  'ts',
  'ttfa_ms',
  'ttf_face_ms',
  'session_id',
  'turn_id',
  'npc_id',
  'route',
  'llm_provider',
  'tts_provider',
  'device_tier',
  'input_modality',
  'schema_version',
] as const;

type Column = (typeof TELEMETRY_CSV_COLUMNS)[number];

const COLUMN_FOR_FIELD: Record<Column, (r: TelemetryRecord) => string | number> = {
  ts: (r) => r.ts,
  ttfa_ms: (r) => r.ttfa_ms,
  ttf_face_ms: (r) => r.ttf_face_ms,
  session_id: (r) => r.sessionId,
  turn_id: (r) => r.turnId,
  npc_id: (r) => r.npcId,
  route: (r) => r.route,
  llm_provider: (r) => r.llmProvider,
  tts_provider: (r) => r.ttsProvider,
  device_tier: (r) => r.deviceTier,
  input_modality: (r) => r.inputModality,
  schema_version: (r) => r.schemaVersion,
};

export function recordsToCsv(records: readonly TelemetryRecord[]): string {
  const lines: string[] = [TELEMETRY_CSV_COLUMNS.join(',')];
  for (const record of records) {
    const cells = TELEMETRY_CSV_COLUMNS.map((col) => csvCell(COLUMN_FOR_FIELD[col](record)));
    lines.push(cells.join(','));
  }
  // Trailing newline so `wc -l` matches `len(records) + 1`.
  return `${lines.join('\n')}\n`;
}

export function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
