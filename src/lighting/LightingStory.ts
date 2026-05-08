// Per-scene lighting story per Visual Style Bible v0.1 §4 + §5.3.
// Bible: /DWEA/issues/DWEA-54#document-style-bible
//
// Splats ship at their captured hour — they carry their own photogrammetry
// lighting. We do not relight them. The story below exposes only the two
// surfaces engineering controls:
//   1. character rim — tinted toward the scene's warm/cool dominant so the
//      stylised guest belongs in the place by colour-bias (§5.3 rule).
//   2. tonemapping + exposure — baked from the captured hour, no runtime sun
//      rotation (§5.3 rule).
//
// If you are about to re-add ambient/hemi/dir/<Sky> here to "brighten things
// up", stop. The splat is the lighting. Capture a sibling scene at the hour
// you want instead (§4.1 / §4.2 / §4.3 capture-source notes).
import { ACESFilmicToneMapping, NoToneMapping, type ToneMapping } from 'three';

export type ArchetypeName = 'hollow' | 'room' | 'clearing' | 'gallery';

export type CharacterRim = {
  /** Hex from §5.1 master palette. Bias toward the scene's warm/cool dominant. */
  readonly color: string;
  /** Three.js point-light intensity. Small by design — splat already lights the place. */
  readonly intensity: number;
  /** Falloff distance in metres. Keep ≤ ~5 m so the rim does not relight the splat. */
  readonly distance: number;
  /** World-space offset from the character anchor (x, y, z) in metres. */
  readonly offset: readonly [number, number, number];
};

export type LightingStory = {
  readonly archetype: ArchetypeName;
  readonly characterRim: CharacterRim;
  readonly toneMapping: ToneMapping;
  readonly toneMappingExposure: number;
};

// §4.1 — "Late-afternoon golden hour, leaf-filtered key." Long warm shadows.
// Rim biases toward palette/amber-halo (#FFE9B0), Mara's halo slot.
export const HOLLOW: LightingStory = {
  archetype: 'hollow',
  characterRim: { color: '#FFE9B0', intensity: 1.4, distance: 4, offset: [0, 0.9, 0.3] },
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 0.95,
};

// §4.2 — "Overcast diffuse window-light, single warm bulb practical." Soft
// shadow, low contrast, one warm source. Rim toward palette/amber-core.
export const ROOM: LightingStory = {
  archetype: 'room',
  characterRim: { color: '#F4D58A', intensity: 1.1, distance: 3.2, offset: [0, 0.9, 0.3] },
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 0.85,
};

// §4.3 — "Cool overcast / blue hour edge." High-key, low contrast, no warm
// source. Rim biases toward palette/sky-bright (#E6F2FB).
export const CLEARING: LightingStory = {
  archetype: 'clearing',
  characterRim: { color: '#E6F2FB', intensity: 1.2, distance: 4.5, offset: [0, 0.9, 0.3] },
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 1.05,
};

// §4.4 — "Specimen / object" archetype. Carve-out: the studio rig is rendered
// by <Environment> when archetype === 'gallery'. Rim values here only apply
// if a gallery scene also wants a per-character bias on top of the rig.
export const GALLERY: LightingStory = {
  archetype: 'gallery',
  characterRim: { color: '#FFE9B0', intensity: 0.8, distance: 3.5, offset: [0, 0.9, 0.3] },
  toneMapping: NoToneMapping,
  toneMappingExposure: 1.0,
};

export const LIGHTING_STORIES: Record<ArchetypeName, LightingStory> = {
  hollow: HOLLOW,
  room: ROOM,
  clearing: CLEARING,
  gallery: GALLERY,
};

export function getLightingStory(archetype: ArchetypeName): LightingStory {
  return LIGHTING_STORIES[archetype];
}
