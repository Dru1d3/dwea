import { Object3D, type Vector3 } from 'three';
import type { HumanoidHandle } from './StubHumanoid.js';
import { IK, IKBallConstraint, IKChain, IKJoint } from './vendor/three-ik.js';

/**
 * Thin wrapper around `three-ik` that exposes the two IK behaviours the
 * intent surface needs:
 *
 *  - `LookAtIK` — head/spine chain, target defaults to the active camera.
 *  - `PointAtIK` — right shoulder→elbow→wrist chain, target is a Vector3.
 *
 * Each solver owns its own three-ik graph and an Object3D used as the IK
 * target. `tick()` is called once per frame from `Character`'s useFrame so
 * the solver runs after locomotion + animation pose updates.
 *
 * Both solvers expose imperative `setTarget(...) / release()` so the LLM
 * motor (T3) can drive them from a tool-call dispatcher.
 */

interface IkBehaviour {
  /** Run one IK step. No-op while released. */
  tick(): void;
}

class HeadLookSolver implements IkBehaviour {
  private readonly chain: IKChain;
  private readonly ik: IK;
  private readonly targetNode: Object3D;
  private trackedTarget: Object3D | null = null;
  private trackedPoint: Vector3 | null = null;
  private active = false;

  constructor(humanoid: HumanoidHandle) {
    const pelvis = bone(humanoid, 'pelvis');
    const spine = bone(humanoid, 'spine');
    const chest = bone(humanoid, 'chest');
    const head = bone(humanoid, 'head');
    const ee = endEffector(head);

    this.targetNode = new Object3D();
    this.targetNode.name = 'lookAtIKTarget';
    humanoid.root.add(this.targetNode);

    this.chain = new IKChain();
    const softCone = new IKBallConstraint(35);
    this.chain.add(new IKJoint(pelvis, { constraints: [softCone] }));
    this.chain.add(new IKJoint(spine, { constraints: [new IKBallConstraint(40)] }));
    this.chain.add(new IKJoint(chest, { constraints: [new IKBallConstraint(40)] }));
    this.chain.add(new IKJoint(head, { constraints: [new IKBallConstraint(60)] }));
    this.chain.add(new IKJoint(ee), { target: this.targetNode });

    this.ik = new IK();
    this.ik.add(this.chain);
  }

  /** Track an Object3D's world position (e.g., the active camera). */
  setObjectTarget(obj: Object3D): void {
    this.trackedTarget = obj;
    this.trackedPoint = null;
    this.active = true;
  }

  /** Track a fixed world-space point. */
  setPointTarget(point: Vector3): void {
    this.trackedPoint = point.clone();
    this.trackedTarget = null;
    this.active = true;
  }

  release(): void {
    this.active = false;
  }

  tick(): void {
    if (!this.active) return;
    if (this.trackedTarget) {
      this.trackedTarget.getWorldPosition(this.targetNode.position);
    } else if (this.trackedPoint) {
      this.targetNode.position.copy(this.trackedPoint);
    }
    try {
      this.ik.solve();
    } catch {
      // three-ik throws when bones are colinear or matrices haven't been
      // updated yet; swallow and try again next frame rather than poison
      // the render loop.
    }
  }
}

class ArmPointSolver implements IkBehaviour {
  private readonly chain: IKChain;
  private readonly ik: IK;
  private readonly targetNode: Object3D;
  private trackedPoint: Vector3 | null = null;
  private trackedTarget: Object3D | null = null;
  private active = false;

  constructor(humanoid: HumanoidHandle) {
    const shoulder = bone(humanoid, 'rShoulder');
    const elbow = bone(humanoid, 'rElbow');
    const wrist = bone(humanoid, 'rWrist');
    const ee = endEffector(wrist);

    this.targetNode = new Object3D();
    this.targetNode.name = 'pointAtIKTarget';
    humanoid.root.add(this.targetNode);

    this.chain = new IKChain();
    this.chain.add(new IKJoint(shoulder, { constraints: [new IKBallConstraint(120)] }));
    this.chain.add(new IKJoint(elbow, { constraints: [new IKBallConstraint(150)] }));
    this.chain.add(new IKJoint(wrist, { constraints: [new IKBallConstraint(60)] }));
    this.chain.add(new IKJoint(ee), { target: this.targetNode });

    this.ik = new IK();
    this.ik.add(this.chain);
  }

