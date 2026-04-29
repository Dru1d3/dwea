import { Splat } from '@react-three/drei';

export type SplatSceneProps = {
  readonly src: string;
};

export function SplatScene({ src }: SplatSceneProps) {
  return (
    <group rotation={[Math.PI, 0, 0]}>
      <Splat key={src} src={src} />
    </group>
  );
}
