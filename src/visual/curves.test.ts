import { describe, expect, it } from 'vitest';
import {
  type MotionCurve,
  bakeCurveToTrack,
  bounceOnAccent,
  driftAndSettle,
  lean,
  motionCurves,
  settleAndHold,
  snapAndHold,
} from './curves.js';

// Per the bible §5.2 the curves are the named tokens reviewers cite when
// rejecting linear-lerp motion. Keeping their endpoint and shape behaviour
// pinned in tests is what makes those reviews enforceable in code.

describe('§5.2 motion curves — endpoints', () => {
  it('all curves anchor at 0 at t=0', () => {
    expect(driftAndSettle(0)).toBe(0);
    expect(settleAndHold(0)).toBe(0);
    expect(snapAndHold(0)).toBe(0);
    expect(lean(0)).toBe(0);
    expect(bounceOnAccent(0)).toBe(0);
  });

  it('progress curves resolve to 1 at t=1 (full stop, no coast)', () => {
    expect(driftAndSettle(1)).toBeCloseTo(1, 9);
    expect(settleAndHold(1)).toBeCloseTo(1, 9);
    expect(snapAndHold(1)).toBeCloseTo(1, 9);
    expect(bounceOnAccent(1)).toBeCloseTo(1, 5);
  });

  it('lean returns to 0 at t=1 (envelope, not progress)', () => {
    // lean is the *magnitude* envelope of a lean-and-return beat — peaks
    // mid-beat and returns to rest, so curve(0) === curve(1) === 0.
    expect(lean(1)).toBeCloseTo(0, 9);
  });

  it('curves hit their expected mid-beat values at t=0.5', () => {
    // driftAndSettle: ease-in-out + bob. Bob envelope vanishes at 0.5 (sin(3π) = 0)
    // so the midpoint is the pure ease-in-out midpoint, exactly 0.5.
    expect(driftAndSettle(0.5)).toBeCloseTo(0.5, 9);
    // settleAndHold = sin²(πt/2). At 0.5 → sin²(π/4) = 0.5.
    expect(settleAndHold(0.5)).toBeCloseTo(0.5, 9);
    // snapAndHold is past 0.98 by the half-beat (it's a hard ease-out).
    expect(snapAndHold(0.5)).toBeGreaterThan(0.98);
    // lean's plateau covers t ∈ [0.3, 0.7]; 0.5 sits at full lean.
    expect(lean(0.5)).toBe(1);
    // bounceOnAccent overshoots ~10 % around the half-beat.
    const bounceMid = bounceOnAccent(0.5);
    expect(bounceMid).toBeGreaterThan(1);
    expect(bounceMid).toBeLessThan(1.2);
  });
});

describe('§5.2 motion curves — monotonicity', () => {
  // The three "progress" curves (driftAndSettle, settleAndHold, snapAndHold)
  // are monotone non-decreasing on [0, 1]. driftAndSettle has a low-frequency
  // bob superimposed; the bob is sized so the overall function stays
  // monotone (verified analytically — bob amplitude × max bob slope is
  // smaller than the main ease-in-out slope at every t).
  const monotone: ReadonlyArray<readonly [string, MotionCurve]> = [
    ['driftAndSettle', driftAndSettle],
    ['settleAndHold', settleAndHold],
    ['snapAndHold', snapAndHold],
  ];

  for (const [name, curve] of monotone) {
    it(`${name} is monotone non-decreasing across 1024 samples`, () => {
      const samples = 1024;
      let prev = curve(0);
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const v = curve(t);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    });
  }

  it('bounceOnAccent overshoots above 1 then settles back below 1.05', () => {
    // Not strictly monotone — but the overshoot must be present (≤1.2)
    // and the tail must dampen back near 1 by t=1.
    const samples = 256;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= samples; i++) {
      max = Math.max(max, bounceOnAccent(i / samples));
    }
    expect(max).toBeGreaterThan(1.0);
    expect(max).toBeLessThan(1.2);
    expect(Math.abs(bounceOnAccent(1) - 1)).toBeLessThan(0.01);
  });
});

describe('motionCurves registry', () => {
  it('exposes all five §5.2 names', () => {
    expect(Object.keys(motionCurves).sort()).toEqual([
      'bounceOnAccent',
      'driftAndSettle',
      'lean',
      'settleAndHold',
      'snapAndHold',
    ]);
  });
});

describe('bakeCurveToTrack', () => {
  it('produces a NumberKeyframeTrack whose values reproduce the curve', () => {
    const sampleCount = 32;
    const duration = 0.5;
    const track = bakeCurveToTrack(driftAndSettle, duration, sampleCount, '.position[y]');
    expect(track.times).toHaveLength(sampleCount);
    expect(track.values).toHaveLength(sampleCount);
    // Endpoint times line up with [0, duration].
    expect(track.times[0]).toBe(0);
    expect(track.times[sampleCount - 1]).toBeCloseTo(duration, 5);
    // Each sample matches curve(t) within a tight tolerance.
    for (let i = 0; i < sampleCount; i++) {
      const t = i / (sampleCount - 1);
      const expected = driftAndSettle(t);
      // The track stores Float32Array values, so we tolerate Float32 rounding.
      expect(track.values[i]).toBeCloseTo(expected, 5);
    }
  });

  it('rejects degenerate sample counts and durations', () => {
    expect(() => bakeCurveToTrack(driftAndSettle, 1, 1)).toThrow();
    expect(() => bakeCurveToTrack(driftAndSettle, 1, 1.5)).toThrow();
    expect(() => bakeCurveToTrack(driftAndSettle, 0, 8)).toThrow();
    expect(() => bakeCurveToTrack(driftAndSettle, -0.5, 8)).toThrow();
  });

  it('honours a custom track name (e.g. .scale[x])', () => {
    const track = bakeCurveToTrack(snapAndHold, 0.08, 4, '.scale[x]');
    expect(track.name).toBe('.scale[x]');
  });
});
