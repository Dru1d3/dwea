/**
 * IndexedDB-backed `MemoryBackend` for the browser. Survives tab close and
 * navigation away — the v1.3 cross-session-recall criterion explicitly tests
 * this. Falls back to a lazy in-memory map when IndexedDB is unavailable
 * (private mode on some browsers, SSR), so callers don't have to branch.
 *
 * Schema:
 *   - DB name: `dwea-memory`
 *   - Version: 1
 *   - Object store: `entries` (keyPath: 'path')
 *   - Record shape: `{ path: string; value: string; updatedAt: number }`
 *
 * Single object store, keyed by full identity-scoped path. We don't add
 * indexes because every read is point-keyed; `list(prefix)` does a cursor
 * scan, which is fine for the small (<1k entries per user) volumes v1
 * targets.
 */

import type { MemoryBackend } from './types.js';

const DB_NAME = 'dwea-memory';
const DB_VERSION = 1;
const STORE = 'entries';

interface MemoryRecord {
  path: string;
  value: string;
  updatedAt: number;
}

interface IDBPromiseLike<T> {
  result: T;
}

function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB: open failed'));
  });
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBPromiseLike<T> | IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store) as IDBRequest<T>;
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB: tx failed'));
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB: tx failed'));
  });
}

function listWithCursor(db: IDBDatabase, prefix: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const out: string[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out.sort());
        return;
      }
      const path = (cursor.value as MemoryRecord).path;
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        out.push(path);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB: cursor failed'));
  });
}

/**
 * Build an IndexedDB-backed backend. The DB connection is lazy — we only pay
 * the open cost on the first read/write, not at module load. When IndexedDB
 * is missing entirely we silently return an in-memory map (so SSR / Vitest
 * dom-less envs don't crash; tests that care use `createInMemoryBackend`
 * directly).
 */
export function createBrowserBackend(): MemoryBackend {
  if (!hasIndexedDb()) {
    // Lazy import to avoid pulling the in-memory shim into bundles that
    // never need it. Top-level import would inflate the production bundle.
    const data = new Map<string, string>();
    return {
      async read(p) {
        return data.get(p) ?? null;
      },
      async write(p, v) {
        data.set(p, v);
      },
      async delete(p) {
        return data.delete(p);
      },
      async list(prefix) {
        const out: string[] = [];
        for (const k of data.keys()) {
          if (k === prefix || k.startsWith(`${prefix}/`)) out.push(k);
        }
        return out.sort();
      },
      async rename(oldP, newP) {
        const v = data.get(oldP);
        if (v === undefined) throw new Error(`memory: rename: source missing (${oldP})`);
        data.set(newP, v);
        data.delete(oldP);
      },
    };
  }

  let dbPromise: Promise<IDBDatabase> | null = null;
  function db(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDb();
    return dbPromise;
  }

  return {
    async read(path: string): Promise<string | null> {
      const conn = await db();
      const rec = await withStore<MemoryRecord | undefined>(
        conn,
        'readonly',
        (s) => s.get(path) as IDBRequest<MemoryRecord | undefined>,
      );
      return rec ? rec.value : null;
    },
    async write(path: string, value: string): Promise<void> {
      const conn = await db();
      const record: MemoryRecord = { path, value, updatedAt: Date.now() };
      await withStore<unknown>(conn, 'readwrite', (s) => s.put(record));
    },
    async delete(path: string): Promise<boolean> {
      const conn = await db();
      const existed = await withStore<MemoryRecord | undefined>(
        conn,
        'readonly',
        (s) => s.get(path) as IDBRequest<MemoryRecord | undefined>,
      );
      if (!existed) return false;
      await withStore<unknown>(conn, 'readwrite', (s) => s.delete(path));
      return true;
    },
    async list(prefix: string): Promise<readonly string[]> {
      const conn = await db();
      return listWithCursor(conn, prefix);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      const conn = await db();
      const existing = await withStore<MemoryRecord | undefined>(
        conn,
        'readonly',
        (s) => s.get(oldPath) as IDBRequest<MemoryRecord | undefined>,
      );
      if (!existing) throw new Error(`memory: rename: source missing (${oldPath})`);
      const next: MemoryRecord = { path: newPath, value: existing.value, updatedAt: Date.now() };
      await withStore<unknown>(conn, 'readwrite', (s) => {
        s.put(next);
        return s.delete(oldPath);
      });
    },
  };
}
