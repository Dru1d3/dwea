import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Group, Object3D } from 'three';

/**
 * Named-bone hierarchy for the placeholder humanoid. The shape is what
 * three-ik chains and synthesised AnimationClips key off, so future swaps to
 * T1's GLB only need to expose bones with the same names.
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

export interface HumanoidHandle {
  /** Root group — what Ecctrl wraps as the visual representation. */
  readonly root: Group;
  /** Look up a named bone Object3D. Returns null until the tree mounts. */
  readonly bone: (name: HumanoidBone) => Object3D | null;
}

interface BoneGroupProps {
  readonly name: HumanoidBone;
  readonly position?: [number, number, number];
  readonly children?: React.ReactNode;
  readonly registry: Map<HumanoidBone, Object3D>;
}

function BoneGroup({ name, position, children, registry }: BoneGroupProps) {
  // exactOptionalPropertyTypes — only forward `position` when it's defined;
  // <group> rejects `position={undefined}`.
  const positionProps = position ? { position } : {};
  return (
    <group
      name={name}
      {...positionProps}
      ref={(node) => {
        if (node) {
          registry.set(name, node);
        } else {
          registry.delete(name);
        }
      }}
    >
      {children}
    </group>
  );
}

/**
 * Capsule limb visual — a stretched capsule centred between the parent bone
 * and the child bone position. Purely cosmetic; the bone hierarchy is what
 * the IK + animation layers care about.
 */
function Limb({
  length,
  radius,
  color,
}: {
  readonly length: number;
  readonly radius: number;
  readonly color: string;
}) {
  // Capsule's local Y axis runs along its long edge. We translate it down so
  // the limb extends from its bone origin toward -Y (matching how children
  // are placed below their parent in the hierarchy).
  return (
    <mesh position={[0, -length / 2, 0]} castShadow receiveShadow>
      <capsuleGeometry args={[radius, Math.max(0.001, length - 2 * radius), 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
    </mesh>
  );
}

const BODY = '#5a7adb';
const SKIN = '#f3c8a8';

/**
 * Placeholder humanoid built out of capsule meshes parented under named
 * bone groups. Stand-in for T1's GLB. Swapping it out is a matter of
 * mounting a real `<primitive>` with a SkinnedMesh whose bones share these
 * names; the IK and intent layers won't notice.
 */
export const StubHumanoid = forwardRef<HumanoidHandle>(function StubHumanoid(_, ref) {
  const rootRef = useRef<Group>(null);
  const registry = useRef<Map<HumanoidBone, Object3D>>(new Map()).current;

  useImperativeHandle(
    ref,
    () => ({
      get root() {
        const node = rootRef.current;
        if (!node) {
          throw new Error('StubHumanoid root accessed before mount');
        }
        return node;
      },
      bone(name) {
        return registry.get(name) ?? null;
      },
    }),
    [registry],
  );

  // Bone offsets are local-space — each child sits at the joint position
  // relative to its parent. Heights chosen so the capsule is roughly 1.7 m
  // tall measured from foot to crown.
  return (
    <group ref={rootRef} name="stub-humanoid">
      {/* Pelvis sits at the rigidbody origin's "hip" height. */}
      <BoneGroup name="pelvis" position={[0, 0.0, 0]} registry={registry}>
        <BoneGroup name="spine" position={[0, 0.18, 0]} registry={registry}>
          <BoneGroup name="chest" position={[0, 0.22, 0]} registry={registry}>
            <Limb length={0.4} radius={0.16} color={BODY} />
            <BoneGroup name="head" position={[0, 0.22, 0]} registry={registry}>
              <mesh position={[0, 0.12, 0]} castShadow>
                <sphereGeometry args={[0.13, 24, 16]} />
                <meshStandardMaterial color={SKIN} roughness={0.5} />
              </mesh>
              {/* Eyes — front face is +Z so this is the canonical "look"
                  direction the IK wrapper targets. */}
              <mesh position={[-0.045, 0.13, 0.115]}>
                <sphereGeometry args={[0.018, 10, 8]} />
                <meshBasicMaterial color="#10131a" />
              </mesh>
              <mesh position={[0.045, 0.13, 0.115]}>
                <sphereGeometry args={[0.018, 10, 8]} />
                <meshBasicMaterial color="#10131a" />
              </mesh>
            </BoneGroup>

            <BoneGroup name="rShoulder" position={[-0.18, 0.16, 0]} registry={registry}>
              <BoneGroup name="rElbow" position={[0, -0.26, 0]} registry={registry}>
                <Limb length={0.26} radius={0.05} color={BODY} />
                <BoneGroup name="rWrist" position={[0, -0.26, 0]} registry={registry}>
                  <Limb length={0.24} radius={0.045} color={SKIN} />
                </BoneGroup>
              </BoneGroup>
              <Limb length={0.26} radius={0.055} color={BODY} />
            </BoneGroup>

            <BoneGroup name="lShoulder" position={[0.18, 0.16, 0]} registry={registry}>
              <BoneGroup name="lElbow" position={[0, -0.26, 0]} registry={registry}>
                <Limb length={0.26} radius={0.05} color={BODY} />
                <BoneGroup name="lWrist" position={[0, -0.26, 0]} registry={registry}>
                  <Limb length={0.24} radius={0.045} color={SKIN} />
                </BoneGroup>
              </BoneGroup>
              <Limb length={0.26} radius={0.055} color={BODY} />
            </BoneGroup>
          </BoneGroup>
        </BoneGroup>

        <BoneGroup name="rHip" position={[-0.09, -0.04, 0]} registry={registry}>
          <BoneGroup name="rKnee" position={[0, -0.42, 0]} registry={registry}>
            <Limb length={0.4} radius={0.06} color={BODY} />
            <BoneGroup name="rAnkle" position={[0, -0.42, 0]} registry={registry}>
              <Limb length={0.4} radius={0.06} color={BODY} />
            </BoneGroup>
          </BoneGroup>
        </BoneGroup>

        <BoneGroup name="lHip" position={[0.09, -0.04, 0]} registry={registry}>
          <BoneGroup name="lKnee" position={[0, -0.42, 0]} registry={registry}>
            <Limb length={0.4} radius={0.06} color={BODY} />
            <BoneGroup name="lAnkle" position={[0, -0.42, 0]} registry={registry}>
              <Limb length={0.4} radius={0.06} color={BODY} />
            </BoneGroup>
          </BoneGroup>
        </BoneGroup>
      </BoneGroup>
    </group>
  );
});
