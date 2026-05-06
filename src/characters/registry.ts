/**
 * Typed registry of NPC character GLBs. Mirrors `src/splats/registry.ts` so a
 * caller can `findCharacter(id)` and resolve the URL the same way regardless
 * of whether the asset ships from `public/` or a remote URL.
 *
 * The `clips` array names the AnimationClips embedded in the GLB. Downstream
 * code (T2 r3f runtime, T3 LLM motor) targets clips by id — keep these in
 * sync with the GLB itself; verify with `npx @gltf-transform/cli inspect
 * public/characters/<id>.glb` before changing.
 *
 * See docs/decisions/0006-character-asset-pipeline.md for the v1 path-C stub
 * decision and the constraints that forced the deviation from `plan` rev 1.
 */

export type CharacterAsset = {
  readonly id: string;
  readonly label: string;
  readonly source: CharacterSource;
  readonly credit?: string;
  readonly clips: readonly CharacterClip[];
  readonly defaultClipId: string;
};

export type CharacterSource =
  | { readonly kind: 'public'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string };

/**
 * Coarse semantic classification of an animation clip. Used by the LLM motor
 * (T3, DWEA-18) to map the 5-tool schema's `play_animation(clip_id, mode)`
 * onto a sensible default for `mode` when the model omits it: locomotion
 * loops, gestures and one-shots play once.
 */
export type CharacterClipKind = 'locomotion' | 'gesture' | 'oneshot';

export type CharacterClip = {
  /** Must match the AnimationClip name baked into the GLB. */
  readonly id: string;
  readonly label: string;
  readonly kind: CharacterClipKind;
  readonly loop: boolean;
};

export const characterRegistry: readonly CharacterAsset[] = [
  {
    id: 'monkey-tomk',
    label: 'Monkey (tomk)',
    source: { kind: 'public', path: 'characters/monkey-tomk.glb' },
    credit:
      'Monkey 3D model by tomk. CC0 1.0 Universal (public domain). Sourced from OpenGameArt (https://opengameart.org/content/monkey-3d-model-rigged-fbx). FBX→GLB bake via assimpjs; original "Take 001" clip relabeled as Dance — see ADR 0009 and public/characters/monkey-tomk.LICENSE.txt.',
    clips: [{ id: 'Dance', label: 'Dance', kind: 'oneshot', loop: true }],
    defaultClipId: 'Dance',
  },
  {
    id: 'robot-expressive',
    label: 'Robot (Expressive)',
    source: { kind: 'public', path: 'characters/robot-expressive.glb' },
    credit:
      'RobotExpressive by Tomás Laulhé (Quaternius), modifications by Don McCurdy. CC0 1.0 Universal (public domain). Sourced from three.js examples.',
    clips: [
      { id: 'Idle', label: 'Idle', kind: 'locomotion', loop: true },
      { id: 'Walking', label: 'Walk', kind: 'locomotion', loop: true },
      { id: 'Running', label: 'Run', kind: 'locomotion', loop: true },
      { id: 'Jump', label: 'Jump', kind: 'oneshot', loop: false },
      { id: 'WalkJump', label: 'Walk-jump', kind: 'oneshot', loop: false },
      { id: 'Wave', label: 'Wave', kind: 'gesture', loop: false },
      { id: 'ThumbsUp', label: 'Thumbs up', kind: 'gesture', loop: false },
      { id: 'Yes', label: 'Nod yes', kind: 'gesture', loop: false },
      { id: 'No', label: 'Shake no', kind: 'gesture', loop: false },
      { id: 'Sitting', label: 'Sitting', kind: 'gesture', loop: true },
      { id: 'Standing', label: 'Standing', kind: 'gesture', loop: true },
      { id: 'Punch', label: 'Punch', kind: 'oneshot', loop: false },
      { id: 'Dance', label: 'Dance', kind: 'oneshot', loop: true },
      { id: 'Death', label: 'Death', kind: 'oneshot', loop: false },
    ],
    defaultClipId: 'Idle',
  },
] as const;

/**
 * The active default. T6 (DWEA-24) flipped this from `robot-expressive` to
 * `monkey-tomk` because the board explicitly requested a dancing monkey on
 * DWEA-22. Robot stays in the registry as a fallback — its rich gesture
 * library (Wave / Yes / No / Sitting / …) is still useful for tests and for
 * any scene that wants the wider clip set while the monkey carries only the
 * Dance clip in its v1 bake. See ADR 0009 for the asset choice and the
 * single-animation caveat.
 */
export const defaultCharacterId: CharacterAsset['id'] = 'monkey-tomk';

export function findCharacter(id: string): CharacterAsset | undefined {
  return characterRegistry.find((c) => c.id === id);
}

/**
 * Resolve the runtime URL for a character asset. `kind: 'public'` paths are
 * prefixed with Vite's `import.meta.env.BASE_URL` so GitHub Pages
 * (`/<repo>/`) and Vercel (`/`) both work without per-host code changes.
 */
export function resolveCharacterUrl(asset: CharacterAsset, baseUrl: string): string {
  if (asset.source.kind === 'remote') {
    return asset.source.url;
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${asset.source.path}`;
}

export function findClip(asset: CharacterAsset, id: string): CharacterClip | undefined {
  return asset.clips.find((c) => c.id === id);
}
