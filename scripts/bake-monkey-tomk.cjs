#!/usr/bin/env node
/*
 * Bake public/characters/monkey-tomk.glb from the OpenGameArt source.
 *
 * One-off, reproducible asset bake. Use this when:
 *   - someone needs to verify the GLB matches the OGA upstream
 *   - the bake recipe changes (e.g. we resize textures, swap clip names)
 *   - the upstream archive is re-exported with a new animation
 *
 * Why a script and not just a README: the FBX→GLB step uses assimpjs (a WASM
 * port of Open Asset Import Library) because Facebook's prebuilt FBX2glTF only
 * ships x86_64 binaries and our agent runtime is aarch64. Pinning the bake
 * details in code keeps that environmental quirk out of contributors' way.
 *
 * Usage:
 *   node scripts/bake-monkey-tomk.cjs
 *
 * Side effects:
 *   - downloads ~10 MB OGA archive into a temp dir
 *   - npm-installs assimpjs into a temp dir (~3 MB)
 *   - writes public/characters/monkey-tomk.glb
 *
 * No project deps are added — the script handles its own scratch dir. See ADR
 * 0009 and public/characters/monkey-tomk.LICENSE.txt for the source of truth.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execSync } = require('node:child_process');

const SOURCE_URL = 'https://opengameart.org/sites/default/files/Monkey_animated.zip';
const REPO_ROOT = path.resolve(__dirname, '..');
const DEST_GLB = path.join(REPO_ROOT, 'public/characters/monkey-tomk.glb');
const ANIM_RENAME = { 'Take 001': 'Dance' };

function fetchToFile(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          fetchToFile(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`fetch ${url}: HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

function unzipTo(zipPath, destDir) {
  // node has no built-in unzip; rely on `python3 -m zipfile` which ships in
  // every distro we care about (and in the dev container the agent runs in).
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`python3 -m zipfile -e ${JSON.stringify(zipPath)} ${JSON.stringify(destDir)}`);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monkey-bake-'));
  console.info('scratch dir:', tmp);

  const zipPath = path.join(tmp, 'Monkey_animated.zip');
  console.info('fetching', SOURCE_URL);
  await fetchToFile(SOURCE_URL, zipPath);
  console.info('  ->', zipPath, fs.statSync(zipPath).size, 'bytes');

  const extractDir = path.join(tmp, 'oga');
  unzipTo(zipPath, extractDir);
  const fbxPath = path.join(extractDir, 'monkey.FBX');
  if (!fs.existsSync(fbxPath)) throw new Error('expected monkey.FBX in archive');

  // Install assimpjs into the scratch dir so we don't pollute the project's
  // package.json with a dev-only converter.
  console.info('installing assimpjs into scratch dir');
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"private": true}');
  execSync('npm install --silent --no-save assimpjs', { cwd: tmp, stdio: 'inherit' });

  // FBX -> GLB
  const assimpjs = require(path.join(tmp, 'node_modules/assimpjs/dist/assimpjs.js'))();
  const ajs = await assimpjs;
  const fileList = new ajs.FileList();
  fileList.AddFile('monkey.FBX', fs.readFileSync(fbxPath));
  for (const tex of [
    'body_u1_v1.png',
    'body_u2_v1.png',
    'eyes_u2_v1.png',
    'head_u1_v1.png',
    'NormalMap.png',
    'NormalMap2.png',
    'NormalMap3.png',
  ]) {
    const p = path.join(extractDir, tex);
    if (fs.existsSync(p)) fileList.AddFile(tex, fs.readFileSync(p));
  }
  const result = ajs.ConvertFileList(fileList, 'glb2');
  if (!result.IsSuccess() || result.FileCount() === 0) {
    throw new Error(`assimpjs failed: ${result.GetErrorCode()}`);
  }
  const rawGlb = Buffer.from(result.GetFile(0).GetContent());
  const rawGlbPath = path.join(tmp, 'monkey-raw.glb');
  fs.writeFileSync(rawGlbPath, rawGlb);
  console.info('assimpjs wrote', rawGlb.length, 'bytes →', rawGlbPath);

  // Re-pack: assimpjs leaves textures as external "..\\textures\\..." URIs and
  // labels the lone animation "Take 001". Embed images, rename the clip, and
  // emit a self-contained GLB.
  const buf = rawGlb;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonChunkLen = dv.getUint32(12, true);
  const jsonText = buf.slice(20, 20 + jsonChunkLen).toString('utf8');
  const j = JSON.parse(jsonText);
  const binChunkStart = 20 + jsonChunkLen;
  const binChunkLen = dv.getUint32(binChunkStart, true);
  const binData = Buffer.from(buf.slice(binChunkStart + 8, binChunkStart + 8 + binChunkLen));

  for (const a of j.animations || []) {
    if (ANIM_RENAME[a.name]) {
      console.info(`renaming animation ${a.name} → ${ANIM_RENAME[a.name]}`);
      a.name = ANIM_RENAME[a.name];
    }
  }

  const chunks = [binData];
  let offset = binData.length;
  for (const img of j.images || []) {
    if (!img.uri) continue;
    const basename = img.uri.replace(/\\/g, '/').split('/').pop();
    const data = fs.readFileSync(path.join(extractDir, basename));
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    j.bufferViews = j.bufferViews || [];
    const bvIdx =
      j.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length }) - 1;
    img.bufferView = bvIdx;
    img.mimeType = basename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    img.uri = undefined;
    chunks.push(data);
    offset += data.length;
    console.info(`embedded ${basename} (${data.length} bytes)`);
  }
  const newBin = Buffer.concat(chunks);
  const finalPad = (4 - (newBin.length % 4)) % 4;
  const newBinPadded = finalPad === 0 ? newBin : Buffer.concat([newBin, Buffer.alloc(finalPad)]);
  j.buffers[0].byteLength = newBinPadded.length;

  let newJson = JSON.stringify(j);
  while (newJson.length % 4 !== 0) newJson += ' ';
  const jsonBuf = Buffer.from(newJson, 'utf8');

  const totalLen = 12 + 8 + jsonBuf.length + 8 + newBinPadded.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0); // "glTF"
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(newBinPadded.length, 20 + jsonBuf.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonBuf.length); // "BIN\0"
  newBinPadded.copy(out, 28 + jsonBuf.length);

  fs.writeFileSync(DEST_GLB, out);
  console.info(`wrote ${DEST_GLB} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
