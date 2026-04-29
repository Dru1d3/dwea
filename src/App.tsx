import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { CameraRig } from './CameraRig.js';
import { Environment } from './Environment.js';
import { Hud } from './Hud.js';
import { SplatScene } from './SplatScene.js';

const cameraInitialPosition: [number, number, number] = [2.4, 1.2, 4];

const SAMPLE_SPLAT_URL = 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat';

export function App() {
  return (
    <>
      <Canvas
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ position: cameraInitialPosition, fov: 50, near: 0.1, far: 100 }}
      >
        <color attach="background" args={['#05060a']} />
        <fog attach="fog" args={['#05060a', 18, 36]} />
        <Environment />
        <Suspense fallback={null}>
          <SplatScene src={SAMPLE_SPLAT_URL} />
        </Suspense>
        <CameraRig />
      </Canvas>
      <Hud />
    </>
  );
}
