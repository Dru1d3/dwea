/**
 * localStorage wrapper for the LLM motor's Anthropic API key. Mirrors
 * src/llm/storage.ts (OpenRouter) so the two providers can be configured
 * independently and tests don't share state.
 */
const KEY_API = 'dwea.motor.anthropic.key';

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
    /* quota or private mode — degrade silently */
  }
}
function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* same */
  }
}

export function loadMotorApiKey(): string {
  return safeGet(KEY_API) ?? '';
}

export function saveMotorApiKey(key: string): void {
  if (key) safeSet(KEY_API, key);
  else safeRemove(KEY_API);
}
