// Hand-written declarations for the vendored `three-ik` build. The upstream
// package ships no types. We expose only the surface our IK wrapper uses.

import type { Object3D, Vector3 } from 'three';

export class IKBallConstraint {
  constructor(angle: number);
}

export class IKJoint {
  constructor(
    bone: Object3D,
    options?: { constraints?: ReadonlyArray<IKBallConstraint> },
  );
  bone: Object3D;
}

export class IKChain {
  constructor();
  add(joint: IKJoint, options?: { target?: Object3D | null }): IKChain;
  joints: ReadonlyArray<IKJoint>;
  target: Object3D | null;
}

export class IK {
  constructor();
  add(chain: IKChain): IK;
  solve(): void;
  chains: ReadonlyArray<IKChain>;
}

export class IKHelper extends Object3D {
  constructor(
    ik: IK,
    options?: { color?: number | string; showBones?: boolean; boneSize?: number },
  );
}
