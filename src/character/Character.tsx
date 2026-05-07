import { useFrame, useThree } from '@react-three/fiber';
import Ecctrl from 'ecctrl';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  type AnimationAction,
  AnimationMixer,
  type Camera,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  type Vector3,
} from 'three';
import { type HumanoidHandle, StubHumanoid } from './StubHumanoid.js';
import { STUB_ANIMATION_SET, buildStubAnimationClips } from './animations.js';
import { type IKControls, createIKControls } from './ik.js';
import type { AnimationDispatchMode, ClipName } from './intent.js';

export interface CharacterRef {
  /** Right-arm point-at: target a fixed world-space point. */
  pointAt(target: Vector3): void;
  /** Right-arm point-at: track a live Object3D (e.g., another character). */
  pointAtObject(target: Object3D): void;
  /** Release the right-arm IK; clip animations regain control. */
  releasePointAt(): void;
  /** Head/spine look-at: track a live Object3D (default: active camera). */
  lookAt(target: Object3D): void;
  /** Head/spine look-at: target a fixed world-space point. */
  lookAtPoint(target: Vector3): void;
  /** Release the look-at IK; clip animations regain control. */
  releaseLookAt(): void;
  /**
   * Cross-fade into the named clip. `interrupt` snaps the current pose
   * faster than `queue` (which fades over a slower window). Releases the
   * point-at IK so the arm clip plays unobstructed (acceptance criterion).
   */
  playAnimation(clip: ClipName, mode?: AnimationDispatchMode): void;
  /** Direct world-space teleport target for `move_to` style intents. */
  moveTo(target: Vector3): void;
  /**
   * Read the live world position of the character root. Cheap — does not
   * allocate.
   */
  getPosition(out: Vector3): Vector3;
  /** Underlying humanoid handle, exposed for tests + advanced T3 use. */
  getHumanoid(): HumanoidHandle | null;
}

const FAST_FADE = 0.12;
const SLOW_FADE = 0.35;

interface CharacterProps {
  readonly initialPosition: readonly [number, number, number];
  /** When true, Ecctrl drives a follow-cam — leave false so OrbitControls owns the camera. */
  readonly followCam?: boolean;
}

