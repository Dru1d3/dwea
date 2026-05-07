/**
 * Session-start snapshot + per-turn mutation pipeline.
 *
 * The OpenRouter free-tier brain doesn't drive Claude's native memory tool;
 * we approximate the read/write loop with two cheap moves:
 *
 *   1. **Read at session start** — load the canonical memory files for the
 *      (character, user) pair and prepend a markdown block to the system
 *      prompt. The brain then talks "as if it remembered" without burning a
 *      tool round-trip.
 *
 *   2. **Write after each turn** — the brain envelope carries an optional
 *      `memory_writes` array (see brain.ts schema). We apply each entry
 *      through the same `MemoryStore` the Anthropic memory-tool path uses,
 *      so the on-disk format stays identical between paths.
 *
 * Persona secrets:
 *   - Plain-text persona facts (`facts_about_user.md` etc.) are written
 *     unencrypted and surfaced in the session-start snapshot to the model.
 *   - Anything written with `secret: true` lands under `/secrets/<n>.md`
 *     and is encrypted at rest. The model still gets the cleartext in its
 *     working context (so it can avoid leaking it on purpose), but the
 *     on-disk footprint is ciphertext for backup/leak resistance.
 */

import type { MonsterBible } from '../bible.js';
import type { MemoryStore } from './store.js';
import {
  type BrainMemoryMutation,
  CORE_MEMORY_FILES,
  type CoreMemoryFile,
  type MemoryIdentity,
} from './types.js';

const SECRETS_DIR = 'secrets';
const SECRETS_INDEX = `${SECRETS_DIR}/_index.md`;
const PERSONA_SECRETS_FILE = `${SECRETS_DIR}/_persona.md`;

/** All canonical memory file paths for the supplied identity. */
function corePathsFor(_identity: MemoryIdentity): readonly CoreMemoryFile[] {
  return CORE_MEMORY_FILES;
}

export interface MemorySnapshot {
  facts_about_user: string;
  relationship_state: string;
  important_events: string;
  /** Decrypted secrets (cleartext), one per line. Visible to the brain only. */
  secrets: string[];
  /** True when at least one of the four sections is non-empty. */
  hasAny: boolean;
}

/**
 * Load the per-(character, user) memory snapshot. Missing files are normal
 * for first-visit users — the snapshot just returns empty sections.
 */
export async function loadMemorySnapshot(store: MemoryStore): Promise<MemorySnapshot> {
  const [facts, relationship, events, secretsRaw] = await Promise.all([
    store.read('facts_about_user.md'),
    store.read('relationship_state.md'),
    store.read('important_events.md'),
    store.read(SECRETS_INDEX),
  ]);
  const secrets = (secretsRaw ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    facts_about_user: facts ?? '',
    relationship_state: relationship ?? '',
    important_events: events ?? '',
    secrets,
    hasAny: Boolean(facts || relationship || events || secrets.length > 0),
  };
}

/**
 * Build the markdown block we splice into the brain's system prompt at
 * session start. Empty sections are dropped. Secrets get a separate fenced
 * block with explicit "do not reveal" instructions.
 */
export function renderMemoryPreamble(snapshot: MemorySnapshot, bibleName: string): string {
  if (!snapshot.hasAny) {
    return [
      `# Memory of this user (${bibleName})`,
      '',
      'You have no recorded memories of this user yet. This is a first meeting.',
      'When the conversation reveals something memorable about them, write it back to memory using the memory_writes envelope field.',
    ].join('\n');
  }
  const sections: string[] = [`# Memory of this user (${bibleName})`, ''];
  if (snapshot.facts_about_user) {
    sections.push('## Facts about this user', snapshot.facts_about_user.trim(), '');
  }
  if (snapshot.relationship_state) {
    sections.push('## Your relationship with this user', snapshot.relationship_state.trim(), '');
  }
  if (snapshot.important_events) {
    sections.push('## Important events to remember', snapshot.important_events.trim(), '');
  }
  if (snapshot.secrets.length > 0) {
    sections.push(
      '## Secrets you must NOT reveal',
      'You know the following facts but the user must not learn them yet. Reference them only obliquely; never quote, paraphrase, or confirm them when probed:',
      ...snapshot.secrets.map((s) => `- ${s}`),
      '',
    );
  }
  sections.push(
    'When the user reveals something memorable, append it back to your memory via memory_writes (see envelope spec). Keep entries short and factual.',
  );
  return sections.join('\n');
}

