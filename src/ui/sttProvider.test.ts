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

  describe('user settings overlay (DWEA-36)', () => {
    it('user engine=web-speech wins over env Groq key', () => {
      const cfg = resolveSttConfig({ VITE_GROQ_API_KEY: 'gsk-env' }, { engine: 'web-speech' });
      expect(cfg.provider).toBe('web-speech');
      expect(cfg.reason).toContain('user setting');
    });

    it('user engine=groq with env key resolves to Groq using the env key', () => {
      const cfg = resolveSttConfig({ VITE_GROQ_API_KEY: 'gsk-env' }, { engine: 'groq' });
      expect(cfg.provider).toBe('groq');
      expect(cfg.groqApiKey).toBe('gsk-env');
      expect(cfg.reason).toMatch(/env key/);
    });

    it('user engine=groq with user-supplied key prefers the user key over env', () => {
      const cfg = resolveSttConfig(
        { VITE_GROQ_API_KEY: 'gsk-env' },
        { engine: 'groq', groqApiKey: 'gsk-user' },
      );
      expect(cfg.provider).toBe('groq');
      expect(cfg.groqApiKey).toBe('gsk-user');
      expect(cfg.reason).toMatch(/user-supplied/);
    });

    it('user engine=groq with no key anywhere falls back to web-speech', () => {
      const cfg = resolveSttConfig({}, { engine: 'groq' });
      expect(cfg.provider).toBe('web-speech');
      expect(cfg.reason).toMatch(/falling back/);
    });

    it('user engine null defers to env resolution', () => {
      const cfg = resolveSttConfig({ VITE_GROQ_API_KEY: 'gsk-env' }, { engine: null });
      expect(cfg.provider).toBe('groq');
      expect(cfg.reason).toMatch(/VITE_GROQ_API_KEY/);
    });

    it('user-supplied Groq key auto-selects Groq with no env key', () => {
      const cfg = resolveSttConfig({}, { groqApiKey: 'gsk-user' });
      expect(cfg.provider).toBe('groq');
      expect(cfg.groqApiKey).toBe('gsk-user');
      expect(cfg.reason).toMatch(/user-supplied/);
    });

    it('forwards env language hint even when user picked Groq', () => {
      const cfg = resolveSttConfig(
        { VITE_GROQ_API_KEY: 'gsk-env', VITE_STT_LANGUAGE: 'de' },
        { engine: 'groq' },
      );
      expect(cfg.provider).toBe('groq');
      expect(cfg.language).toBe('de');
    });
  });
});
