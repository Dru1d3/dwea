export type SplatAsset = {
  readonly id: string;
  readonly label: string;
  readonly source: SplatSource;
  readonly credit?: string;
  readonly transform?: SplatTransform;
  readonly navigation?: SplatNavigation;
};

export type SplatSource =
  | { readonly kind: 'public'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string };

/**
 * Per-scene transform applied to the rendered splat group. All fields are
 * optional and fall back to the renderer defaults (see DEFAULT_TRANSFORM).
 *
 * `rotation` is Euler XYZ in radians. The renderer already needs `[Math.PI, 0, 0]`
 * for the legacy cakewalk/splat-data convention (Y-down → Y-up); the transform
 * here REPLACES that wrapper, so any new asset must include the flip if needed.
 */
export type SplatTransform = {
  readonly scale?: number;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
};

/**
 * Per-scene navigation tuning. Overrides the global defaults in
 * `src/npc/movement.ts` so a small staged scene (plush) and a sprawling
 * outdoor splat (garden) can each feel right at default camera.
 */
export type SplatNavigation = {
  /** World Y of the ground plane / grid for this scene. */
  readonly groundY?: number;
  /** Where Mara spawns on a fresh load (XZ). */
  readonly npcSpawn?: { readonly x: number; readonly z: number };
  /** Radius of the click-to-walk disk centred on origin. */
  readonly clickRadius?: number;
  /** Wander radius around origin used by the idle wander timer. */
  readonly wanderRadius?: number;
};

export const DEFAULT_TRANSFORM = {
  scale: 1,
  position: [0, 0, 0] as const,
  // cakewalk/splat-data convention: stored Y-down, flipped here to Y-up.
  rotation: [Math.PI, 0, 0] as const,
};

export const DEFAULT_NAVIGATION = {
  groundY: -1.6,
  npcSpawn: { x: -1.2, z: 1.2 },
  clickRadius: 6,
  wanderRadius: 1.5,
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
      // Mip-NeRF 360 captures are ~real-world metric; scale down to fit our orbit.
      scale: 0.45,
      position: [0, -1.6, 0],
      rotation: [Math.PI, 0, 0],
    },
    navigation: {
      groundY: -1.6,
      npcSpawn: { x: 0.0, z: 0.6 },
      clickRadius: 7,
      wanderRadius: 2.4,
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
      scale: 0.45,
      position: [0, -1.6, 0],
      rotation: [Math.PI, 0, 0],
    },
    navigation: {
      groundY: -1.6,
      npcSpawn: { x: 0.0, z: 0.6 },
      clickRadius: 7,
      wanderRadius: 2.4,
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
  },
  {
    id: 'plush',
    label: 'Plush toy',
    source: { kind: 'public', path: 'splats/plush.splat' },
    credit:
      'cakewalk/splat-data on Hugging Face — derived from the 3D Gaussian Splatting paper test scenes. Research/demo use; replace before commercial deployment.',
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

export function resolveNavigation(asset: SplatAsset): Required<SplatNavigation> {
  const n = asset.navigation ?? {};
  return {
    groundY: n.groundY ?? DEFAULT_NAVIGATION.groundY,
    npcSpawn: n.npcSpawn ?? DEFAULT_NAVIGATION.npcSpawn,
    clickRadius: n.clickRadius ?? DEFAULT_NAVIGATION.clickRadius,
    wanderRadius: n.wanderRadius ?? DEFAULT_NAVIGATION.wanderRadius,
  };
}
