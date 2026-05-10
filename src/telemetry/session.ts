/**
 * Page-session bookkeeping for telemetry.
 *
 * One [SessionContext](./session.ts) per mounted [App](../App.tsx) — id is
 * generated when the App component first runs and reused for every turn in
 * that page lifetime. `cold` flips to `warm` after the first turn so DWEA-98
 * can split the cold-start mass from the steady-state.
 */

const KEY_SESSION_ID = 'dwea.telemetry.session-id';

function safeRandomUuid(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      // fall through
    }
  }
  // RFC4122-ish fallback when randomUUID isn't available (older Safari, jsdom).
  const r = Math.random;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const v = (r() * 16) | 0;
    const out = ch === 'x' ? v : (v & 0x3) | 0x8;
    return out.toString(16);
  });
}

/**
 * Coarse device-tier heuristic. We bucket on the conservative side because the
 * σ_log floor cohort cares about the long tail — false-promoting a low-end
 * phone to `mid` would hide the exact cohort the metric exists to expose.
 *
 * Order matters: a 4-core device with 4 GB RAM is `mid`, not `low`, but a
 * coarse-pointer 4-core device (likely tablet/phone) drops back to `low`.
 */
export function deviceTier(
  nav: Navigator | null = inferNavigator(),
): TelemetryRecord['deviceTier'] {
  if (!nav) return 'unknown';
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
  const memNav = nav as Navigator & { deviceMemory?: number };
  const memory = typeof memNav.deviceMemory === 'number' ? memNav.deviceMemory : null;
  const coarse = matchMediaSafe('(pointer: coarse)') === true;

  if (cores === null && memory === null) return 'unknown';
  // Treat "unknown" components as their worst plausible value so we don't
  // promote phones (which underreport) into mid/high tiers.
  const c = cores ?? 4;
  const m = memory ?? 4;
  if (c >= 8 && m >= 8 && !coarse) return 'high';
  if (c >= 4 && m >= 4) return coarse ? 'low' : 'mid';
  return 'low';
}

function inferNavigator(): Navigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

function matchMediaSafe(query: string): boolean | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return null;
  }
}

import type { TelemetryRecord } from './types.js';

export interface SessionContext {
  sessionId: string;
  /** Mutable: flips to `false` after the first turn is emitted. */
  isCold: boolean;
  deviceTier: TelemetryRecord['deviceTier'];
}

/**
 * Build a fresh session context. The session id is persisted in
 * sessionStorage (per-tab) so a Vite hot-reload during dogfood doesn't
 * shatter one user's run into 20 different "sessions".
 */
export function createSessionContext(): SessionContext {
  const sessionId = readOrCreateSessionId();
  return {
    sessionId,
    isCold: true,
    deviceTier: deviceTier(),
  };
}

function readOrCreateSessionId(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem(KEY_SESSION_ID);
    if (existing) return existing;
  } catch {
    // sessionStorage may throw under privacy mode — fall through to fresh id.
  }
  const fresh = safeRandomUuid();
  try {
    globalThis.sessionStorage?.setItem(KEY_SESSION_ID, fresh);
  } catch {
    // Ignore — we still return the fresh id, just not persistent across reload.
  }
  return fresh;
}

/** Test seam — drops the cached session id so the next call generates fresh. */
export function resetSessionForTests(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY_SESSION_ID);
  } catch {
    // ignore
  }
}

export { safeRandomUuid };
