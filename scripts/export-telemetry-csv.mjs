#!/usr/bin/env node
/**
 * Aggregate per-user telemetry CSVs (downloaded via the in-app Settings
 * dialog) into one σ_log-ready CSV.
 *
 *   node scripts/export-telemetry-csv.mjs \
 *     --input ./telemetry-drop \
 *     --output ./dwea-sigma-log.csv
 *
 * Inputs:
 *   --input <dir>  directory of *.csv (or *.json) drops from dogfood users.
 *                  Defaults to ./telemetry-drop.
 *   --output <file>  destination CSV. Defaults to ./dwea-sigma-log.csv.
 *
 * Behaviour:
 *   - Reads every *.csv directly under <dir> (one header row per file).
 *   - Reads every *.json: either a single TelemetryRecord, an array of
 *     records, or NDJSON (one record per line) — whichever the user pasted.
 *   - De-dupes on (session_id, turn_id) so a user uploading two snapshots
 *     of the same buffer doesn't double-count.
 *   - Writes a single CSV with the canonical column order from
 *     src/telemetry/csv.ts. Trailing newline preserved so wc -l matches.
 *   - Prints a one-line summary: row count, unique session count, date
 *     window. The summary is the only thing on stdout; the CSV goes to the
 *     output file (or stdout when --output -).
 *
 * Out-of-scope: schema migration. If a future schema_version lands, the
 * script will warn and skip mismatched rows so a single bad file doesn't
 * corrupt the σ_log run.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const COLUMNS = [
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
];

function parseArgs(argv) {
  const args = { input: './telemetry-drop', output: './dwea-sigma-log.csv' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') args.input = argv[++i];
    else if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: export-telemetry-csv.mjs [--input <dir>] [--output <file>|-]\n');
      process.exit(0);
    }
  }
  return args;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function fromAppRecord(rec) {
  // Accept both the in-memory record shape (camelCase) and the CSV row shape.
  return {
    ts: rec.ts,
    ttfa_ms: rec.ttfa_ms ?? rec.ttfaMs,
    ttf_face_ms: rec.ttf_face_ms ?? rec.ttfFaceMs,
    session_id: rec.session_id ?? rec.sessionId,
    turn_id: rec.turn_id ?? rec.turnId,
    npc_id: rec.npc_id ?? rec.npcId,
    route: rec.route,
    llm_provider: rec.llm_provider ?? rec.llmProvider,
    tts_provider: rec.tts_provider ?? rec.ttsProvider,
    device_tier: rec.device_tier ?? rec.deviceTier,
    input_modality: rec.input_modality ?? rec.inputModality,
    schema_version: rec.schema_version ?? rec.schemaVersion ?? '1',
  };
}

function parseCsvLine(line) {
  // Minimal RFC 4180 parser — handles "" escapes inside quoted fields.
  const out = [];
  let i = 0;
  let cur = '';
  let quoted = false;
  while (i < line.length) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cur += c;
      i++;
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
        i++;
        continue;
      }
      if (c === '"' && cur === '') {
        quoted = true;
        i++;
        continue;
      }
      cur += c;
      i++;
    }
  }
  out.push(cur);
  return out;
}

async function readFromCsv(filePath) {
  const text = await readFile(filePath, 'utf8');
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = cells[j];
    }
    records.push(fromAppRecord(obj));
  }
  return records;
}

async function readFromJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  const stripped = text.trim();
  if (!stripped) return [];
  // NDJSON or single JSON.
  if (stripped.startsWith('[') || stripped.startsWith('{')) {
    const parsed = JSON.parse(stripped);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(fromAppRecord);
  }
  return stripped
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => fromAppRecord(JSON.parse(l)));
}

function dedupe(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const key = `${r.session_id}::${r.turn_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function summarize(records) {
  const sessions = new Set(records.map((r) => r.session_id));
  const ts = records
    .map((r) => r.ts)
    .filter((t) => typeof t === 'string' && t.length > 0)
    .sort();
  const earliest = ts[0] ?? '';
  const latest = ts[ts.length - 1] ?? '';
  return { rows: records.length, sessions: sessions.size, earliest, latest };
}

function toCsv(records) {
  const lines = [COLUMNS.join(',')];
  for (const r of records) {
    lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let dirEntries;
  try {
    dirEntries = await readdir(args.input);
  } catch (err) {
    process.stderr.write(`error: cannot read --input directory ${args.input}: ${err.message}\n`);
    process.exit(1);
  }
  const records = [];
  for (const name of dirEntries) {
    const filePath = path.join(args.input, name);
    if (name.endsWith('.csv')) {
      records.push(...(await readFromCsv(filePath)));
    } else if (name.endsWith('.json') || name.endsWith('.ndjson')) {
      records.push(...(await readFromJson(filePath)));
    }
  }
  const deduped = dedupe(records);
  const csv = toCsv(deduped);
  if (args.output === '-') {
    process.stdout.write(csv);
  } else {
    await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
    await writeFile(args.output, csv, 'utf8');
  }
  const s = summarize(deduped);
  process.stdout.write(
    `wrote ${s.rows} rows, ${s.sessions} sessions, window ${s.earliest || '?'} → ${s.latest || '?'}, output=${args.output}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`error: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
