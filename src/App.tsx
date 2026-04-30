import { KeyboardControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraRig } from './CameraRig.js';
import { Environment } from './Environment.js';
import { Hud } from './Hud.js';
import { SplatScene } from './SplatScene.js';
import { Character, type CharacterRef } from './character/Character.js';
import { createCharacterIntent } from './character/intent.js';
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

/**
 * WASD + jump key map for `<KeyboardControls>`. Names match Ecctrl's
 * defaults — see `useKeyboardControls` calls in `node_modules/ecctrl`.
 */
const KEYBOARD_MAP = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['Shift'] },
  { name: 'action1', keys: ['1', 'KeyQ'] },
  { name: 'action2', keys: ['2'] },
  { name: 'action3', keys: ['3'] },
  { name: 'action4', keys: ['4'] },
] as const;

/** Square half-extent (m) for the static ground collider. Comfortably wider
 *  than every splat scene we've shipped so the character never falls off. */
const GROUND_HALF_EXTENT = 200;

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

  // T2 — character + physics rig. The ref is read by the intent surface so
  // T3 can dispatch tool calls into it from anywhere outside R3F's render
  // tree. Spawn slightly inside the splat scene with a touch of clearance
  // above the floor so the floating-capsule controller settles cleanly.
  const characterRef = useRef<CharacterRef>(null);
  const characterSpawn = useMemo<[number, number, number]>(
    () => [1.4, navigation.groundY + 1.0, 1.6],
    [navigation.groundY],
  );

  return (
    <>
      <KeyboardControls map={KEYBOARD_MAP as unknown as { name: string; keys: string[] }[]}>
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
          {/* Rapier physics live under <Suspense> so the WASM init kicks in
              after first paint without blocking the splat scene. */}
          <Suspense fallback={null}>
            <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
              {/* Static ground collider matching the splat scene's floor.
                  Cuboid is cheap and infinite-grid-flat, which is what
                  every shipping splat scene uses today. */}
              <RigidBody type="fixed" colliders="cuboid" friction={1} restitution={0}>
                <mesh
                  position={[0, navigation.groundY - 0.05, 0]}
                  rotation={[0, 0, 0]}
                  visible={false}
                >
                  <boxGeometry args={[GROUND_HALF_EXTENT * 2, 0.1, GROUND_HALF_EXTENT * 2]} />
                  <meshBasicMaterial color="#000" />
                </mesh>
              </RigidBody>
              <Character ref={characterRef} initialPosition={characterSpawn} />
            </Physics>
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
          <CharacterIntentBridge characterRef={characterRef} />
        </Canvas>
      </KeyboardControls>
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

/**
 * Lives inside <Canvas> so it can read R3F state (active camera). On mount,
 * binds a `window.dwea` console handle exposing the same intent surface
 * T3 will import — that satisfies the four browser-console acceptance
 * checks for DWEA-17 (lookAt / pointAt / playAnimation / moveTo).
 */
function CharacterIntentBridge({
  characterRef,
}: { readonly characterRef: { readonly current: CharacterRef | null } }) {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const intent = createCharacterIntent(characterRef, {
      resolveCamera: () => camera,
    });
    const win = globalThis as unknown as { dwea?: unknown };
    win.dwea = {
      moveTo: intent.move_to,
      lookAt: intent.look_at,
      pointAt: intent.point_at,
      playAnimation: intent.play_animation,
      speak: intent.speak,
      dispatch: intent.dispatch,
      lookAtCamera: () => intent.look_at('camera'),
      character: characterRef,
    };
    return () => {
      const w = globalThis as unknown as { dwea?: unknown };
      w.dwea = undefined;
    };
  }, [camera, characterRef]);

  return null;
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
