import { Splat } from '@react-three/drei';
import type { SplatTransform } from './splats/registry.js';
import { DEFAULT_TRANSFORM } from './splats/registry.js';

export type SplatSceneProps = {
  readonly src: string;
  readonly transform?: SplatTransform;
};

export function SplatScene({ src, transform }: SplatSceneProps) {
  const t = transform ?? {};
  const scale = t.scale ?? DEFAULT_TRANSFORM.scale;
  const position = t.position ?? DEFAULT_TRANSFORM.position;
  const rotation = t.rotation ?? DEFAULT_TRANSFORM.rotation;

  return (
    <group
      position={position as [number, number, number]}
      rotation={rotation as [number, number, number]}
      scale={scale}
    >
      <Splat key={src} src={src} />
    </group>
  );
}
