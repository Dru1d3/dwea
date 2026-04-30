import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack } from 'three';

/**
 * Hand-rolled `AnimationClip`s for the stub humanoid. T1's GLB ships its own
 * Mixamo/ActorCore clips and replaces these wholesale; until then we drive
 * the AnimationMixer with cheap keyframe tracks so cross-fade semantics are
 * exercisable end-to-end (acceptance criterion 4).
 *
 * Tracks reference bone names by `boneName.property[xyz]`. The bones are
 * registered as `Object3D.name` in `StubHumanoid`, so PropertyBinding picks
 * them up automatically when we plug a clip into a mixer rooted at the
 * humanoid root group.
 */

/**
 * Build a quaternion track that swings a bone around the X axis between
 * ±amplitude radians. Two-keyframe loop using the start angle as both
 * endpoints (loop semantics handled by the mixer).
 */
function quatSwingX(
  boneName: string,
  amplitude: number,
  duration: number,
): QuaternionKeyframeTrack {
  const half = duration / 2;
  const a = Math.sin(amplitude / 2);
  const c = Math.cos(amplitude / 2);
  // axis-angle around X: (sin(amp/2), 0, 0, cos(amp/2))
  return new QuaternionKeyframeTrack(
    `${boneName}.quaternion`,
    [0, half, duration],
    [
      // forward swing
      a,
      0,
      0,
      c,
      // backward swing
      -a,
      0,
      0,
      c,
      // back to forward (loop seam)
      a,
      0,
      0,
      c,
    ],
  );
}

function bobY(
  boneName: string,
  amplitude: number,
  duration: number,
  baseline = 0,
): NumberKeyframeTrack {
  const half = duration / 2;
  return new NumberKeyframeTrack(
    `${boneName}.position[y]`,
    [0, half, duration],
    [baseline, baseline + amplitude, baseline],
  );
}

/**
 * Idle: gentle vertical bob on the pelvis. Everyone else stays neutral.
 */
export function buildIdleClip(): AnimationClip {
  const duration = 2.0;
  return new AnimationClip('idle', duration, [bobY('pelvis', 0.04, duration)]);
}

/**
 * Walk: contralateral leg + arm swing. Bones rotate around their local X.
 */
export function buildWalkClip(): AnimationClip {
  const duration = 0.9;
  return new AnimationClip('walk', duration, [
    bobY('pelvis', 0.05, duration),
    quatSwingX('rHip', 0.6, duration),
    quatSwingX('lHip', -0.6, duration),
    quatSwingX('rKnee', 0.4, duration),
    quatSwingX('lKnee', -0.4, duration),
    quatSwingX('rShoulder', -0.5, duration),
    quatSwingX('lShoulder', 0.5, duration),
    quatSwingX('rElbow', 0.25, duration),
    quatSwingX('lElbow', -0.25, duration),
  ]);
}

/**
 * Run: same shape as walk but bigger amplitude and faster loop.
 */
export function buildRunClip(): AnimationClip {
  const duration = 0.55;
  return new AnimationClip('run', duration, [
    bobY('pelvis', 0.09, duration),
    quatSwingX('rHip', 0.95, duration),
    quatSwingX('lHip', -0.95, duration),
    quatSwingX('rKnee', 0.7, duration),
    quatSwingX('lKnee', -0.7, duration),
    quatSwingX('rShoulder', -0.85, duration),
    quatSwingX('lShoulder', 0.85, duration),
    quatSwingX('rElbow', 0.5, duration),
    quatSwingX('lElbow', -0.5, duration),
  ]);
}

/**
 * Jump: a single half-cycle pose that briefly tucks the legs.
 */
export function buildJumpClip(): AnimationClip {
  const duration = 0.5;
  const a = Math.sin(0.55 / 2);
  const c = Math.cos(0.55 / 2);
  return new AnimationClip('jump', duration, [
    new QuaternionKeyframeTrack('rHip.quaternion', [0, duration], [a, 0, 0, c, 0, 0, 0, 1]),
    new QuaternionKeyframeTrack('lHip.quaternion', [0, duration], [a, 0, 0, c, 0, 0, 0, 1]),
    new QuaternionKeyframeTrack('rKnee.quaternion', [0, duration], [-a * 1.5, 0, 0, c, 0, 0, 0, 1]),
    new QuaternionKeyframeTrack('lKnee.quaternion', [0, duration], [-a * 1.5, 0, 0, c, 0, 0, 0, 1]),
  ]);
}

/**
 * Wave: action1 — left arm overhead wave. Useful as a non-locomotion clip
 * for testing `play_animation` interrupt semantics.
 */
export function buildWaveClip(): AnimationClip {
  const duration = 1.2;
  // Raise arm: rotate around Z for outward, X for back-and-forth wave.
  const liftA = Math.sin(-2.1 / 2);
  const liftC = Math.cos(-2.1 / 2);
  return new AnimationClip('wave', duration, [
    new QuaternionKeyframeTrack(
      'lShoulder.quaternion',
      [0, duration / 2, duration],
      [
        // axis Z, angle ~-2.1 rad (arm up and out)
        0,
        0,
        liftA,
        liftC,
        0,
        0,
        liftA,
        liftC,
        0,
        0,
        liftA,
        liftC,
      ],
    ),
    new QuaternionKeyframeTrack(
      'lElbow.quaternion',
      [0, duration / 4, (3 * duration) / 4, duration],
      [
        Math.sin(0.35 / 2),
        0,
        0,
        Math.cos(0.35 / 2),
        Math.sin(-0.35 / 2),
        0,
        0,
        Math.cos(-0.35 / 2),
        Math.sin(0.35 / 2),
        0,
        0,
        Math.cos(0.35 / 2),
        Math.sin(0.35 / 2),
        0,
        0,
        Math.cos(0.35 / 2),
      ],
    ),
  ]);
}

/**
 * Fall: same as jump pose, longer duration. Mostly for ecctrl's `fall` slot.
 */
export function buildFallClip(): AnimationClip {
  return new AnimationClip('fall', 0.75, [bobY('pelvis', -0.04, 0.75)]);
}

/**
 * Used by `EcctrlAnimation`-like wiring — slot name maps to clip name.
 * We keep the slot vocabulary identical to ecctrl's `AnimationSet` so a
 * future swap to `<EcctrlAnimation characterURL="…" animationSet={…} />`
 * is a straight rename.
 */
export const STUB_ANIMATION_SET = {
  idle: 'idle',
  walk: 'walk',
  run: 'run',
  jump: 'jump',
  jumpIdle: 'jump',
  jumpLand: 'jump',
  fall: 'fall',
  action1: 'wave',
} as const;

export const STUB_CLIP_NAMES = Object.values(STUB_ANIMATION_SET);

/**
 * Construct the full clip set in one call. Order matches what the Mixer
 * registers when the character mounts.
 */
export function buildStubAnimationClips(): readonly AnimationClip[] {
  return [
    buildIdleClip(),
    buildWalkClip(),
    buildRunClip(),
    buildJumpClip(),
    buildFallClip(),
    buildWaveClip(),
  ];
}

export type StubClipName = (typeof STUB_CLIP_NAMES)[number];
