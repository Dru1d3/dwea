import { describe, expect, it } from 'vitest';
import { SPLAT_RECORD_BYTES, duplicateSplat, splatCountFromBytes } from './duplicate.js';

function makeOneSplat(x: number, y: number, z: number): Uint8Array {
  const buf = new Uint8Array(SPLAT_RECORD_BYTES);
  const view = new DataView(buf.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  // Scale (12..23): leave at zero. RGBA + quat (24..31): leave zero.
  return buf;
}

describe('duplicateSplat', () => {
  it('returns the source unchanged when tiles=1', () => {
    const src = makeOneSplat(1, 2, 3);
    const out = duplicateSplat(src, 1);
    expect(out.tiles).toBe(1);
    expect(out.splatCount).toBe(1);
    expect(out.bytes).toEqual(src);
  });

  it('quadruples the splat count when tiles=4 and translates onto a 2x2 grid', () => {
    const src = makeOneSplat(0, 0, 0);
    const out = duplicateSplat(src, 4, 10);
    expect(out.tiles).toBe(4);
    expect(out.splatCount).toBe(4);
    expect(out.bytes.byteLength).toBe(4 * SPLAT_RECORD_BYTES);

    const positions: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const view = new DataView(
        out.bytes.buffer,
        out.bytes.byteOffset + i * SPLAT_RECORD_BYTES,
        SPLAT_RECORD_BYTES,
      );
      positions.push([view.getFloat32(0, true), view.getFloat32(8, true)]);
    }
    // 2x2 grid centred on origin → corners are (-5,-5), (5,-5), (-5,5), (5,5).
    expect(positions).toEqual([
      [-5, -5],
      [5, -5],
      [-5, 5],
      [5, 5],
    ]);
  });

  it('leaves non-position fields byte-identical across tiles', () => {
    const src = new Uint8Array(SPLAT_RECORD_BYTES);
    const v = new DataView(src.buffer);
    // Position
    v.setFloat32(0, 1, true);
    v.setFloat32(4, 2, true);
    v.setFloat32(8, 3, true);
    // Scale
    v.setFloat32(12, 0.1, true);
    v.setFloat32(16, 0.2, true);
    v.setFloat32(20, 0.3, true);
    // RGBA + rotation quat
    src[24] = 0xaa;
    src[25] = 0xbb;
    src[26] = 0xcc;
    src[27] = 0xdd;
    src[28] = 1;
    src[29] = 2;
    src[30] = 3;
    src[31] = 4;

    const out = duplicateSplat(src, 4, 8);
    for (let i = 0; i < 4; i++) {
      const tail = out.bytes.subarray(i * SPLAT_RECORD_BYTES + 12, (i + 1) * SPLAT_RECORD_BYTES);
      // Bytes 12..31 are scale + rgba + quat — must be byte-identical.
      expect(Array.from(tail)).toEqual(Array.from(src.subarray(12)));
    }
  });

  it('rejects non-square tile counts', () => {
    const src = makeOneSplat(0, 0, 0);
    expect(() => duplicateSplat(src, 5)).toThrow(/perfect square/);
  });

  it('rejects payloads that are not a whole number of splats', () => {
    expect(() => duplicateSplat(new Uint8Array(31), 1)).toThrow(/multiple of 32/);
  });
});

describe('splatCountFromBytes', () => {
  it('floor-divides by 32', () => {
    expect(splatCountFromBytes(0)).toBe(0);
    expect(splatCountFromBytes(32)).toBe(1);
    expect(splatCountFromBytes(64)).toBe(2);
    expect(splatCountFromBytes(67)).toBe(2);
  });
});
