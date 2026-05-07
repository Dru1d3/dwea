/**
 * MemoryStore — the application-layer surface over a `MemoryBackend`.
 *
 * Responsibilities:
 *   1. Resolve identity-scoped paths (`scopedPath` below).
 *   2. Apply transparent encryption when a path lives under `/secrets/`.
 *   3. Hand the same backing functions to two callers: the snapshot loader
 *      that produces the system-prompt context, and the Anthropic
 *      memory-tool command handler (`anthropic.ts`).
 *
 * No React, no DOM. The browser/IndexedDB binding lives in `browserStore.ts`;
 * tests use `createInMemoryBackend` from this module.
 */

import { type MemoryCipher, createMemoryCipher } from './crypto.js';
import type { MemoryBackend, MemoryIdentity } from './types.js';

/**
 * Identity-scope a logical path. The raw path the caller passes in is treated
 * as a virtual filesystem rooted at the (customer, character, user) tuple —
 * so a model write to `facts_about_user.md` lands at
 * `/memories/<customer>/<character>/<user>/facts_about_user.md`.
 *
 * Paths starting with `/memories/` are accepted verbatim if they already
 * include the namespace; this lets the Anthropic tool surface accept the
 * canonical paths it documents (`/memories/notes.md` → namespaced) without
 * the model having to know about customer/character/user ids.
 */
export function scopedPath(identity: MemoryIdentity, rawPath: string): string {
  const root = `/memories/${identity.customerId}/${identity.characterId}/${identity.userId}`;
  // Drop trailing slashes so callers don't have to be careful — backend
  // listing is `path === prefix || startsWith(${prefix}/)`, which a trailing
  // slash on `prefix` defeats.
  const trimmed = rawPath.replace(/\/+$/, '');
  if (!trimmed || trimmed === '' || trimmed === '/memories') {
    return root;
  }
  if (trimmed.startsWith(`${root}/`) || trimmed === root) return trimmed;
  // Strip a leading `/memories/...` if present so we always re-namespace.
  const stripped = trimmed.startsWith('/memories/')
    ? trimmed.slice('/memories/'.length).replace(/^[^/]+\/[^/]+\/[^/]+\/?/, '')
    : trimmed.replace(/^\/+/, '');
  return stripped ? `${root}/${stripped}` : root;
}

/** Returns true for paths the cipher should transparently encrypt. */
export function isSecretPath(path: string): boolean {
  return path.includes('/secrets/');
}

export interface MemoryStore {
  identity: MemoryIdentity;
  /** Read a file. Returns null when missing. Decrypts secret paths. */
  read(rawPath: string): Promise<string | null>;
  /** Write a file. Encrypts secret paths transparently. */
  write(rawPath: string, content: string): Promise<void>;
  /** Delete a file. Returns true if a file actually existed. */
  delete(rawPath: string): Promise<boolean>;
  /** List paths under a directory (always identity-scoped). */
  list(rawPrefix: string): Promise<readonly string[]>;
  /** Move a file. Re-encrypts on cross-secrets-boundary moves. */
  rename(oldRaw: string, newRaw: string): Promise<void>;
  /**
   * Read the **on-disk** ciphertext (or plain bytes) without decrypting.
   * Used by the leakage QA harness to assert secret files are encrypted at
   * rest — production callers should always use `read`.
   */
  readRawForAudit(rawPath: string): Promise<string | null>;
  /** Direct access to the cipher — primarily for tests / harness. */
  readonly cipher: MemoryCipher;
  /** Direct access to the backend — for resets and bulk listing in tests. */
  readonly backend: MemoryBackend;
}

export function createMemoryStore(backend: MemoryBackend, identity: MemoryIdentity): MemoryStore {
  const cipher = createMemoryCipher(backend);

  return {
    identity,
    cipher,
    backend,
    async read(rawPath: string): Promise<string | null> {
      const path = scopedPath(identity, rawPath);
      const raw = await backend.read(path);
      if (raw === null) return null;
      if (cipher.isEncrypted(raw)) return cipher.decrypt(raw);
      return raw;
    },
    async write(rawPath: string, content: string): Promise<void> {
      const path = scopedPath(identity, rawPath);
      const payload = isSecretPath(path) ? await cipher.encrypt(content) : content;
      await backend.write(path, payload);
    },
    async delete(rawPath: string): Promise<boolean> {
      const path = scopedPath(identity, rawPath);
      return backend.delete(path);
    },
    async list(rawPrefix: string): Promise<readonly string[]> {
      const prefix = scopedPath(identity, rawPrefix);
      return backend.list(prefix);
    },
    async rename(oldRaw: string, newRaw: string): Promise<void> {
      const oldPath = scopedPath(identity, oldRaw);
      const newPath = scopedPath(identity, newRaw);
      const wasSecret = isSecretPath(oldPath);
      const willBeSecret = isSecretPath(newPath);
      if (wasSecret === willBeSecret) {
        await backend.rename(oldPath, newPath);
        return;
      }
      // Crossing the secrets boundary — read, decrypt/encrypt, write, delete.
      const raw = await backend.read(oldPath);
      if (raw === null) {
        throw new Error(`memory: rename: source missing (${oldPath})`);
      }
      const plaintext = cipher.isEncrypted(raw) ? await cipher.decrypt(raw) : raw;
      const next = willBeSecret ? await cipher.encrypt(plaintext) : plaintext;
      await backend.write(newPath, next);
      await backend.delete(oldPath);
    },
    async readRawForAudit(rawPath: string): Promise<string | null> {
      const path = scopedPath(identity, rawPath);
      return backend.read(path);
    },
  };
}

/**
 * Pure in-memory backend. Keeps a `Map<path, value>` and nothing else.
 * Used by every unit test in the memory package; production wiring uses
 * `createBrowserBackend()` from `browserStore.ts`.
 */
export function createInMemoryBackend(): MemoryBackend & {
  /** Snapshot the current contents — handy for assertions. */
  snapshot(): ReadonlyMap<string, string>;
  clear(): void;
} {
  const data = new Map<string, string>();
  return {
    async read(path: string): Promise<string | null> {
      return data.has(path) ? (data.get(path) ?? null) : null;
    },
    async write(path: string, content: string): Promise<void> {
      data.set(path, content);
    },
    async delete(path: string): Promise<boolean> {
      return data.delete(path);
    },
    async list(prefix: string): Promise<readonly string[]> {
      const out: string[] = [];
      for (const k of data.keys()) {
        if (k === prefix || k.startsWith(`${prefix}/`)) out.push(k);
      }
      return out.sort();
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      const v = data.get(oldPath);
      if (v === undefined) throw new Error(`memory: rename: source missing (${oldPath})`);
      data.set(newPath, v);
      data.delete(oldPath);
    },
    snapshot(): ReadonlyMap<string, string> {
      return new Map(data);
    },
    clear(): void {
      data.clear();
    },
  };
}
