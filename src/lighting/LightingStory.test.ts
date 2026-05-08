import { describe, expect, it } from 'vitest';
import {
  CLEARING,
  GALLERY,
  HOLLOW,
  LIGHTING_STORIES,
  ROOM,
  getLightingStory,
} from './LightingStory.js';

describe('LightingStory — Visual Style Bible §5.3', () => {
  it('every committed archetype has a story keyed by archetype name', () => {
    for (const archetype of ['hollow', 'room', 'clearing', 'gallery'] as const) {
      const story = getLightingStory(archetype);
      expect(story.archetype).toBe(archetype);
      expect(LIGHTING_STORIES[archetype]).toBe(story);
    }
  });

  it('character rim values are small enough not to relight the splat (≤ ~5 m, intensity ≤ 1.5)', () => {
    for (const story of [HOLLOW, ROOM, CLEARING, GALLERY]) {
      expect(story.characterRim.distance).toBeLessThanOrEqual(5);
      expect(story.characterRim.intensity).toBeLessThanOrEqual(1.5);
      expect(story.characterRim.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('committed archetypes (Hollow / Room / Clearing) bias the rim toward the scene dominant', () => {
    // Hollow + Room are warm-dominant — rim should be warm (palette/amber-*).
    expect(['#FFE9B0', '#F4D58A']).toContain(HOLLOW.characterRim.color);
    expect(['#FFE9B0', '#F4D58A']).toContain(ROOM.characterRim.color);
    // Clearing is cool-dominant — rim should be cool (palette/sky-bright).
    expect(CLEARING.characterRim.color).toBe('#E6F2FB');
  });
});
