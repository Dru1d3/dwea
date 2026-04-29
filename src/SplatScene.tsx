import { Splat } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

const SAMPLE_SPLAT_URL = 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat';

const ROTATION_RADIANS_PER_SECOND = 0.15;

export function SplatScene() {
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * ROTATION_RADIANS_PER_SECOND;
    }
  });

  return (
    <group ref={group} rotation={[Math.PI, 0, 0]}>
      <Splat src={SAMPLE_SPLAT_URL} />
    </group>
  );
}
