// v1 Visual Style Bible §5.2 motion-curve language.
//
// Mara, Otto, and Pip each own a curve in §5.2 — drift-and-settle for
// spirit hovers, settle-and-hold for Otto's grounded stillness, snap-and-hold
// for Pip's darts, lean for listening, bounce-on-accent for speech beats.
// Reviewers reject any character motion that fails the bible's `// no linear
// lerp` rule (§3.5 "Forbidden", §5.2 last line, §7.1#5 acceptance line).
// Every curve here is the named runtime token a brief or PR comment can cite.
//
// Carve-out: animation cross-fades between two *already-shaped* clips
// (e.g. `Character.tsx` `playAnimation` fadeIn/fadeOut) are the *blend* layer,
// not the motion shape. Cross-fades may stay linear because the underlying
// clips are pre-shaped per §5.2. See `src/character/Character.tsx`.

import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useRef } from 'react';
import { NumberKeyframeTrack } from 'three';

const TAU = Math.PI * 2;

function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

// Sinusoidal smoothstep: monotone 0→1, zero derivative at both ends.
// Building block for the slower curves; matches what reviewers think of
// when they say "ease-in-out".
function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/**
 * **drift-and-settle** — slow ease-in-out with a small low-frequency bob
 * superimposed. Used for Mara's idle hover and any spirit-class drift
 * (§3.1, §3.5, §5.2). Output stays monotone; the bob modulates the rate
 * along the way without ever reversing it.
 *
 * Periodic loops (e.g. continuous idle bob) drive `t` with a triangle phase
 * so the seam at `curve(0) === curve(0)` is preserved — see
 * `src/npc/movement.ts:idleBob` for the canonical use.
 */
export function driftAndSettle(t: number): number {
  const c = clamp01(t);
  const main = easeInOutSine(c);
  // Low-frequency bob: vanishes at both endpoints (sin(πt) envelope) so the
  // curve seam is exactly 0 → 1. Amplitude kept small enough that the
  // monotonicity assertion in the unit test holds for any sample density.
  const bobEnvelope = Math.sin(Math.PI * c);
  const bob = 0.03 * bobEnvelope * Math.sin(3 * TAU * c);
  return main + bob;
}

/**
 * **settle-and-hold** — slow ease-in to a *full stop* (§5.2). Otto's signature.
 * The whole motion is gradual; the end is at rest, no coasting. Implemented
 * as `sin²(πt/2)` which is monotone, starts with zero derivative, and ends
 * with zero derivative — the "full stop" the bible asks for.
 */
export function settleAndHold(t: number): number {
  const c = clamp01(t);
  const s = Math.sin((Math.PI * c) / 2);
  return s * s;
}

/**
 * **snap-and-hold** — hard ease-out, ~80 ms target, full stop (§5.2).
 * Pip's dart vocabulary. Most of the change happens in the first ~10 % of
 * the beat; the rest is hold. Implemented as `1 - (1 - t)^p` with a high
 * power so the curve is at ≈0.99 well before t = 0.5.
 *
 * Bible cap: easing curves longer than 1.2 s are forbidden (§5.2). For the
 * 80 ms snap intent, drive this curve with `durationSeconds ≈ 0.08`.
 */
export function snapAndHold(t: number): number {
  const c = clamp01(t);
  // Power 6 puts ≈75 % of the change in the first 20 % of t and ≈99 % by
  // t = 0.55, which reads as "snap" at any duration ≤ ~120 ms.
  const oneMinus = 1 - c;
  return 1 - oneMinus * oneMinus * oneMinus * oneMinus * oneMinus * oneMinus;
}

/**
 * **lean** — small ease-in toward subject, hold, ease-out (§5.2). Listening
 * vocabulary, all characters. Not a 0→1 progress curve — it is the *lean
 * angle envelope*, going 0 → peak → hold → 0 across the beat. Pair with
 * `useCurvedTransition` driving rotation toward the subject; the subject
 * yaw is the multiplier, this curve shapes the magnitude over time.
 */
export function lean(t: number): number {
  const c = clamp01(t);
  // Three phases: ease-in to peak (0..0.3), hold at peak (0.3..0.7), ease-out
  // (0.7..1). easeInOutSine on the rising half-window keeps the in/out shape
  // matched, and the plateau in the middle is the "hold" the bible names.
  if (c < 0.3) {
    return easeInOutSine(c / 0.3);
  }
  if (c < 0.7) {
    return 1;
  }
  return easeInOutSine((1 - c) / 0.3);
}

