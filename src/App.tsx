import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CameraRig } from './CameraRig.js';
import { Environment } from './Environment.js';
import { Hud } from './Hud.js';
import { SplatScene } from './SplatScene.js';
import type { SceneState } from './llm/openrouter.js';
import { loadApiKey, saveApiKey } from './llm/storage.js';
import { GroundClickPlane } from './npc/GroundClickPlane.js';
import { Npc } from './npc/Npc.js';
import { useNpcState } from './npc/state.js';
import {
  type SplatTransform,
  defaultSplatId,
  findSplat,
  resolveGroundFit,
  resolveNavigation,
  resolveSplatUrl,
  resolveTransform,
  splatRegistry,
} from './splats/registry.js';
import { type Tuning, loadTuning } from './splats/tuningStore.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { SceneTuner } from './ui/SceneTuner.js';
import { SettingsDialog } from './ui/SettingsDialog.js';
import { useChat } from './ui/useChat.js';

// Eye height ~1.7 m, set back ~10 m, slightly above to read as 'standing in a world'.
const cameraInitialPosition: [number, number, number] = [6, 2.4, 10];

function isTuneModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('tune');
}

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
  const transform = resolveTransform(asset);
  const navigation = resolveNavigation(asset);
  const fit = resolveGroundFit(asset);

  const tuneMode = isTuneModeEnabled();
  const [tuning, setTuning] = useState<Tuning | null>(() =>
    tuneMode ? loadTuning(asset.id) : null,
  );
  // Re-read tuning whenever the active scene changes — each scene has its own
  // saved override.
  useEffect(() => {
    setTuning(tuneMode ? loadTuning(asset.id) : null);
  }, [tuneMode, asset.id]);

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

  return (
    <>
      <Canvas
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: cameraInitialPosition, fov: 60, near: 0.1, far: 1000 }}
      >
        {/* Pale-sky background; the analytic <Sky> draws over this for views
            above the horizon, this colour shows below for grazing angles. */}
        <color attach="background" args={['#cfe2f3']} />
        {/* Soft atmospheric depth — very gentle, kicks in past 60 m so the
            world does not feel boxed-in. */}
        <fog attach="fog" args={['#cfe2f3', 60, 280]} />
        <Environment groundY={navigation.groundY} />
        <Suspense fallback={null}>
          <SplatSceneSlot
            src={src}
            transform={transform}
            groundFit={
              fit ? { groundY: navigation.groundY, percentile: fit.percentile } : undefined
            }
            tuning={tuning}
          />
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
      {tuneMode ? (
        <SceneTuner
          assetId={asset.id}
          value={tuning}
          defaults={{
            position: [transform.position[0], transform.position[1], transform.position[2]],
            rotation: [transform.rotation[0], transform.rotation[1], transform.rotation[2]],
            scale: transform.scale,
          }}
          onChange={setTuning}
        />
      ) : null}
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
  );
}

type SplatSceneSlotProps = {
  readonly src: string;
  readonly transform: Required<SplatTransform>;
  readonly groundFit: { readonly groundY: number; readonly percentile: number } | undefined;
  readonly tuning: Tuning | null;
};

function SplatSceneSlot({ src, transform, groundFit, tuning }: SplatSceneSlotProps) {
  if (tuning && groundFit) {
    return <SplatScene src={src} transform={transform} groundFit={groundFit} tuning={tuning} />;
  }
  if (tuning) {
    return <SplatScene src={src} transform={transform} tuning={tuning} />;
  }
  if (groundFit) {
    return <SplatScene src={src} transform={transform} groundFit={groundFit} />;
  }
  return <SplatScene src={src} transform={transform} />;
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
