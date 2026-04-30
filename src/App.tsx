import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CameraRig } from './CameraRig.js';
import { Environment } from './Environment.js';
import { Hud } from './Hud.js';
import { SplatScene } from './SplatScene.js';
import { loadMotorApiKey, saveMotorApiKey } from './character/storage.js';
import type { SceneState } from './llm/openrouter.js';
import { loadApiKey, saveApiKey } from './llm/storage.js';
import { GroundClickPlane } from './npc/GroundClickPlane.js';
import { Npc } from './npc/Npc.js';
import { useNpcState } from './npc/state.js';
import {
  defaultSplatId,
  findSplat,
  resolveNavigation,
  resolveSplatUrl,
  resolveTransform,
  splatRegistry,
} from './splats/registry.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { MotorChat } from './ui/MotorChat.js';
import { MotorSettingsDialog } from './ui/MotorSettingsDialog.js';
import { SettingsDialog } from './ui/SettingsDialog.js';
import { useChat } from './ui/useChat.js';

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

function isMotorModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('motor');
}

export function App() {
  const sceneId = useHashSceneId();
  const asset = findSplat(sceneId) ?? findSplat(defaultSplatId);
  if (!asset) {
    throw new Error(`Splat registry has no entry for "${defaultSplatId}".`);
  }

  const src = resolveSplatUrl(asset, import.meta.env.BASE_URL);
  const transform = resolveTransform(asset);
  const navigation = resolveNavigation(asset);

  const npc = useNpcState({
    initialPosition: navigation.npcSpawn,
    wanderRadius: navigation.wanderRadius,
    sceneKey: asset.id,
  });
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => loadApiKey() === '');

  // Stable getter so useChat's `send` doesn't churn when Mara moves each frame.
  const npcRef = useRef(npc);
  npcRef.current = npc;
  const getScene = useCallback<() => SceneState>(
    () => ({
      position: npcRef.current.position,
      lastClickTarget: npcRef.current.lastClickTarget,
    }),
    [],
  );

  const chat = useChat({ apiKey, getScene });

  const handleApiKeySave = useCallback((next: string) => {
    saveApiKey(next);
    setApiKey(next);
  }, []);

  // T3 motor (DWEA-18): opt-in via ?motor=1. Replaces the OpenRouter
  // ChatPanel with the tool-call MotorChat. Lives behind a flag until
  // T2 (DWEA-17) lands the real intent surface so we can take it default.
  const motorMode = isMotorModeEnabled();
  const [motorApiKey, setMotorApiKey] = useState<string>(() => loadMotorApiKey());
  const [motorSettingsOpen, setMotorSettingsOpen] = useState<boolean>(
    () => motorMode && loadMotorApiKey() === '',
  );
  const handleMotorKeySave = useCallback((next: string) => {
    saveMotorApiKey(next);
    setMotorApiKey(next);
  }, []);

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
        <Environment groundY={navigation.groundY} />
        <Suspense fallback={null}>
          <SplatScene src={src} transform={transform} />
        </Suspense>
        <Npc
          position={npc.position}
          target={npc.target}
          groundY={navigation.groundY}
          onPositionChange={npc.setPosition}
          onTargetReached={npc.clearTarget}
        />
        <GroundClickPlane
          groundY={navigation.groundY}
          radius={navigation.clickRadius}
          onPick={(p) => npc.setTarget(p, { fromUserClick: true })}
        />
        <CameraRig />
      </Canvas>
      <Hud />
      <SceneSwitcher currentId={asset.id} />
      {motorMode ? (
        <>
          <MotorChat
            hasApiKey={motorApiKey.length > 0}
            onOpenSettings={() => setMotorSettingsOpen(true)}
          />
          <MotorSettingsDialog
            open={motorSettingsOpen}
            initialKey={motorApiKey}
            onClose={() => setMotorSettingsOpen(false)}
            onSave={handleMotorKeySave}
          />
        </>
      ) : (
        <>
          <ChatPanel
            messages={chat.messages}
            onSend={chat.send}
            onOpenSettings={() => setSettingsOpen(true)}
            lastFirstTokenMs={chat.lastFirstTokenMs}
            averageFirstTokenMs={chat.averageFirstTokenMs}
            hasApiKey={apiKey.length > 0}
            busy={chat.busy}
          />
          <SettingsDialog
            open={settingsOpen}
            initialKey={apiKey}
            onClose={() => setSettingsOpen(false)}
            onSave={handleApiKeySave}
          />
        </>
      )}
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
