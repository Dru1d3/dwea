/**
 * ARKit-52 blendshape channel definitions and stream-application helpers.
 *
 * ARKit-52 is the interchange we standardised on for the v1 face stack —
 * Convai exposes a 61-channel superset and A2F-3D NIM emits ARKit-52
 * directly ([research note](/DWEA/issues/DWEA-118#document-plan); AR's
 * `docs/research/tts-driven-facial-animation.md`). This module is engine-
 * agnostic: both v1.2 Convai and the Spike B A2F-3D client target it.
 *
 * The 52 channel names below are the canonical Apple ARKit order. Convai's
 * extra 9 channels live outside this module; [DWEA-116](/DWEA/issues/DWEA-116)
 * tracks whether they collapse cleanly onto the 52.
 */

export const ARKIT_52_CHANNELS = [
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type Arkit52Channel = (typeof ARKIT_52_CHANNELS)[number];

/** Coefficient vector, one per channel, in `ARKIT_52_CHANNELS` order. Each
 *  value is the blendshape weight in [0, 1]. */
export type Arkit52Frame = readonly number[];

export const ARKIT_52_LENGTH = ARKIT_52_CHANNELS.length;

const CHANNEL_INDEX: Readonly<Record<Arkit52Channel, number>> = Object.freeze(
  Object.fromEntries(ARKIT_52_CHANNELS.map((name, i) => [name, i])) as Record<
    Arkit52Channel,
    number
  >,
);

export function channelIndex(name: Arkit52Channel): number {
  return CHANNEL_INDEX[name];
}

/** Build a frame from a sparse `{ channel: value }` object. Missing channels
 *  default to zero. Useful for tests and for engines that emit only the
 *  channels they actually changed. */
export function frameFromSparse(values: Partial<Record<Arkit52Channel, number>>): Arkit52Frame {
  const out = new Array<number>(ARKIT_52_LENGTH).fill(0);
  for (const [name, value] of Object.entries(values) as Array<[Arkit52Channel, number]>) {
    const idx = CHANNEL_INDEX[name];
    if (idx !== undefined && typeof value === 'number') out[idx] = value;
  }
  return out;
}

/** Linear interpolate between two frames. `t` clamped to [0, 1]. Used by the
 *  apply-to-mesh path when the viseme stream is sparser than the render
 *  frame rate (e.g. 30 fps in, 60 fps render). */
export function lerpFrame(a: Arkit52Frame, b: Arkit52Frame, t: number): Arkit52Frame {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const out = new Array<number>(ARKIT_52_LENGTH).fill(0);
  for (let i = 0; i < ARKIT_52_LENGTH; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    out[i] = av + (bv - av) * clamped;
  }
  return out;
}

/**
 * Mesh-shaped target: an object that owns a `morphTargetDictionary`
 * (Three.js's `Mesh`/`SkinnedMesh` shape) plus a writable
 * `morphTargetInfluences` array. The function is typed against this minimal
 * shape so it tests cleanly without pulling Three.js into Vitest's jsdom
 * environment. The runtime call sites pass a `THREE.Mesh` directly.
 */
export interface MorphTargetMesh {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

/** Apply an ARKit-52 frame to a mesh's morph-target influences in place.
 *
 *  The mesh's `morphTargetDictionary` is the source of truth for which
 *  channels exist on the mesh — channels missing from the dictionary are
 *  silently skipped, channels missing from the frame default to zero. This
 *  lets a "lip only" rig consume a full ARKit-52 stream without exploding,
 *  which is the case we expect for the production Otto/Pip/Mara rigs. */
export function applyFrameToMesh(mesh: MorphTargetMesh, frame: Arkit52Frame): void {
  const dict = mesh.morphTargetDictionary;
  const inf = mesh.morphTargetInfluences;
  if (!dict || !inf) return;
  for (let i = 0; i < ARKIT_52_LENGTH; i++) {
    const channel = ARKIT_52_CHANNELS[i];
    if (channel === undefined) continue;
    const meshIdx = dict[channel];
    if (meshIdx === undefined) continue;
    inf[meshIdx] = frame[i] ?? 0;
  }
}

/** Read `jawOpen` out of an ARKit-52 frame as a [0, 1] number. Convenience
 *  for the telemetry emitter — keeps the emitter from importing the channel
 *  list. */
export function jawOpenOf(frame: Arkit52Frame): number {
  return frame[CHANNEL_INDEX.jawOpen] ?? 0;
}
