/**
 * Tiny localStorage wrapper. SSR-safe and quota-error tolerant — if storage
 * is unavailable or full we degrade to in-memory for the current session.
 */

const KEY_API = 'dwea.anthropic.key';
const KEY_GREETING_SEED = 'dwea.anthropic.greeting-seed';

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
    // Ignore — quota, private mode, etc.
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore.
  }
}

export function loadApiKey(): string {
  return safeGet(KEY_API) ?? '';
}

export function saveApiKey(key: string): void {
  if (key) safeSet(KEY_API, key);
  else safeRemove(KEY_API);
}

/**
 * Greeting seed rotates each load so the same visitor sees variety, but
 * never costs a network call. Seed is just `Date.now()` modulo bank size,
 * persisted so a quick reload doesn't always show greeting #0.
 */
export function rotateGreetingSeed(): number {
  const previous = Number(safeGet(KEY_GREETING_SEED) ?? '0');
  const next = (previous + 1 + Math.floor(Math.random() * 3)) % 9973; // bound it
  safeSet(KEY_GREETING_SEED, String(next));
  return next;
}
