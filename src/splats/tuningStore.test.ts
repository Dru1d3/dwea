import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type Tuning,
  clearTuning,
  formatAsTransformLiteral,
  loadTuning,
  saveTuning,
} from './tuningStore.js';

const sample: Tuning = {
  position: [0, 1.2, 0],
  rotation: [-0.2, 0, 0.05],
  scale: 1.5,
};

// Minimal in-memory localStorage shim so the store can be exercised under
// vitest's default node environment without pulling in jsdom.
class MemoryStorage {
  private readonly store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(): string | null {
    return null;
  }
  get length(): number {
    return this.store.size;
  }
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
  }
});

afterEach(() => {
  clearTuning('garden');
  clearTuning('treehill');
});

describe('tuningStore', () => {
  it('roundtrips a saved tuning', () => {
    saveTuning('garden', sample);
    expect(loadTuning('garden')).toEqual(sample);
  });

  it('returns null for an unknown asset', () => {
    expect(loadTuning('treehill')).toBeNull();
  });

  it('returns null for a corrupt entry', () => {
    localStorage.setItem('dwea.tuning.v1.garden', '{"not":"a tuning"}');
    expect(loadTuning('garden')).toBeNull();
  });

  it('clearTuning removes the entry', () => {
    saveTuning('garden', sample);
    clearTuning('garden');
    expect(loadTuning('garden')).toBeNull();
  });

  it('formatAsTransformLiteral emits a registry-compatible literal', () => {
    const text = formatAsTransformLiteral(sample);
    expect(text).toContain('scale: 1.5');
    expect(text).toContain('position: [0, 1.2, 0]');
    expect(text).toContain('rotation: [-0.2, 0, 0.05]');
  });
});
