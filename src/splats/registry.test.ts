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

  it('every asset places its ground at Y=0', () => {
    for (const asset of splatRegistry) {
      const n = resolveNavigation(asset);
      expect(n.groundY, `asset ${asset.id} should keep groundY at 0`).toBe(0);
    }
  });

  it('every asset is either auto-fit or hand-tuned (never both, never neither)', () => {
    for (const asset of splatRegistry) {
      const fit = resolveGroundFit(asset);
      const t = resolveTransform(asset);
      const hasTunedTransform =
        t.position[0] !== 0 ||
        t.position[1] !== 0 ||
        t.position[2] !== 0 ||
        t.rotation[0] !== 0 ||
        t.rotation[1] !== 0 ||
        t.rotation[2] !== 0;

      if (fit !== null) {
        // Auto-fit assets must keep transform.position[1] at 0 so the fit
        // can't conflict, AND must keep identity rotation (cakewalk format
        // renders Y-up after drei's Y-flip; any rotation applied here is a
        // signal of hand-tuning).
        expect(t.position[1], `auto-fit asset ${asset.id} pre-bakes a Y offset`).toBe(0);
        expect(t.rotation, `auto-fit asset ${asset.id} should keep identity rotation`).toEqual([
          0, 0, 0,
        ]);
        expect(fit.percentile).toBeGreaterThanOrEqual(0);
        expect(fit.percentile).toBeLessThan(50);
      } else {
        // Hand-tuned: transform must be non-trivial. If it were identity,
        // the asset would render at the file's raw origin with no fit —
        // almost certainly wrong.
        expect(
          hasTunedTransform,
          `asset ${asset.id} has neither groundFit nor a hand-tuned transform`,
        ).toBe(true);
      }
    }
  });
});