export const Character = forwardRef<CharacterRef, CharacterProps>(function Character(
  { initialPosition, followCam = false },
  ref,
) {
  const ecctrlRef = useRef<unknown>(null);
  const humanoidRef = useRef<HumanoidHandle | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, AnimationAction>>(new Map());
  const currentClipRef = useRef<string | null>(null);
  const ikRef = useRef<IKControls | null>(null);
  const moveTargetRef = useRef<Vector3 | null>(null);

  const camera = useThree((s) => s.camera);

  // Build the AnimationMixer + IK once the humanoid mounts. The ref pattern
  // here lets us re-run only when the humanoid identity changes.
  const initRig = useCallback((humanoid: HumanoidHandle | null) => {
    humanoidRef.current = humanoid;
    if (!humanoid) {
      mixerRef.current = null;
      actionsRef.current = new Map();
      ikRef.current?.dispose();
      ikRef.current = null;
      currentClipRef.current = null;
      return;
    }

    // Compute world matrices for the freshly-mounted hierarchy so three-ik
    // can read accurate joint distances during chain construction.
    humanoid.root.updateMatrixWorld(true);

    const mixer = new AnimationMixer(humanoid.root);
    const actions = new Map<string, AnimationAction>();
    for (const clip of buildStubAnimationClips()) {
      const action = mixer.clipAction(clip);
      action.setLoop(
        clip.name === 'jump' || clip.name === 'wave' ? LoopOnce : LoopRepeat,
        Number.POSITIVE_INFINITY,
      );
      action.clampWhenFinished = clip.name === 'jump' || clip.name === 'wave';
      actions.set(clip.name, action);
    }
    mixerRef.current = mixer;
    actionsRef.current = actions;

    // Default to idle so the rig has visible motion before any LLM intent.
    const idle = actions.get(STUB_ANIMATION_SET.idle);
    idle?.reset().fadeIn(FAST_FADE).play();
    currentClipRef.current = STUB_ANIMATION_SET.idle;

    ikRef.current = createIKControls(humanoid);
  }, []);

  // Compose the inner imperative API once. All methods read latest refs so
  // the closures stay stable as React re-renders.
  useImperativeHandle(
    ref,
    () => ({
      pointAt(target) {
        ikRef.current?.pointAt(target);
      },
      pointAtObject(target) {
        ikRef.current?.pointAtObject(target);
      },
      releasePointAt() {
        ikRef.current?.releasePointAt();
      },
      lookAt(target) {
        ikRef.current?.lookAt(target);
      },
      lookAtPoint(target) {
        ikRef.current?.lookAtPoint(target);
      },
      releaseLookAt() {
        ikRef.current?.releaseLookAt();
      },
      playAnimation(clipName, mode = 'queue') {
        playClip(clipName, mode);
      },
      moveTo(target) {
        moveTargetRef.current = target.clone();
      },
      getPosition(out) {
        const root = humanoidRef.current?.root;
        if (root) {
          root.getWorldPosition(out);
        }
        return out;
      },
      getHumanoid() {
        return humanoidRef.current;
      },
    }),
    [],
  );

  // Track the active camera as the default look-at target. The user-side
  // `lookAt(...)` overrides this.
  useEffect(() => {
    const ik = ikRef.current;
    if (!ik) return;
    ik.lookAt(camera as Camera);
  }, [camera]);

  function playClip(clipName: string, mode: AnimationDispatchMode) {
    const actions = actionsRef.current;
    const next = actions.get(clipName);
    if (!next) {
      // Unknown clip name — fail loud in dev, silent in prod-build typing.
      console.warn(`[Character] unknown animation clip "${clipName}"`);
      return;
    }
    const fade = mode === 'interrupt' ? FAST_FADE : SLOW_FADE;
    if (currentClipRef.current === clipName) {
      next.reset().fadeIn(fade).play();
      return;
    }
    const previous = currentClipRef.current ? actions.get(currentClipRef.current) : null;
    next.reset().fadeIn(fade).play();
    if (previous && previous !== next) {
      previous.fadeOut(fade);
    }
    // Per task: arm-priority animations release the point-at IK so the clip
    // is visible. Look-at on head stays in place — the IK contract.
    if (clipName === 'wave') {
      ikRef.current?.releasePointAt();
    }
    currentClipRef.current = clipName;
  }

  // Per-frame: advance the mixer, run IK, and ferry move-to teleport
  // targets to the Rapier body via Ecctrl's ref.
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
    ikRef.current?.tick();

    const moveTarget = moveTargetRef.current;
    if (moveTarget) {
      const body = ecctrlRef.current as {
        setTranslation?: (t: { x: number; y: number; z: number }, wake: boolean) => void;
      } | null;
      body?.setTranslation?.({ x: moveTarget.x, y: moveTarget.y, z: moveTarget.z }, true);
      moveTargetRef.current = null;
    }
  });

  const ecctrlProps = useMemo(
    () => ({
      ref: ecctrlRef as never,
      // Floating capsule sized to wrap the stub humanoid.
      capsuleHalfHeight: 0.55,
      capsuleRadius: 0.35,
      floatHeight: 0.0,
      // Spawn a bit above ground so the capsule settles cleanly.
      position: initialPosition as never,
      // Manual animation pipeline — we drive our own mixer below.
      animated: false,
      // Ecctrl's follow-cam fights OrbitControls. Keep OrbitControls in charge.
      disableFollowCam: !followCam,
      // Debug visual is off by default; flip via window.dwea?.debug = true.
      debug: false,
    }),
    [initialPosition, followCam],
  );

  return (
    <Ecctrl {...ecctrlProps}>
      {/* Drop the humanoid origin a bit so the pelvis lines up with the
          floating capsule's "hip" rather than its centre. */}
      <group position={[0, -0.55, 0]}>
        <StubHumanoid
          ref={(h) => {
            initRig(h);
          }}
        />
      </group>
    </Ecctrl>
  );
});
