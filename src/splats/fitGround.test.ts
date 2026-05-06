import { describe, expect, it } from 'vitest';
import { computeFit } from './fitGround.js';

const ROW_LENGTH = 32;

/** Build a minimal `.splat`-format buffer that only fills the position floats. */
function buildSplatBuffer(
  positions: ReadonlyArray<readonly [number, number, number]>,
): ArrayBuffer {
  const buf = new ArrayBuffer(positions.length * ROW_LENGTH);
  const view = new DataView(buf);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i] as readonly [number, number, number];
    view.setFloat32(i * ROW_LENGTH + 0, p[0], true);
    view.setFloat32(i * ROW_LENGTH + 4, p[1], true);
    view.setFloat32(i * ROW_LENGTH + 8, p[2], true);
    // scale + rgba + quat default to zero — irrelevant for ground fit.
  }
  return buf;
}

describe('computeFit (splat ground auto-alignment)', () => {
  it('places the 1st-percentile of rendered Y at groundY=0 by default', () => {
    // file_y uniform from -2..+2. drei flips → rendered local Y also -2..+2 (negated).
    // 100 samples; 1st percentile of rendered Y = element at floor(0.01*100)=1 → second
    // smallest rendered-Y, which corresponds to second-largest file Y.
    const positions: Array<[number, number, number]> = [];
    for (let i = 0; i < 100; i++) {
      const fileY = -2 + (4 * i) / 99;
      positions.push([0, fileY, 0]);
    }
    const fit = computeFit(buildSplatBuffer(positions));

    // With sorted rendered Y ascending, p1 ≈ -1.96 (next-to-minimum).
    expect(fit.stats.count).toBe(100);
    expect(fit.stats.min).toBeCloseTo(-2, 5);
    expect(fit.stats.max).toBeCloseTo(2, 5);
    // Offset shifts the lower percentile up to groundY=0.
    expect(fit.offsetY).toBeCloseTo(-fit.stats.p1, 5);
    // i.e. world_y_lowerPercentile === offsetY + lowerLocal === 0.
    expect(fit.offsetY + fit.stats.p1).toBeCloseTo(0, 5);
  });

  it('honours custom groundY and percentile', () => {
    // Half the points at file_y = +1 (rendered y = -1, the floor),
    // half at file_y = -1 (rendered y = +1, the ceiling).
    const positions: Array<[number, number, number]> = [];
    for (let i = 0; i < 50; i++) positions.push([0, 1, 0]);
    for (let i = 0; i < 50; i++) positions.push([0, -1, 0]);

    const fit = computeFit(buildSplatBuffer(positions), { groundY: 5, percentile: 25 });
    // 25th percentile of rendered Y is in the lower cluster (-1).
    // offsetY = groundY - scale * lowerLocal = 5 - 1 * (-1) = 6.
    expect(fit.offsetY).toBeCloseTo(6, 5);
  });

  it('honours uniform scale (group scale must cancel out)', () => {
    // Rendered local Y range -1..+1. With scale=2, the rendered cloud spans
    // -2..+2 in world Y after the group transform. Auto-fit should put the
    // bottom of that scaled cloud at groundY=0.
    const positions: Array<[number, number, number]> = [];
    for (let i = 0; i < 100; i++) {
      const fileY = -1 + (2 * i) / 99;
      positions.push([0, fileY, 0]);
    }
    const fit = computeFit(buildSplatBuffer(positions), { percentile: 0, scale: 2 });
    // p0 of rendered Y = -1; offsetY = 0 - 2 * -1 = 2.
    expect(fit.offsetY).toBeCloseTo(2, 5);
  });

  it('returns a noop offset for an empty buffer', () => {
    const fit = computeFit(new ArrayBuffer(0), { groundY: 3 });
    expect(fit.offsetY).toBe(3);
    expect(fit.stats.count).toBe(0);
  });
});
