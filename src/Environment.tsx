import { Grid } from '@react-three/drei';

const GROUND_Y = -1.6;

export function Environment() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cdd5ff', '#1a1a22', 0.5]} />
      <directionalLight position={[5, 8, 4]} intensity={0.9} />
      <Grid
        position={[0, GROUND_Y, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#3a3a4a"
        sectionSize={2.5}
        sectionThickness={1.0}
        sectionColor="#6c6cff"
        fadeDistance={28}
        fadeStrength={1.4}
        infiniteGrid
        followCamera={false}
      />
    </>
  );
}
