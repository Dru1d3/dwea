#!/usr/bin/env node
//
// Convert a 3D Gaussian Splatting .ply (the standard form produced by Inria's
// trainer, World Labs Marble PLY export, and most third-party tools) into the
// drei-compatible .splat binary format (antimatter15 layout, 32 bytes/splat).
//
// Usage:
//   node scripts/ply-to-splat.mjs <input.ply> <output.splat>
//
// Notes:
//   - Input must be PLY 1.0, format binary_little_endian, with the standard
//     3DGS field set:
//       x, y, z, (nx, ny, nz?), f_dc_0..2, f_rest_*?, opacity,
//       scale_0..2, rot_0..3
//     Higher-order SH coefficients (f_rest_*) are ignored — drei <Splat>
//     consumes only the SH-C0 diffuse term.
//   - Output is the antimatter15/splat layout (see docs/decisions/0006).
//   - Pure-Node ESM, zero extra dependencies.
//
// References:
//   - https://github.com/antimatter15/splat (canonical .splat layout)
//   - https://docs.worldlabs.ai/marble/export/specs.md (Marble PLY spec)

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const SH_C0 = 0.28209479177387814;

if (argv.length !== 4) {
  console.error('usage: ply-to-splat.mjs <input.ply> <output.splat>');
  exit(64);
}

const [, , inPath, outPath] = argv;
const buf = await readFile(inPath);

// Parse ASCII header up to "end_header\n".
const headerEnd = buf.indexOf('\nend_header\n');
if (headerEnd < 0) throw new Error('not a ply file (no end_header)');
const header = buf.slice(0, headerEnd).toString('ascii');
const dataOffset = headerEnd + '\nend_header\n'.length;

const lines = header.split('\n').map((l) => l.trim());
if (lines[0] !== 'ply') throw new Error('missing magic "ply"');
const fmtLine = lines.find((l) => l.startsWith('format '));
if (!fmtLine || !fmtLine.includes('binary_little_endian')) {
  throw new Error(`only binary_little_endian supported (got: ${fmtLine ?? 'none'})`);
}

let count = 0;
const props = [];
let inVertex = false;
for (const l of lines) {
  if (l.startsWith('element vertex ')) {
    count = Number(l.split(' ')[2]);
    inVertex = true;
  } else if (l.startsWith('element ')) {
    inVertex = false;
  } else if (inVertex && l.startsWith('property ')) {
    const parts = l.split(' ');
    const type = parts[1];
    const name = parts.slice(2).join(' ');
    props.push({ type, name });
  }
}
if (!count) throw new Error('no vertex element in header');

const sizeOf = { float: 4, double: 8, uchar: 1, uint8: 1, char: 1, int: 4, uint: 4, short: 2, ushort: 2 };
let stride = 0;
const offsets = {};
for (const { type, name } of props) {
  const sz = sizeOf[type];
  if (!sz) throw new Error(`unsupported property type: ${type}`);
  offsets[name] = { offset: stride, type };
  stride += sz;
}
for (const need of ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
  if (!(need in offsets)) throw new Error(`PLY missing required property: ${need}`);
}

const expectedBytes = count * stride;
const actualBytes = buf.length - dataOffset;
if (actualBytes < expectedBytes) {
  throw new Error(`PLY truncated: expected ${expectedBytes} bytes, got ${actualBytes}`);
}

const view = new DataView(buf.buffer, buf.byteOffset + dataOffset, expectedBytes);

const readProp = (i, name) => {
  const { offset, type } = offsets[name];
  const at = i * stride + offset;
  switch (type) {
    case 'float': return view.getFloat32(at, true);
    case 'double': return view.getFloat64(at, true);
    case 'uchar': case 'uint8': return view.getUint8(at);
    case 'char': return view.getInt8(at);
    case 'int': return view.getInt32(at, true);
    case 'uint': return view.getUint32(at, true);
    case 'short': return view.getInt16(at, true);
    case 'ushort': return view.getUint16(at, true);
    default: throw new Error(`unsupported type: ${type}`);
  }
};

const out = new Uint8Array(count * 32);
const outView = new DataView(out.buffer);

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

for (let i = 0; i < count; i++) {
  const px = readProp(i, 'x');
  const py = readProp(i, 'y');
  const pz = readProp(i, 'z');

  const sx = Math.exp(readProp(i, 'scale_0'));
  const sy = Math.exp(readProp(i, 'scale_1'));
  const sz = Math.exp(readProp(i, 'scale_2'));

  const fr = readProp(i, 'f_dc_0');
  const fg = readProp(i, 'f_dc_1');
  const fb = readProp(i, 'f_dc_2');
  const r = clamp01(0.5 + SH_C0 * fr) * 255;
  const g = clamp01(0.5 + SH_C0 * fg) * 255;
  const b = clamp01(0.5 + SH_C0 * fb) * 255;
  const a = clamp01(sigmoid(readProp(i, 'opacity'))) * 255;

  // 3DGS PLY rotation order is (rot_0, rot_1, rot_2, rot_3) = (w, x, y, z).
  let qw = readProp(i, 'rot_0');
  let qx = readProp(i, 'rot_1');
  let qy = readProp(i, 'rot_2');
  let qz = readProp(i, 'rot_3');
  const ql = Math.hypot(qw, qx, qy, qz) || 1;
  qw /= ql; qx /= ql; qy /= ql; qz /= ql;

  const base = i * 32;
  outView.setFloat32(base + 0, px, true);
  outView.setFloat32(base + 4, py, true);
  outView.setFloat32(base + 8, pz, true);
  outView.setFloat32(base + 12, sx, true);
  outView.setFloat32(base + 16, sy, true);
  outView.setFloat32(base + 20, sz, true);
  out[base + 24] = Math.round(r);
  out[base + 25] = Math.round(g);
  out[base + 26] = Math.round(b);
  out[base + 27] = Math.round(a);
  out[base + 28] = Math.max(0, Math.min(255, Math.round(qw * 128 + 128)));
  out[base + 29] = Math.max(0, Math.min(255, Math.round(qx * 128 + 128)));
  out[base + 30] = Math.max(0, Math.min(255, Math.round(qy * 128 + 128)));
  out[base + 31] = Math.max(0, Math.min(255, Math.round(qz * 128 + 128)));
}

await writeFile(outPath, out);
console.error(`wrote ${outPath}: ${count} splats, ${out.byteLength} bytes`);
