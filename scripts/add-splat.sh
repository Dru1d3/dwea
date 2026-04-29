#!/usr/bin/env bash
#
# Add a gaussian-splat asset to public/splats/.
#
# Usage:
#   scripts/add-splat.sh <id> <source-url-or-path>
#
# Examples:
#   scripts/add-splat.sh plush https://huggingface.co/cakewalk/splat-data/resolve/main/plush.splat
#   scripts/add-splat.sh ./captures/livingroom.splat
#
# Conventions enforced by this script:
#   - <id> is lowercase, alphanumeric + dashes (used in URLs and registry keys).
#   - The asset is copied verbatim to public/splats/<id>.<ext>, where <ext> is
#     taken from the source. .splat and .ksplat are accepted directly; .ply
#     is converted to .splat via scripts/ply-to-splat.mjs and the .splat is
#     what gets stored. Anything else fails fast.
#   - We hash the file (sha256) and print a registry stub the caller can paste
#     into src/splats/registry.ts.
#
# v1 keeps the storage location simple: assets live in /public/ and ship with
# the static deploy. See docs/decisions/0003-asset-pipeline.md for when we
# move to object storage / CDN.

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
out_dir="$repo_root/public/splats"
mkdir -p "$out_dir"

# Resolve extension from source. Strip query/fragment for URL sources so
# signed-URL params (Marble emits them) do not confuse the extension match.
src_clean="${src%%\?*}"
src_clean="${src_clean%%\#*}"
ext="${src_clean##*.}"
ext="${ext,,}"
case "$ext" in
  splat | ksplat | ply) ;;
  *)
    echo "error: source must end in .splat, .ksplat, or .ply (got .$ext)" >&2
    exit 64
    ;;
esac

# Stored extension is always one of .splat / .ksplat. .ply is converted.
stored_ext="$ext"
if [[ "$ext" == "ply" ]]; then
  stored_ext="splat"
fi
dest="$out_dir/$id.$stored_ext"

if [[ -e "$dest" ]]; then
  echo "error: $dest already exists; remove it first or pick a new <id>" >&2
  exit 1
fi

if [[ "$ext" == "ply" ]]; then
  staged="$(mktemp -t add-splat.XXXXXX.ply)"
  trap 'rm -f "$staged"' EXIT
else
  staged="$dest"
fi

case "$src" in
  http://* | https://*)
    echo "fetching $src ..."
    # -L follow redirects (HF resolve URLs redirect to a CDN), -f fail on 4xx/5xx.
    # --max-time bumped to 900 because Marble PLY exports can be ~200 MB.
    curl -fL --retry 3 --retry-delay 2 --max-time 900 -o "$staged" "$src"
    ;;
  *)
    if [[ ! -f "$src" ]]; then
      echo "error: local source not found: $src" >&2
      exit 1
    fi
    cp "$src" "$staged"
    ;;
esac

if [[ "$ext" == "ply" ]]; then
  echo "converting PLY -> SPLAT via scripts/ply-to-splat.mjs ..."
  node "$repo_root/scripts/ply-to-splat.mjs" "$staged" "$dest"
fi

# Sanity-check size: a misconfigured Hugging Face URL or a 404 page would
# cheerfully save as a tiny HTML file. Reject anything below 1 KB.
size_bytes=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest")
if (( size_bytes < 1024 )); then
  echo "error: $dest is only $size_bytes bytes; download likely failed" >&2
  rm -f "$dest"
  exit 1
fi

sha=$(sha256sum "$dest" | awk '{print $1}')
size_mb=$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b/1024/1024 }')

cat <<EOF

added: public/splats/$id.$stored_ext  ($size_mb MB, sha256 $sha)

Next steps:
  1. Register the asset in src/splats/registry.ts:

       {
         id: '$id',
         label: '$id',
         source: { kind: 'public', path: 'splats/$id.$stored_ext' },
       },

  2. Visit it locally at http://localhost:5173/#/$id (pnpm dev).
  3. git add public/splats/$id.$stored_ext src/splats/registry.ts && commit.
EOF
