import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadGroqApiKey,
  loadSpeechEngine,
  saveGroqApiKey,
  saveSpeechEngine,
} from './speechEngineStorage.js';

// Minimal in-memory localStorage shim — vitest runs in node by default. Match
// the pattern in splats/tuningStore.test.ts.
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

describe('speechEngineStorage', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('returns null when no engine is saved', () => {
    expect(loadSpeechEngine()).toBeNull();
  });

  it('round-trips a saved engine', () => {
    saveSpeechEngine('groq');
    expect(loadSpeechEngine()).toBe('groq');
    saveSpeechEngine('web-speech');
    expect(loadSpeechEngine()).toBe('web-speech');
  });

  it('treats unknown stored values as null (graceful degrade)', () => {
    globalThis.localStorage.setItem('dwea.stt.engine', 'mystery-engine');
    expect(loadSpeechEngine()).toBeNull();
  });

  it('saveSpeechEngine(null) clears the saved choice', () => {
    saveSpeechEngine('groq');
    saveSpeechEngine(null);
    expect(loadSpeechEngine()).toBeNull();
  });

  it('round-trips a Groq API key', () => {
    saveGroqApiKey('gsk-abc');
    expect(loadGroqApiKey()).toBe('gsk-abc');
  });

  it('saveGroqApiKey trims whitespace and clears empty input', () => {
    saveGroqApiKey('  gsk-trim  ');
    expect(loadGroqApiKey()).toBe('gsk-trim');
    saveGroqApiKey('   ');
    expect(loadGroqApiKey()).toBe('');
  });

  it('tolerates localStorage throwing (e.g. private mode)', () => {
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => saveSpeechEngine('groq')).not.toThrow();
    expect(() => saveGroqApiKey('gsk-abc')).not.toThrow();
    setItem.mockRestore();
  });
});
