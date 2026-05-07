import { describe, expect, it } from 'vitest';
import { resolveSttConfig } from './sttProvider.js';

describe('resolveSttConfig', () => {
  it('falls back to web-speech when no Groq key', () => {
    const cfg = resolveSttConfig({});
    expect(cfg.provider).toBe('web-speech');
    expect(cfg.groqApiKey).toBeUndefined();
  });

  it('auto-selects Groq when only the key is present', () => {
    const cfg = resolveSttConfig({ VITE_GROQ_API_KEY: 'gsk-abc' });
    expect(cfg.provider).toBe('groq');
    expect(cfg.groqApiKey).toBe('gsk-abc');
  });

  it('respects an explicit web-speech override even with a key set', () => {
    const cfg = resolveSttConfig({
      VITE_STT_PROVIDER: 'web-speech',
      VITE_GROQ_API_KEY: 'gsk-abc',
    });
    expect(cfg.provider).toBe('web-speech');
  });

  it('falls back to web-speech if VITE_STT_PROVIDER=groq but no key', () => {
    const cfg = resolveSttConfig({ VITE_STT_PROVIDER: 'groq' });
    expect(cfg.provider).toBe('web-speech');
    expect(cfg.reason).toContain('falling back');
  });

  it('passes through the language hint when set', () => {
    const cfg = resolveSttConfig({
      VITE_GROQ_API_KEY: 'gsk-abc',
      VITE_STT_LANGUAGE: 'de',
    });
    expect(cfg.provider).toBe('groq');
    expect(cfg.language).toBe('de');
  });
});
