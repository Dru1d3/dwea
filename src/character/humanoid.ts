import type { AnimationClip, Group, Object3D } from 'three';

/**
 * Named-bone hierarchy the IK + animation layers key off. Concrete humanoid
 * implementations (`StubHumanoid`, `GltfHumanoid`, …) expose bones by these
 * abstract names; how they map to actual `Object3D.name` strings is the
 * implementation's responsibility (see `boneNames`).
 */
export type HumanoidBone =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'head'
  | 'rShoulder'
  | 'rElbow'
  | 'rWrist'
  | 'lShoulder'
  | 'lElbow'
  | 'lWrist'
  | 'rHip'
  | 'rKnee'
  | 'rAnkle'
  | 'lHip'
  | 'lKnee'
  | 'lAnkle';

/**
 * Mapping abstract bones → the actual `Object3D.name` strings that
 * `AnimationMixer` PropertyBinding will look up. The synth `AnimationClip`s
 * use this map when constructing track names (see `animations.ts`), so the
 * same clip definitions retarget cleanly across rigs.
 */
export type HumanoidBoneNames = Record<HumanoidBone, string>;

/** StubHumanoid uses bone names equal to the abstract slot names. */
export const STUB_BONE_NAMES: HumanoidBoneNames = {
  pelvis: 'pelvis',
  spine: 'spine',
  chest: 'chest',
  head: 'head',
  rShoulder: 'rShoulder',
  rElbow: 'rElbow',
  rWrist: 'rWrist',
  lShoulder: 'lShoulder',
  lElbow: 'lElbow',
  lWrist: 'lWrist',
  rHip: 'rHip',
  rKnee: 'rKnee',
  rAnkle: 'rAnkle',
  lHip: 'lHip',
  lKnee: 'lKnee',
  lAnkle: 'lAnkle',
};

/**
 * Mixamo's standard armature, sanitised via `PropertyBinding.sanitizeNodeName`
 * (the colon in `mixamorig:Hips` is dropped at GLTFLoader-time). `spine` and
 * `chest` map to Mixamo's `Spine1` / `Spine2` so the IK head-look chain
 * spans roughly the same vertical distance the stub humanoid did.
 */
export const MIXAMO_BONE_NAMES: HumanoidBoneNames = {
  pelvis: 'mixamorigHips',
  spine: 'mixamorigSpine1',
  chest: 'mixamorigSpine2',
  head: 'mixamorigHead',
  rShoulder: 'mixamorigRightArm',
  rElbow: 'mixamorigRightForeArm',
  rWrist: 'mixamorigRightHand',
  lShoulder: 'mixamorigLeftArm',
  lElbow: 'mixamorigLeftForeArm',
  lWrist: 'mixamorigLeftHand',
  rHip: 'mixamorigRightUpLeg',
  rKnee: 'mixamorigRightLeg',
  rAnkle: 'mixamorigRightFoot',
  lHip: 'mixamorigLeftUpLeg',
  lKnee: 'mixamorigLeftLeg',
  lAnkle: 'mixamorigLeftFoot',
};

export interface HumanoidHandle {
  /** Root group `<Character>` wraps as the visual representation. */
  readonly root: Group;
  /** Look up an abstract bone by name. Returns null until the tree mounts. */
  readonly bone: (name: HumanoidBone) => Object3D | null;
  /** The actual `Object3D.name` string each abstract bone resolves to. */
  readonly boneNames: HumanoidBoneNames;
  /**
   * Bundled animation clips that ship with this humanoid (e.g., from a GLB).
   * `Character` merges these on top of the synth clips so a real `Idle` /
   * `Walk` / `Run` can replace the hand-rolled loops. Names are normalised
   * to lowercase so they collide cleanly with the synth set.
   */
  readonly clips?: readonly AnimationClip[];
}
