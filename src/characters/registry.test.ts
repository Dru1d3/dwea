import { describe, expect, it } from 'vitest';
import {
  characterRegistry,
  defaultCharacterId,
  findCharacter,
  findClip,
  resolveCharacterUrl,
} from './registry.js';

describe('character registry', () => {
  it('exposes monkey-tomk as the default character (DWEA-24 / DWEA-22)', () => {
    expect(defaultCharacterId).toBe('monkey-tomk');
    expect(findCharacter(defaultCharacterId)).toBeDefined();
  });

  it('keeps the robot stub registered so it remains available as a fallback', () => {
    expect(findCharacter('robot-expressive')).toBeDefined();
  });

  it('uses unique character ids', () => {
    const ids = characterRegistry.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every character at a clip that is actually in its clip list', () => {
    for (const character of characterRegistry) {
      expect(findClip(character, character.defaultClipId)).toBeDefined();
    }
  });

  describe('monkey-tomk entry', () => {
    const monkey = findCharacter('monkey-tomk');
    if (!monkey) throw new Error('monkey-tomk must be registered for this suite');

    it('is resolvable', () => {
      expect(monkey).toBeDefined();
    });

    it('points at the public-served GLB under public/characters/', () => {
      expect(monkey.source).toEqual({
        kind: 'public',
        path: 'characters/monkey-tomk.glb',
      });
      // Both common base URLs (Vercel root '/' and GitHub Pages '/dwea/')
      // must resolve to the same `characters/...` suffix.
      expect(resolveCharacterUrl(monkey, '/')).toBe('/characters/monkey-tomk.glb');
      expect(resolveCharacterUrl(monkey, '/dwea/')).toBe('/dwea/characters/monkey-tomk.glb');
    });

    it('credits tomk and OpenGameArt under CC0', () => {
      expect(monkey.credit).toContain('tomk');
      expect(monkey.credit).toContain('CC0');
      expect(monkey.credit).toContain('OpenGameArt');
    });

    it('ships the Dance clip and classifies it as a oneshot that loops', () => {
      // T6 (DWEA-24) ships only one clip in this v1 bake; the FBX exported a
      // single anonymous "Take 001" track which we relabeled to Dance to
      // satisfy the play_animation('dance') contract from DWEA-18. If a
      // future bake adds locomotion/gesture clips this assertion needs the
      // matching counts, not just a "≥ 1" check, so the test catches a
      // regression where the rename or the embed step drops the clip.
      expect(monkey.clips).toHaveLength(1);
      const dance = findClip(monkey, 'Dance');
      expect(dance).toBeDefined();
      expect(dance?.kind).toBe('oneshot');
      expect(dance?.loop).toBe(true);
      // The default play target is the same Dance clip — there is nothing
      // else to fall back to in v1.
      expect(monkey.defaultClipId).toBe('Dance');
    });
  });
});
