export type SplatAsset = {
  readonly id: string;
  readonly label: string;
  readonly source: SplatSource;
  readonly credit?: string;
  readonly transform?: SplatTransform;
  readonly navigation?: SplatNavigation;
  readonly groundFit?: SplatGroundFit;
};

/**
 * Per-scene ground auto-alignment config. When set, `<SplatScene>` reads the
 * splat's own Y distribution and shifts the group so the lower percentile of
 * rendered Y lands at `navigation.groundY`. The Y component of
 * `transform.position` is ignored when `groundFit` is enabled.
 */
export type SplatGroundFit = {
  /** Percentile of rendered Y to anchor at the ground. Default 1. */
  readonly percentile?: number;
};

export type SplatSource =
  | { readonly kind: 'public'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string };

/**
 * Per-scene transform applied to the rendered splat group.
 *
 * World convention (see ADR 0007):
 *   - Right-handed, Y-up. 1 world unit = 1 metre.
 *   - Ground plane at Y = 0. Camera eye height roughly 1.7 m.
 *   - +Z is "out of the screen" / toward the viewer (three.js default).
 *
 * Splat convention:
 *   - cakewalk/splat-data antimatter15-format splats render Y-up as-is, so
 *     the default rotation is identity. Earlier revisions wrapped a 180° X
 *     flip here under the assumption that the data was Y-down — that
 *     assumption was wrong and made the world render upside down. See
 *     [DWEA-11](/DWEA/issues/DWEA-11).
 *   - World Labs Marble exports use OpenCV (Y-down). Marble assets MUST
 *     opt back into the X-flip via `rotation: [Math.PI, 0, 0]`. Keep that
 *     local to the asset, not in the default.
 */
export type SplatTransform = {
  readonly scale?: number;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
};

/**
 * Per-scene navigation tuning. Overrides the global defaults in
 * `src/npc/movement.ts`.
 */
export type SplatNavigation = {
  /** World Y of the ground plane / grid for this scene (metres). */
  readonly groundY?: number;
  /** Where Mara spawns on a fresh load (XZ, metres). */
  readonly npcSpawn?: { readonly x: number; readonly z: number };
  /** Radius of the click-to-walk disk centred on origin (metres). */
  readonly clickRadius?: number;
  /** Wander radius around origin used by the idle wander timer (metres). */
  readonly wanderRadius?: number;
};

export const DEFAULT_TRANSFORM = {
  scale: 1,
  position: [0, 0, 0] as const,
  // Identity. cakewalk antimatter15-format splats render Y-up as-is.
  rotation: [0, 0, 0] as const,
};

export const DEFAULT_NAVIGATION = {
  groundY: 0,
  npcSpawn: { x: -1.5, z: 1.5 },
  clickRadius: 12,
  wanderRadius: 3,
};

export const splatRegistry: readonly SplatAsset[] = [
  {
    id: 'garden',
    label: 'Garden',
    source: {
      kind: 'remote',
      url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/garden.splat',
    },
    credit:
      'cakewalk/splat-data on Hugging Face — Mip-NeRF 360 "garden" scene (Barron et al., 2022). Research/demo use.',
    transform: {
      // Mip-NeRF 360 captures are roughly metric. Render at 1:1 scale.
      // Y is owned by groundFit; X/Z stay zero (scene origin is roughly centred).
      scale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    // Ground auto-fits to the lower percentile of rendered Y. Outdoor capture
    // has stragglers under the floor, so lift to the 2nd percentile.
    groundFit: { percentile: 2 },
    navigation: {
      groundY: 0,
      npcSpawn: { x: 0, z: 1.5 },
      clickRadius: 14,
      wanderRadius: 4,
    },
  },
  {
    id: 'treehill',
    label: 'Treehill',
    source: {
      kind: 'remote',
      url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/treehill.splat',
    },
    credit:
      'cakewalk/splat-data on Hugging Face — Mip-NeRF 360 "treehill" scene (Barron et al., 2022). Research/demo use.',
    transform: {
      scale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    groundFit: { percentile: 2 },
    navigation: {
      groundY: 0,
      npcSpawn: { x: 0, z: 1.5 },
      clickRadius: 16,
      wanderRadius: 5,
    },
  },
  {
    id: 'nike',
    label: 'Nike (drei sample)',
    source: {
      kind: 'remote',
      url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat',
    },
    credit: 'cakewalk/splat-data on Hugging Face — drei <Splat> canonical demo asset.',
    transform: {
      // Object-scale capture; bump it up so the shoe reads as a "sculpture".
      // Y is owned by groundFit (sits the shoe sole on the grid).
      scale: 1.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    // Tight object capture: very few outliers below the sole, so anchor at p0.5.
    groundFit: { percentile: 0.5 },
    navigation: {
      groundY: 0,
      npcSpawn: { x: -1.5, z: 1.5 },
      clickRadius: 10,
      wanderRadius: 3,
    },
  },
  {
    id: 'plush',
    label: 'Plush toy',
    source: { kind: 'public', path: 'splats/plush.splat' },
    credit:
      'cakewalk/splat-data on Hugging Face — derived from the 3D Gaussian Splatting paper test scenes. Research/demo use; replace before commercial deployment.',
    transform: {
      scale: 1.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    groundFit: { percentile: 0.5 },
    navigation: {
      groundY: 0,
      npcSpawn: { x: -1.2, z: 1.2 },
      clickRadius: 8,
      wanderRadius: 2.5,
    },
  },
] as const;

export const defaultSplatId: SplatAsset['id'] = 'garden';

export function findSplat(id: string): SplatAsset | undefined {
  return splatRegistry.find((s) => s.id === id);
}

export function resolveSplatUrl(asset: SplatAsset, baseUrl: string): string {
  if (asset.source.kind === 'remote') {
    return asset.source.url;
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${asset.source.path}`;
}

export function resolveTransform(asset: SplatAsset): Required<SplatTransform> {
  const t = asset.transform ?? {};
  return {
    scale: t.scale ?? DEFAULT_TRANSFORM.scale,
    position: t.position ?? DEFAULT_TRANSFORM.position,
    rotation: t.rotation ?? DEFAULT_TRANSFORM.rotation,
  };
}

export function resolveGroundFit(asset: SplatAsset): { readonly percentile: number } | null {
  if (!asset.groundFit) return null;
  return { percentile: asset.groundFit.percentile ?? 1 };
}

export function resolveNavigation(asset: SplatAsset): Required<SplatNavigation> {
  const n = asset.navigation ?? {};
  return {
    groundY: n.groundY ?? DEFAULT_NAVIGATION.groundY,
    npcSpawn: n.npcSpawn ?? DEFAULT_NAVIGATION.npcSpawn,
    clickRadius: n.clickRadius ?? DEFAULT_NAVIGATION.clickRadius,
    wanderRadius: n.wanderRadius ?? DEFAULT_NAVIGATION.wanderRadius,
  };
}