  setObjectTarget(obj: Object3D): void {
    this.trackedTarget = obj;
    this.trackedPoint = null;
    this.active = true;
  }

  setPointTarget(point: Vector3): void {
    this.trackedPoint = point.clone();
    this.trackedTarget = null;
    this.active = true;
  }

  release(): void {
    this.active = false;
  }

  tick(): void {
    if (!this.active) return;
    if (this.trackedTarget) {
      this.trackedTarget.getWorldPosition(this.targetNode.position);
    } else if (this.trackedPoint) {
      this.targetNode.position.copy(this.trackedPoint);
    }
    try {
      this.ik.solve();
    } catch {
      // see HeadLookSolver
    }
  }
}

function bone(humanoid: HumanoidHandle, name: Parameters<HumanoidHandle['bone']>[0]): Object3D {
  const node = humanoid.bone(name);
  if (!node) {
    throw new Error(`StubHumanoid is missing bone "${name}"`);
  }
  return node;
}

/**
 * three-ik requires a leaf "end effector" Object3D parented to the last
 * actual bone — the chain treats it as the bone tip. We fabricate a
 * tiny offset child instead of forcing the humanoid hierarchy to carry
 * placeholder leaves.
 */
function endEffector(parent: Object3D): Object3D {
  const ee = new Object3D();
  ee.name = `${parent.name || 'bone'}-tip`;
  // Push slightly along local +Y (parent capsules extend along +Y).
  ee.position.set(0, 0.06, 0);
  parent.add(ee);
  return ee;
}

/** Imperative IK surface — the LLM motor (T3) calls these by hand. */
export interface IKControls {
  /**
   * Make the head/spine chain track the given camera/object every frame.
   * Pass an Object3D (e.g., the active camera) for live tracking.
   */
  lookAt(target: Object3D): void;
  /** Make the head/spine chain track a fixed world-space point. */
  lookAtPoint(point: Vector3): void;
  /** Stop the head IK; clip animations alone drive the head/spine. */
  releaseLookAt(): void;
  /** Make the right arm point at a fixed world-space point. */
  pointAt(point: Vector3): void;
  /** Make the right arm point at an object (tracks every frame). */
  pointAtObject(target: Object3D): void;
  /** Stop the arm IK; clip animations alone drive the arm. */
  releasePointAt(): void;
  /** Run one IK pass — invoked by the host every frame after pose update. */
  tick(): void;
  /** Detach IK targets from the humanoid hierarchy. */
  dispose(): void;
}

/**
 * Build the IK controls bound to a humanoid handle. Call `tick()` from
 * useFrame after the AnimationMixer updates the pose.
 */
export function createIKControls(humanoid: HumanoidHandle): IKControls {
  const lookAtSolver = new HeadLookSolver(humanoid);
  const pointAtSolver = new ArmPointSolver(humanoid);

  return {
    lookAt(target) {
      lookAtSolver.setObjectTarget(target);
    },
    lookAtPoint(point) {
      lookAtSolver.setPointTarget(point);
    },
    releaseLookAt() {
      lookAtSolver.release();
    },
    pointAt(point) {
      pointAtSolver.setPointTarget(point);
    },
    pointAtObject(target) {
      pointAtSolver.setObjectTarget(target);
    },
    releasePointAt() {
      pointAtSolver.release();
    },
    tick() {
      lookAtSolver.tick();
      pointAtSolver.tick();
    },
    dispose() {
      // Children cleaned up automatically when humanoid root unmounts.
    },
  };
}
