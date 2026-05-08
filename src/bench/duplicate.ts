/**
 * Splat-asset duplicator. Tiles the same `.splat` payload N copies on a square
 * grid so a low-density source asset (e.g. our `plush.splat` ~280 k splats) can
 * stress-test a runtime at the LOD0 target of ~1 M splats without forcing a
 * second multi-megabyte fixture into the repo.
 *
 * The `.splat` format we consume is the de-facto Niedermayr / Kellogg layout:
 * 32 bytes per splat, packed as
 *   - 12 B vec3 position (f32 little-endian)
 *   - 12 B vec3 scale    (f32 LE)
 *   - 4  B rgba8         (u8)
 *   - 4  B rotation quat (u8 byte-packed)
 *
 * We translate the position component for each tile and copy the rest verbatim.
 */

export const SPLAT_RECORD_BYTES = 32;
const POSITION_OFFSET = 0;

export type DuplicateResult = {
  readonly bytes: Uint8Array;
  readonly splatCount: number;
  readonly tiles: number;
  readonly perTileSplats: number;
  readonly tileSpacingMeters: number;
};

/**
 * Duplicate a `.splat` payload onto a (sqrt(tiles))² tile grid spaced
 * `spacingMeters` apart.
 *
 * @param source      Original `.splat` bytes.
 * @param tiles       Total tile count. Must be a perfect square (1, 4, 9, 16…)
 *                    and ≥ 1. Tile 0 is the original, untranslated payload.
 * @param spacingMeters Grid spacing in metres. Defaults to 4 m which keeps
 *                    tiles distinct without isolating them on screen.
 */
export function duplicateSplat(
  source: ArrayBuffer | Uint8Array,
  tiles: number,
  spacingMeters = 4,
): DuplicateResult {
  if (!Number.isInteger(tiles) || tiles < 1) {
    throw new Error(`duplicateSplat: tiles must be a positive integer, got ${tiles}`);
  }
  const side = Math.sqrt(tiles);
  if (!Number.isInteger(side)) {
    throw new Error(`duplicateSplat: tiles (${tiles}) must be a perfect square`);
  }
  const src = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (src.byteLength % SPLAT_RECORD_BYTES !== 0) {
    throw new Error(
      `duplicateSplat: source length ${src.byteLength} is not a multiple of ${SPLAT_RECORD_BYTES}`,
    );
  }
  const perTile = src.byteLength / SPLAT_RECORD_BYTES;
  const out = new Uint8Array(src.byteLength * tiles);

  // Centre the grid on the origin so the orbit camera sees the whole thing.
  const half = (side - 1) / 2;

  for (let ti = 0; ti < tiles; ti++) {
    const gx = ti % side;
    const gz = Math.floor(ti / side);
    const dx = (gx - half) * spacingMeters;
    const dz = (gz - half) * spacingMeters;
    const dstStart = ti * src.byteLength;
    out.set(src, dstStart);
    if (dx === 0 && dz === 0) continue;
    // Translate every splat's position component by (dx, 0, dz).
    const view = new DataView(out.buffer, out.byteOffset + dstStart, src.byteLength);
    for (let s = 0; s < perTile; s++) {
      const off = s * SPLAT_RECORD_BYTES + POSITION_OFFSET;
      view.setFloat32(off + 0, view.getFloat32(off + 0, true) + dx, true);
      view.setFloat32(off + 8, view.getFloat32(off + 8, true) + dz, true);
    }
  }

  return {
    bytes: out,
    splatCount: perTile * tiles,
    tiles,
    perTileSplats: perTile,
    tileSpacingMeters: spacingMeters,
  };
}

export function splatCountFromBytes(bytes: number): number {
  return Math.floor(bytes / SPLAT_RECORD_BYTES);
}
