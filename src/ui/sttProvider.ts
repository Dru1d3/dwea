/**
 * Resolve which STT provider to use at app start. The Web Speech API is the
 * zero-config fallback; Groq Whisper is opted into by setting
 * `VITE_GROQ_API_KEY` (and optionally `VITE_STT_PROVIDER`/`VITE_STT_LANGUAGE`).
 *
 * Resolution order:
 *   1. Explicit `VITE_STT_PROVIDER=web-speech` → always Web Speech.
 *   2. Explicit `VITE_STT_PROVIDER=groq` and key present → Groq.
 *   3. No explicit choice but `VITE_GROQ_API_KEY` present → Groq.
 *   4. Otherwise → Web Speech (or unsupported, depending on the browser).
 *
 * Keep the runtime decision pure so tests don't depend on `import.meta.env`.
 */

export type SttProviderKind = 'web-speech' | 'groq';

export interface SttResolution {
  provider: SttProviderKind;
  /** Present only when provider === 'groq'. */
  groqApiKey?: string;
  /** BCP-47 hint passed to Whisper; auto-detect when omitted. */
  language?: string;
  /** Reason the resolver picked this provider. Surfaced in dev logs. */
  reason: string;
}

export interface SttEnv {
  VITE_STT_PROVIDER?: string;
  VITE_GROQ_API_KEY?: string;
  VITE_STT_LANGUAGE?: string;
}

export function resolveSttConfig(env: SttEnv): SttResolution {
  const explicit = (env.VITE_STT_PROVIDER ?? '').trim().toLowerCase();
  const groqKey = (env.VITE_GROQ_API_KEY ?? '').trim();
  const language = (env.VITE_STT_LANGUAGE ?? '').trim() || undefined;

  if (explicit === 'web-speech') {
    return { provider: 'web-speech', reason: 'VITE_STT_PROVIDER=web-speech (forced)' };
  }
  if (explicit === 'groq') {
    if (groqKey) {
      const result: SttResolution = {
        provider: 'groq',
        groqApiKey: groqKey,
        reason: 'VITE_STT_PROVIDER=groq with key',
      };
      if (language) result.language = language;
      return result;
    }
    return {
      provider: 'web-speech',
      reason: 'VITE_STT_PROVIDER=groq requested but VITE_GROQ_API_KEY missing — falling back',
    };
  }
  if (groqKey) {
    const result: SttResolution = {
      provider: 'groq',
      groqApiKey: groqKey,
      reason: 'auto-selected Groq Whisper (VITE_GROQ_API_KEY present)',
    };
    if (language) result.language = language;
    return result;
  }
  return { provider: 'web-speech', reason: 'no Groq key — using Web Speech API fallback' };
}

/**
 * Read env from `import.meta.env`. Lives behind a function so tests can pass
 * a fake env in without depending on Vite at all.
 */
export function resolveSttConfigFromImportMeta(): SttResolution {
  const env: SttEnv = {};
  // biome-ignore lint/suspicious/noExplicitAny: vite injects this dynamically.
  const meta = (import.meta as any).env as Record<string, string | undefined> | undefined;
  if (meta) {
    if (typeof meta.VITE_STT_PROVIDER === 'string') env.VITE_STT_PROVIDER = meta.VITE_STT_PROVIDER;
    if (typeof meta.VITE_GROQ_API_KEY === 'string') env.VITE_GROQ_API_KEY = meta.VITE_GROQ_API_KEY;
    if (typeof meta.VITE_STT_LANGUAGE === 'string') env.VITE_STT_LANGUAGE = meta.VITE_STT_LANGUAGE;
  }
  return resolveSttConfig(env);
}
