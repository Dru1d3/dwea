import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionContext, deviceTier, resetSessionForTests } from './session.js';

const fakeStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k) {
      return store.has(k) ? (store.get(k) ?? null) : null;
    },
    setItem(k, v) {
      store.set(k, v);
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
};

describe('createSessionContext', () => {
  let originalSession: Storage | undefined;
  beforeEach(() => {
    const g = globalThis as unknown as { sessionStorage?: Storage };
    originalSession = g.sessionStorage;
    g.sessionStorage = fakeStorage();
    resetSessionForTests();
  });
  afterEach(() => {
    const g = globalThis as unknown as { sessionStorage?: Storage | undefined };
    if (originalSession) g.sessionStorage = originalSession;
    else g.sessionStorage = undefined;
  });

  it('mints a uuid-shaped session id', () => {
    const ctx = createSessionContext();
    expect(ctx.sessionId).toMatch(/^[0-9a-f-]{20,}$/);
    expect(ctx.isCold).toBe(true);
  });

  it('returns the same id on a second call within one tab', () => {
    const a = createSessionContext();
    const b = createSessionContext();
    expect(a.sessionId).toBe(b.sessionId);
  });

  it('mints a new id after resetSessionForTests', () => {
    const a = createSessionContext();
    resetSessionForTests();
    const b = createSessionContext();
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe('deviceTier', () => {
  it('returns unknown when navigator is null', () => {
    expect(deviceTier(null)).toBe('unknown');
  });

  it('returns high for an 8-core, 8 GB desktop', () => {
    const nav = { hardwareConcurrency: 8, deviceMemory: 8 } as unknown as Navigator;
    expect(deviceTier(nav)).toBe('high');
  });

  it('returns low for a 2-core 2 GB device', () => {
    const nav = { hardwareConcurrency: 2, deviceMemory: 2 } as unknown as Navigator;
    expect(deviceTier(nav)).toBe('low');
  });

  it('returns mid for a mid-range desktop', () => {
    const nav = { hardwareConcurrency: 4, deviceMemory: 4 } as unknown as Navigator;
    expect(deviceTier(nav)).toBe('mid');
  });
});
