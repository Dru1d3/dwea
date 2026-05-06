/**
 * Per-asset, per-browser scene transform overrides. Used by the in-page
 * `<SceneTuner>` so the board can dial in the right rotation/position/scale
 * for each splat without an engineer round-trip. Saved values are absolute —
 * when present, they fully replace the registry transform AND bypass the
 * ground auto-fit. Reset clears the override and returns to the auto-fit /
 * registry defaults.
 */

const STORAGE_PREFIX = 'dwea.tuning.v1.';

export type Tuning = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: number;
};

export function loadTuning(assetId: string): Tuning | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + assetId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tuning>;
    if (!isVec3(parsed.position) || !isVec3(parsed.rotation) || typeof parsed.scale !== 'number') {
      return null;
    }
    return {
      position: parsed.position,
      rotation: parsed.rotation,
      scale: parsed.scale,
    };
  } catch {
    return null;
  }
}

export function saveTuning(assetId: string, t: Tuning): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX + assetId, JSON.stringify(t));
  } catch {
    // Quota / privacy mode — silent. The tuner reads its current value from
    // React state, persistence is best-effort.
  }
}

export function clearTuning(assetId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + assetId);
  } catch {
    // ignored
  }
}

function isVec3(v: unknown): v is readonly [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

/**
 * Format a Tuning as a JS literal that can be pasted into
 * `src/splats/registry.ts` as the asset's `transform`. Rotation values are
 * rounded to 4 decimal places for legibility.
 */
export function formatAsTransformLiteral(t: Tuning): string {
  const r = (n: number) => Number(n.toFixed(4));
  return [
    'transform: {',
    `  scale: ${r(t.scale)},`,
    `  position: [${r(t.position[0])}, ${r(t.position[1])}, ${r(t.position[2])}],`,
    `  rotation: [${r(t.rotation[0])}, ${r(t.rotation[1])}, ${r(t.rotation[2])}],`,
    '},',
  ].join('\n');
}
