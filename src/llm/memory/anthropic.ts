/**
 * Anthropic memory-tool command bridge.
 *
 * Implements the `memory_20250818` tool surface against a `MemoryStore`. The
 * commands and string shapes here match the Anthropic docs so that switching
 * the brain to Claude with the native memory tool is wiring change only:
 *
 *   1. Hand `memoryToolDefinition()` to the Anthropic SDK as the tool spec.
 *   2. On each `tool_use` block, call `executeMemoryCommand(store, cmd)`
 *      and return the result string as a `tool_result`.
 *
 * Until then we leave the surface in place and use the snapshot/mutation
 * loop in `snapshot.ts` for the OpenRouter free-tier path.
 */

import type { MemoryStore } from './store.js';
import type { MemoryCommand, MemoryCommandResult } from './types.js';

/**
 * Tool definition shape Claude expects. Returns `unknown` because we don't
 * import the Anthropic SDK types — the consumer (whoever wires Claude) casts
 * to whatever local type they prefer.
 */
export function memoryToolDefinition(): Record<string, unknown> {
  return {
    type: 'memory_20250818',
    name: 'memory',
  };
}

function ok(output: string): MemoryCommandResult {
  return { ok: true, output };
}

function pickRangeLines(content: string, range: readonly [number, number]): string {
  const [startRaw, endRaw] = range;
  const lines = content.split('\n');
  // Anthropic uses 1-indexed inclusive ranges. Treat 0 / negative as 1.
  const start = Math.max(1, Math.floor(startRaw)) - 1;
  const endNorm = Math.floor(endRaw) <= 0 ? lines.length : Math.floor(endRaw);
  const end = Math.min(lines.length, endNorm);
  return lines.slice(start, end).join('\n');
}

async function viewCommand(
  store: MemoryStore,
  path: string,
  range?: readonly [number, number],
): Promise<MemoryCommandResult> {
  const file = await store.read(path);
  if (file === null) {
    // Not a file — try directory listing. Anthropic returns a directory
    // listing when the path resolves to a folder; we mirror that semantics.
    const entries = await store.list(path);
    if (entries.length === 0) {
      return ok(`(empty: ${path})`);
    }
    const lines = entries.map((e) => `- ${e}`).join('\n');
    return ok(`Directory ${path}:\n${lines}`);
  }
  if (range && range.length === 2) {
    return ok(pickRangeLines(file, range));
  }
  return ok(file);
}

async function createCommand(
  store: MemoryStore,
  path: string,
  fileText: string,
): Promise<MemoryCommandResult> {
  await store.write(path, fileText);
  return ok(`Wrote ${path} (${fileText.length} chars).`);
}

async function strReplaceCommand(
  store: MemoryStore,
  path: string,
  oldStr: string,
  newStr: string,
): Promise<MemoryCommandResult> {
  const current = await store.read(path);
  if (current === null) {
    throw new Error(`memory: str_replace: file missing (${path})`);
  }
  const idx = current.indexOf(oldStr);
  if (idx === -1) {
    throw new Error(`memory: str_replace: old_str not found in ${path}`);
  }
  // Match Anthropic's "replace single occurrence" semantic — refuse when the
  // pattern is ambiguous so we don't silently mutate the wrong line.
  if (current.indexOf(oldStr, idx + 1) !== -1) {
    throw new Error(`memory: str_replace: old_str matches more than once in ${path}`);
  }
  const next = current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
  await store.write(path, next);
  return ok(`Replaced 1 occurrence in ${path}.`);
}

async function insertCommand(
  store: MemoryStore,
  path: string,
  insertLine: number,
  insertText: string,
): Promise<MemoryCommandResult> {
  const current = (await store.read(path)) ?? '';
  const lines = current === '' ? [] : current.split('\n');
  // 1-indexed: `insert_line: 0` means "insert at top". Clamp to valid range
  // rather than throwing — Claude occasionally over-runs by one.
  const idx = Math.max(0, Math.min(lines.length, Math.floor(insertLine)));
  const insertLines = insertText.split('\n');
  const next = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join('\n');
  await store.write(path, next);
  return ok(`Inserted ${insertLines.length} line(s) into ${path}.`);
}

async function deleteCommand(store: MemoryStore, path: string): Promise<MemoryCommandResult> {
  const removed = await store.delete(path);
  return ok(removed ? `Deleted ${path}.` : `(noop: ${path} did not exist)`);
}

async function renameCommand(
  store: MemoryStore,
  oldPath: string,
  newPath: string,
): Promise<MemoryCommandResult> {
  await store.rename(oldPath, newPath);
  return ok(`Renamed ${oldPath} -> ${newPath}.`);
}

/**
 * Single-entry dispatch for the Anthropic memory-tool command set. Throws on
 * caller error (missing file, ambiguous str_replace, malformed command).
 * Wrap the call in `try/catch` and return `{ is_error: true, content }` to
 * Claude when shimming this in.
 */
export function executeMemoryCommand(
  store: MemoryStore,
  cmd: MemoryCommand,
): Promise<MemoryCommandResult> {
  switch (cmd.command) {
    case 'view':
      return viewCommand(store, cmd.path, cmd.view_range);
    case 'create':
      return createCommand(store, cmd.path, cmd.file_text);
    case 'str_replace':
      return strReplaceCommand(store, cmd.path, cmd.old_str, cmd.new_str);
    case 'insert':
      return insertCommand(store, cmd.path, cmd.insert_line, cmd.insert_text);
    case 'delete':
      return deleteCommand(store, cmd.path);
    case 'rename':
      return renameCommand(store, cmd.old_path, cmd.new_path);
  }
}
