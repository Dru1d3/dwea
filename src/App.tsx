import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import { CameraRig } from './CameraRig.js';
import { Environment } from './Environment.js';
import { Hud } from './Hud.js';
import { SplatScene } from './SplatScene.js';
import { defaultSplatId, findSplat, resolveSplatUrl, splatRegistry } from './splats/registry.js';

const cameraInitialPosition: [number, number, number] = [2.4, 1.2, 4];

function readSceneIdFromHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return raw.length > 0 ? raw : defaultSplatId;
}

function useHashSceneId(): string {
  const [id, setId] = useState<string>(() => readSceneIdFromHash());

  useEffect(() => {
    const handler = () => {
      setId(readSceneIdFromHash());
    };
    window.addEventListener('hashchange', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
    };
  }, []);

  return id;
}

export function App() {
  const sceneId = useHashSceneId();
  const asset = findSplat(sceneId) ?? findSplat(defaultSplatId);
  if (!asset) {
    throw new Error(`Splat registry has no entry for "${defaultSplatId}".`);
  }

  const src = resolveSplatUrl(asset, import.meta.env.BASE_URL);

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
          <SplatScene src={src} />
        </Suspense>
        <CameraRig />
      </Canvas>
      <Hud />
      <SceneSwitcher currentId={asset.id} />
    </>
  );
}

function SceneSwitcher({ currentId }: { currentId: string }) {
  return (
    <nav
      aria-label="Splat scene"
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        background: 'rgba(10, 10, 14, 0.55)',
        backdropFilter: 'blur(6px)',
        color: '#e8e8f4',
        font: '12px/1.45 system-ui, -apple-system, sans-serif',
        letterSpacing: 0.2,
      }}
    >
      {splatRegistry.map((s) => (
        <a
          key={s.id}
          href={`#/${s.id}`}
          aria-current={s.id === currentId ? 'page' : undefined}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            color: s.id === currentId ? '#0a0a0e' : '#e8e8f4',
            background: s.id === currentId ? '#e8e8f4' : 'transparent',
            textDecoration: 'none',
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