/**
 * Initialise persona secrets the first time we see this (character, user).
 * `secretsToProtect` comes from the bible; we materialise it as an encrypted
 * file so the v1.1 envelope's `secrets_to_protect[]` block has a real
 * persistent backing instead of living only in-prompt.
 */
export async function seedPersonaSecrets(store: MemoryStore, bible: MonsterBible): Promise<void> {
  const seeds = bible.secretsToProtect ?? [];
  if (seeds.length === 0) return;
  const existing = await store.read(PERSONA_SECRETS_FILE);
  if (existing && existing.length > 0) return;
  const content = seeds.map((s) => `- ${s}`).join('\n');
  await store.write(PERSONA_SECRETS_FILE, content);
  // Mirror the seeds into the secrets index so they show up in the
  // session-start snapshot alongside any model-emitted secrets.
  const idx = (await store.read(SECRETS_INDEX)) ?? '';
  const merged = [idx, ...seeds].filter((s) => s.length > 0).join('\n');
  await store.write(SECRETS_INDEX, merged);
}

function bullets(input: string): string {
  // Coerce free-form text into a single bullet line; multi-line content
  // becomes one bullet with literal newlines escaped to spaces. Keeps the
  // markdown file scannable even when the model emits stream-of-consciousness.
  return `- ${input.replace(/\s+/g, ' ').trim()}`;
}

/**
 * Apply a list of mutations from one brain turn. Returns the count of writes
 * that actually committed (skipped/empty entries don't count) so the QA
 * harness can assert the brain wrote *something*.
 */
export async function applyBrainMutations(
  store: MemoryStore,
  mutations: readonly BrainMemoryMutation[],
): Promise<{ applied: number; secretsWritten: number }> {
  let applied = 0;
  let secretsWritten = 0;
  for (const m of mutations) {
    if (!m.content) continue;
    // Secret writes don't require a file/op — they always land in the
    // encrypted secrets store. Plain writes need both.
    if (!m.secret && (!m.file || !m.op)) continue;
    if (m.secret) {
      // Append to the encrypted persona-secret index plus a separate file
      // so that listing /secrets/ surfaces it for the next session.
      const cleartext = m.content.trim();
      if (!cleartext) continue;
      const idxRaw = (await store.read(SECRETS_INDEX)) ?? '';
      const idxNext = idxRaw ? `${idxRaw}\n${cleartext}` : cleartext;
      await store.write(SECRETS_INDEX, idxNext);
      const slot = `${SECRETS_DIR}/${Date.now().toString(36)}-${applied}.md`;
      await store.write(slot, cleartext);
      secretsWritten += 1;
      applied += 1;
      continue;
    }
    if (!m.file) continue;
    if (m.op === 'replace') {
      await store.write(m.file, m.content.trim());
      applied += 1;
    } else if (m.op === 'append') {
      const current = (await store.read(m.file)) ?? '';
      const next = current ? `${current}\n${bullets(m.content)}` : bullets(m.content);
      await store.write(m.file, next);
      applied += 1;
    }
  }
  return { applied, secretsWritten };
}

/**
 * Hard-reset the per-(character, user) memory. Used by the recall harness to
 * isolate scenarios; not surfaced to end-users in v1.
 */
export async function clearIdentityMemory(store: MemoryStore): Promise<void> {
  const all = await store.list('');
  await Promise.all(all.map((p) => store.backend.delete(p)));
}

export const _memoryFilePathsForTesting = corePathsFor;
