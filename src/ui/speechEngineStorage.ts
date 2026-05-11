/**
 * localStorage for the user-facing speech-engine choice and the optional
 * Groq Whisper key. The env-var resolver in `sttProvider.ts` provides the
 * fallback default; this module lets the SettingsDialog overwrite it per
 * browser without forcing a rebuild.
 *
 * SSR-safe and quota-tolerant — same shape as `llm/storage.ts`.
 */

import type { SttProviderKind } from './sttProvider.js';

const KEY_ENGINE = 'dwea.stt.engine';
const KEY_GROQ_KEY = 'dwea.stt.groq.key';

export type SpeechEngineChoice = SttProviderKind;

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
    // ignore — quota / private mode
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

function isEngine(value: string | null): value is SpeechEngineChoice {
  return value === 'web-speech' || value === 'groq';
}

/** Read the saved engine. Returns null when the user has not chosen yet. */
export function loadSpeechEngine(): SpeechEngineChoice | null {
  const raw = safeGet(KEY_ENGINE);
  return isEngine(raw) ? raw : null;
}

export function saveSpeechEngine(engine: SpeechEngineChoice | null): void {
  if (engine === null) {
    safeRemove(KEY_ENGINE);
    return;
  }
  safeSet(KEY_ENGINE, engine);
}

export function loadGroqApiKey(): string {
  return safeGet(KEY_GROQ_KEY) ?? '';
}

export function saveGroqApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed.length > 0) safeSet(KEY_GROQ_KEY, trimmed);
  else safeRemove(KEY_GROQ_KEY);
}
