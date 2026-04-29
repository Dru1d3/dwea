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
#     taken from the source. .splat and .ksplat are accepted; anything else
#     fails fast.
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

# Resolve extension from source.
ext="${src##*.}"
case "$ext" in
  splat | ksplat) ;;
  *)
    echo "error: source must end in .splat or .ksplat (got .$ext)" >&2
    exit 64
    ;;
esac

dest="$out_dir/$id.$ext"

if [[ -e "$dest" ]]; then
  echo "error: $dest already exists; remove it first or pick a new <id>" >&2
  exit 1
fi

case "$src" in
  http://* | https://*)
    echo "fetching $src ..."
    # -L follow redirects (HF resolve URLs redirect to a CDN), -f fail on 4xx/5xx.
    curl -fL --retry 3 --retry-delay 2 --max-time 300 -o "$dest" "$src"
    ;;
  *)
    if [[ ! -f "$src" ]]; then
      echo "error: local source not found: $src" >&2
      exit 1
    fi
    cp "$src" "$dest"
    ;;
esac

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

added: public/splats/$id.$ext  ($size_mb MB, sha256 $sha)

Next steps:
  1. Register the asset in src/splats/registry.ts:

       {
         id: '$id',
         label: '$id',
         url: '/splats/$id.$ext',
       },

  2. Visit it locally at http://localhost:5173/#/$id (pnpm dev).
  3. git add public/splats/$id.$ext src/splats/registry.ts && commit.
EOF
