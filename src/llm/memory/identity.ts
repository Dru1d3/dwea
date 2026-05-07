/**
 * Identity helpers for the memory layer.
 *
 * v1 has no real auth — the "user" is anyone with a tab open. We mint a
 * stable random id on first load and persist it in localStorage so a
 * returning visitor lines up with their prior memory file. Privacy posture:
 * the id is opaque and origin-bound; nothing personally identifying enters
 * the path.
 *
 * `customerId` stays at `_default` for v1 (single tenant). v2 wires this to
 * a real customer record when the multi-tenant authoring loop ships.
 */

import type { MemoryIdentity } from './types.js';

const KEY_USER_ID = 'dwea.memory.user-id';
const KEY_CUSTOMER_ID = 'dwea.memory.customer-id';
const DEFAULT_CUSTOMER_ID = '_default';

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // localStorage unavailable (private mode, server-side render). Caller
    // gets an in-memory fallback — the id won't survive reload, but the
    // current session still scopes correctly.
  }
}

/**
 * Random URL-safe id without bringing in a UUID dep. 16 bytes from
 * `crypto.getRandomValues` is overkill collision-wise (~10^38 namespace) but
 * cheap, and the function falls back to `Math.random()` if Web Crypto isn't
 * available (older browsers, exotic SSR shims).
 */
export function mintAnonymousUserId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return `u-${out}`;
}

/**
 * Resolve the persistent user id for the current browser, minting one if it
 * doesn't yet exist. Idempotent and safe to call from any layer.
 */
export function loadOrMintUserId(): string {
  const existing = safeGet(KEY_USER_ID);
  if (existing && existing.length > 0) return existing;
  const fresh = mintAnonymousUserId();
  safeSet(KEY_USER_ID, fresh);
  return fresh;
}

/**
 * Customer id for the running deployment. Single-tenant default for v1; the
 * value is read from localStorage so a future settings UI / build-time env
 * can override it without touching this module.
 */
export function loadCustomerId(): string {
  const existing = safeGet(KEY_CUSTOMER_ID);
  if (existing && existing.length > 0) return existing;
  return DEFAULT_CUSTOMER_ID;
}

/**
 * Build the identity tuple used by every memory operation. Pass the
 * character bible's `id` field for `characterId`.
 */
export function resolveMemoryIdentity(characterId: string): MemoryIdentity {
  return {
    customerId: loadCustomerId(),
    characterId,
    userId: loadOrMintUserId(),
  };
}

/**
 * Test/Storybook helper — replace the persisted user id. Real callers should
 * not use this; it exists so the recall harness can reset state between
 * scenarios without poking localStorage directly.
 */
export function setUserIdForTesting(userId: string): void {
  safeSet(KEY_USER_ID, userId);
}
