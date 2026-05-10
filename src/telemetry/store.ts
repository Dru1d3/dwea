/**
 * Append-only durable buffer for [TelemetryRecord](./types.ts).
 *
 * Why "append-only" matters for σ_log: the consumer needs every session,
 * including the cold-start tail. We never overwrite, never truncate, never
 * sample. The buffer fills indefinitely; the operator (or in-app export
 * button) drains it to CSV.
 *
 * The store is split into a backend interface + a thin facade so node tests
 * use [createMemoryBackend](./store.ts) and the browser uses
 * [createBrowserBackend](./store.ts) (localStorage today, IndexedDB tomorrow
 * if we hit quota — a 1 KB record × 200 sessions is ~200 KB, well under
 * localStorage's 5 MB on every shipping browser).
 */
import type { TelemetryRecord } from './types.js';

export interface TelemetryBackend {
  append(record: TelemetryRecord): Promise<void>;
  list(): Promise<TelemetryRecord[]>;
  clear(): Promise<void>;
}

export interface TelemetryStore extends TelemetryBackend {
  /** Synchronous view of the most recent N records — for in-page debug HUDs. */
  recentSync(): readonly TelemetryRecord[];
}

/**
 * In-memory backend. Used in tests and as the fallback when no browser
 * storage is available.
 */
export function createMemoryBackend(initial: readonly TelemetryRecord[] = []): TelemetryBackend {
  const records: TelemetryRecord[] = [...initial];
  return {
    async append(record) {
      records.push(record);
    },
    async list() {
      return [...records];
    },
    async clear() {
      records.length = 0;
    },
  };
}

const KEY_BUFFER = 'dwea.telemetry.buffer.v1';

/**
 * Browser backend: stores the full array under one localStorage key, JSON
 * encoded. The whole-array rewrite per append is fine at our scale (a few
 * hundred records). On quota error we degrade to in-memory for the rest of
 * the page session — better than the page crashing.
 */
export function createBrowserBackend(): TelemetryBackend {
  const lsResolved: Storage | null = (() => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  if (!lsResolved) return createMemoryBackend();
  const ls = lsResolved;

  let mirror: TelemetryRecord[] | null = null;
  let degradedToMemory = false;
  const memoryFallback = createMemoryBackend();

  function readAll(): TelemetryRecord[] {
    if (mirror) return mirror;
    const raw = (() => {
      try {
        return ls.getItem(KEY_BUFFER);
      } catch {
        return null;
      }
    })();
    if (!raw) {
      mirror = [];
      return mirror;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        mirror = parsed.filter(isTelemetryRecord);
        return mirror;
      }
    } catch {
      // corrupt — start fresh
    }
    mirror = [];
    return mirror;
  }

  function writeAll(records: TelemetryRecord[]): boolean {
    try {
      ls.setItem(KEY_BUFFER, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }

  return {
    async append(record) {
      if (degradedToMemory) {
        await memoryFallback.append(record);
        return;
      }
      const existing = readAll();
      existing.push(record);
      if (!writeAll(existing)) {
        degradedToMemory = true;
        for (const r of existing) {
          await memoryFallback.append(r);
        }
        await memoryFallback.append(record);
      }
    },
    async list() {
      if (degradedToMemory) return memoryFallback.list();
      return [...readAll()];
    },
    async clear() {
      mirror = [];
      try {
        ls.removeItem(KEY_BUFFER);
      } catch {
        // ignore
      }
      if (degradedToMemory) await memoryFallback.clear();
    },
  };
}

function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.turnId === 'string' &&
    typeof r.ts === 'string' &&
    typeof r.ttfa_ms === 'number' &&
    typeof r.ttf_face_ms === 'number'
  );
}

/**
 * Wrap a backend with a synchronous mirror of the last N records, so the
 * Settings dialog can display "n sessions buffered" and "export" without
 * awaiting an IndexedDB read.
 */
export function withRecentMirror(
  backend: TelemetryBackend,
  capacity = 50,
): TelemetryStore & { _mirror: TelemetryRecord[] } {
  const mirror: TelemetryRecord[] = [];
  // Hydrate the mirror lazily — caller can `await store.list()` to fully
  // populate, but recentSync() never blocks even before hydration.
  return {
    _mirror: mirror,
    async append(record) {
      await backend.append(record);
      mirror.push(record);
      if (mirror.length > capacity) mirror.shift();
    },
    async list() {
      const all = await backend.list();
      // Refresh mirror from authoritative store for steady-state correctness.
      mirror.length = 0;
      const start = Math.max(0, all.length - capacity);
      for (let i = start; i < all.length; i++) {
        const next = all[i];
        if (next !== undefined) mirror.push(next);
      }
      return all;
    },
    async clear() {
      await backend.clear();
      mirror.length = 0;
    },
    recentSync() {
      return mirror;
    },
  };
}