/**
 * **bounce-on-accent** — small spring overshoot, dampen (§5.2). Speech-beat
 * vocabulary. Reaches the target, briefly overshoots by a small amount,
 * then dampens back to target. Implemented as a critically-undamped sine
 * envelope so callers can predict the overshoot (~10 %) at design time.
 */
export function bounceOnAccent(t: number): number {
  const c = clamp01(t);
  // Damped sine ringing around 1: y(t) = 1 - e^(-kt) * cos(ω t).
  // Tuned for one visible overshoot (~10 %) and silence by t = 1.
  const k = 6; // damping rate
  const omega = 2.5 * Math.PI; // ringing frequency
  return 1 - Math.exp(-k * c) * Math.cos(omega * c);
}

/** All five §5.2 curves keyed by their bible name. Useful for art briefs and
 *  dev-tools introspection. */
export const motionCurves = {
  driftAndSettle,
  settleAndHold,
  snapAndHold,
  lean,
  bounceOnAccent,
} as const;

export type MotionCurveName = keyof typeof motionCurves;
export type MotionCurve = (t: number) => number;

/**
 * Sample a §5.2 curve into a Three.js `NumberKeyframeTrack`. The mixer's
 * default linear interpolation is what *forces* this bake — sampling the
 * shaped curve at enough keyframes lets a downstream linear blend reproduce
 * the curve to within `tolerance` (the test target is 1e-3 with 32 samples
 * for the smoothest of the family).
 *
 * @param trackName  KeyframeTrack property path. Typical values:
 *                   `.position[y]`, `.scale[x]`, `.morphTargetInfluences[0]`.
 * @param sampleCount Must be ≥ 2. Endpoints are always sampled.
 */
export function bakeCurveToTrack(
  curve: MotionCurve,
  duration: number,
  sampleCount: number,
  trackName = '.position[y]',
): NumberKeyframeTrack {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError(`bakeCurveToTrack: duration must be > 0, got ${duration}`);
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new RangeError(
      `bakeCurveToTrack: sampleCount must be an integer ≥ 2, got ${sampleCount}`,
    );
  }
  const times = new Float32Array(sampleCount);
  const values = new Float32Array(sampleCount);
  const last = sampleCount - 1;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / last;
    times[i] = t * duration;
    values[i] = curve(t);
  }
  return new NumberKeyframeTrack(trackName, times, values);
}

export interface CurvedTransitionOptions {
  /** Beat duration in seconds. Bible §5.2 caps a single beat at 1.2 s. */
  readonly durationSeconds: number;
  /** Optional callback fired exactly once per tween, when t reaches 1. */
  readonly onComplete?: () => void;
}

export interface CurvedTransitionHandle {
  /** Latest interpolated value. Stable ref — read in `useFrame`. */
  readonly value: MutableRefObject<number>;
  /** Whether a tween is currently in flight. */
  readonly active: MutableRefObject<boolean>;
}

/**
 * Per-frame R3F tween for primitives whose motion can't go through the
 * `AnimationMixer` (e.g. NPC dart in `src/npc/movement.ts`, runtime
 * position/rotation snaps). Re-fires whenever `target` changes — the tween
 * starts from the current `value` and eases to `target` under `curve` over
 * `options.durationSeconds`.
 *
 * Returns refs (not state) so the hook can drive Three objects per frame
 * without forcing a React re-render.
 */
export function useCurvedTransition(
  curve: MotionCurve,
  target: number,
  options: CurvedTransitionOptions,
): CurvedTransitionHandle {
  const value = useRef(target);
  const active = useRef(false);
  const tween = useRef<{ from: number; to: number; duration: number; elapsed: number } | null>(
    null,
  );
  const lastTarget = useRef(target);

  // Detect target change synchronously during render so the next useFrame
  // already reads the new tween. Mutating refs in render bodies is safe in
  // React 18 because they don't participate in commit.
  if (target !== lastTarget.current) {
    tween.current = {
      from: value.current,
      to: target,
      duration: Math.max(1e-6, options.durationSeconds),
      elapsed: 0,
    };
    active.current = true;
    lastTarget.current = target;
  }

  useFrame((_, delta) => {
    const t = tween.current;
    if (!t) return;
    t.elapsed += delta;
    const progress = clamp01(t.elapsed / t.duration);
    const eased = curve(progress);
    value.current = t.from + (t.to - t.from) * eased;
    if (progress >= 1) {
      tween.current = null;
      active.current = false;
      options.onComplete?.();
    }
  });

  return { value, active };
}
