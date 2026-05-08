import { Grid, Sky } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  type ArchetypeName,
  type LightingStory,
  getLightingStory,
} from './lighting/LightingStory.js';

export type EnvironmentProps = {
  /**
   * Visual Style Bible §4 archetype — drives the scene's lighting story.
   * `hollow` / `room` / `clearing` ship at their captured hour with no relight.
   * `gallery` is the §4.4 carve-out and keeps a studio rig for specimen scenes.
   */
  readonly archetype: ArchetypeName;
  /** World Y of the ground plane (metres). Defaults to 0 (clean metric). */
  readonly groundY?: number;
};

/**
 * Per-scene environment shell, governed by Visual Style Bible §5.3:
 * "static-baked at captured hour, no relight."
 *
 * Bible: /DWEA/issues/DWEA-54#document-style-bible
 *
 * Splat-backed archetypes (`hollow` / `room` / `clearing`) carry their own
 * photogrammetry lighting; this shell renders **no** ambient/hemi/dir/<Sky>.
 * The `LightingStory` config (see `src/lighting/LightingStory.ts`) only
 * exposes per-character rim colour/intensity and renderer tonemapping —
 * those are applied at the call sites that own the character + the canvas.
 *
 * Carve-out: `archetype === 'gallery'` is the specimen scene type (§4.4) and
 * is **not** a committed archetype. Those keep the studio rig because they
 * have no captured-hour lighting to honour.
 *
 * If you are about to re-add ambient/hemi/dir/<Sky> here to "brighten things
 * up", stop. The splat is the lighting. Capture a sibling scene at the hour
 * you want instead — see §4.1 / §4.2 / §4.3 capture-source notes in the bible.
 */
export function Environment({ archetype, groundY = 0 }: EnvironmentProps) {
  const story = getLightingStory(archetype);

  return (
    <>
      <SceneToneMapping story={story} />
      {archetype === 'gallery' ? <GalleryStudioRig /> : null}
      <ReferenceGrid groundY={groundY} />
    </>
  );
}

/**
 * Apply the scene's tonemapping + exposure to the WebGL renderer. Set on
 * mount and reset to a neutral default on unmount so a later scene swap
 * does not leak the previous story's exposure.
 */
function SceneToneMapping({ story }: { readonly story: LightingStory }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const prevToneMapping = gl.toneMapping;
    const prevExposure = gl.toneMappingExposure;
    gl.toneMapping = story.toneMapping;
    gl.toneMappingExposure = story.toneMappingExposure;
    return () => {
      gl.toneMapping = prevToneMapping;
      gl.toneMappingExposure = prevExposure;
    };
  }, [gl, story.toneMapping, story.toneMappingExposure]);
  return null;
}

/**
 * Gallery (§4.4) studio rig — committed-archetype carve-out only. Specimen
 * scenes have no captured-hour lighting, so we light them like a product
 * shot. Keep this intentionally identical to the legacy catch-all rig so the
 * `nike`/`plush` specimens render unchanged.
 */
function GalleryStudioRig() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#bcd8ff', '#4a3320', 0.55]} />
      <directionalLight position={[20, 30, 12]} intensity={1.05} />
      <Sky
        distance={450000}
        sunPosition={[20, 30, 12]}
        inclination={0.49}
        azimuth={0.25}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />
    </>
  );
}

/**
 * Metric reference grid. 1 m cells, 10 m sections. Renders in every scene as
 * a navigation aid — it is geometry, not lighting, so it stays out of the
 * §5.3 no-relight rule.
 */
function ReferenceGrid({ groundY }: { readonly groundY: number }) {
  return (
    <Grid
      position={[0, groundY + 0.001, 0]}
      args={[200, 200]}
      cellSize={1}
      cellThickness={0.5}
      cellColor="#5a6378"
      sectionSize={10}
      sectionThickness={1.0}
      sectionColor="#8aa3c4"
      fadeDistance={120}
      fadeStrength={1.2}
      infiniteGrid
      followCamera={false}
    />
  );
}
