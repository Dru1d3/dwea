#!/usr/bin/env bash
#
# Add a rigged character GLB to public/characters/.
#
# Usage:
#   scripts/add-character.sh <id> <source-url-or-path>
#
# Examples:
#   scripts/add-character.sh robot-expressive \
#     https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/RobotExpressive/RobotExpressive.glb
#   scripts/add-character.sh shroom-knight ./bakes/shroom-knight.glb
#
# Conventions enforced:
#   - <id> is lowercase, alphanumeric + dashes (URL slug + registry key).
#   - Source must be a single .glb (not split .gltf + .bin). Embedded
#     AnimationClips are the deliverable; per-clip-file inputs need to be
#     merged with `gltf-transform merge` before this script is called.
#   - Validates GLB magic bytes, enforces the 10 MB acceptance bar from
#     docs/decisions/0006, prints a sha256 and points the caller at
#     `gltf-transform inspect` for clip names.
#
# v1 keeps storage local: assets ship inside the static deploy via Vite's
# `public/` copy. See docs/decisions/0003-asset-pipeline.md for when we move
# to object storage / CDN; the same migration applies here.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <id> <source-url-or-path>" >&2
  exit 64
fi

id="$1"
src="$2"

if [[ ! "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "error: <id> must be lowercase alphanumeric + dashes (got: $id)" >&2
  exit 64
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="$repo_root/public/characters"
mkdir -p "$out_dir"

ext="${src##*.}"
if [[ "$ext" != "glb" ]]; then
  echo "error: source must end in .glb (got .$ext); merge per-clip files with gltf-transform first" >&2
  exit 64
fi

dest="$out_dir/$id.glb"

if [[ -e "$dest" ]]; then
  echo "error: $dest already exists; remove it first or pick a new <id>" >&2
  exit 1
fi

case "$src" in
  http://* | https://*)
    echo "fetching $src ..."
    curl -fL --retry 3 --retry-delay 2 --max-time 600 -o "$dest" "$src"
    ;;
  *)
    if [[ ! -f "$src" ]]; then
      echo "error: local source not found: $src" >&2
      exit 1
    fi
    cp "$src" "$dest"
    ;;
esac

# GLB magic bytes: ASCII "glTF" in the first 4 bytes. A failed download saved
# as HTML or a misnamed .gltf would slip past the extension check otherwise.
magic=$(head -c 4 "$dest")
if [[ "$magic" != "glTF" ]]; then
  echo "error: $dest is not a valid GLB (magic bytes != 'glTF')" >&2
  rm -f "$dest"
  exit 1
fi

size_bytes=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest")
size_mb=$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b/1024/1024 }')
sha=$(sha256sum "$dest" | awk '{print $1}')

if (( size_bytes > 10 * 1024 * 1024 )); then
  echo "error: $dest is ${size_mb} MB, > 10 MB acceptance bar (see ADR 0006)" >&2
  rm -f "$dest"
  exit 1
fi

cat <<EOF

added: public/characters/$id.glb  ($size_mb MB, sha256 $sha)

Next steps:
  1. List embedded animations:
       npx --yes @gltf-transform/cli inspect public/characters/$id.glb
     Note the clip names; you'll paste them into the registry below.
  2. Register the asset in src/characters/registry.ts. Set 'source':
       { kind: 'public', path: 'characters/$id.glb' }
     Add a 'clips' array — one entry per AnimationClip, classified as
     locomotion | gesture | oneshot, with 'loop' set per clip.
  3. git add public/characters/$id.glb src/characters/registry.ts && commit.
EOF
