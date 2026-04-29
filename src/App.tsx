import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { SplatScene } from './SplatScene.js';

const cameraInitialPosition: [number, number, number] = [0, 0, 4];

export function App() {
  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: cameraInitialPosition, fov: 50, near: 0.1, far: 100 }}
    >
      <color attach="background" args={['#000000']} />
      <Suspense fallback={null}>
        <SplatScene />
      </Suspense>
    </Canvas>
  );
}
