import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAVIGATION,
  DEFAULT_TRANSFORM,
  resolveGroundFit,
  resolveNavigation,
  resolveTransform,
  splatRegistry,
} from './registry.js';

describe('splat registry conventions (ADR 0007)', () => {
  it('defaults to identity rotation — cakewalk antimatter15 splats render Y-up as-is', () => {
    expect(DEFAULT_TRANSFORM.rotation).toEqual([0, 0, 0]);
  });

  it('defaults ground plane to Y=0 (clean metric)', () => {
    expect(DEFAULT_NAVIGATION.groundY).toBe(0);
  });

  it('every cakewalk asset opts into identity rotation (no Y-flip)', () => {
    for (const asset of splatRegistry) {
      const t = resolveTransform(asset);
      expect(t.rotation, `asset ${asset.id} unexpectedly applies a rotation`).toEqual([0, 0, 0]);
    }
  });

  it('every asset places its ground at Y=0', () => {
    for (const asset of splatRegistry) {
      const n = resolveNavigation(asset);
      expect(n.groundY, `asset ${asset.id} should keep groundY at 0`).toBe(0);
    }
  });

  it('every asset opts into auto ground-fit so we do not eyeball Y per scene', () => {
    for (const asset of splatRegistry) {
      const fit = resolveGroundFit(asset);
      expect(fit, `asset ${asset.id} should enable groundFit`).not.toBeNull();
      expect(fit?.percentile).toBeGreaterThanOrEqual(0);
      expect(fit?.percentile).toBeLessThan(50);
    }
  });

  it('auto-fit owns Y; transform.position.y stays at 0 so it cannot conflict', () => {
    for (const asset of splatRegistry) {
      const t = resolveTransform(asset);
      expect(t.position[1], `asset ${asset.id} should not pre-bake a Y offset`).toBe(0);
    }
  });
});
