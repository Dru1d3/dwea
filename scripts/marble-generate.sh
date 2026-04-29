#!/usr/bin/env bash
#
# Generate a Marble (World Labs) world and print the resulting splat URLs.
#
# Usage:
#   MARBLE_API_KEY=... scripts/marble-generate.sh text  <slug> "<text prompt>"
#   MARBLE_API_KEY=... scripts/marble-generate.sh pano  <slug> "<image url>"  ["optional text guidance"]
#
# What it does:
#   1. POST /marble/v1/worlds:generate with the chosen prompt type and slug as display_name.
#   2. Poll GET /marble/v1/operations/{id} every 15s until done (~5 min typical).
#   3. Print the splat asset URLs (PLY full-res + SPZ variants) and the world id.
#
# What it does NOT do:
#   - Does not download the splat. Pipe the PLY url straight into scripts/add-splat.sh
#     once we extend that to accept .ply, or download manually.
#   - Does not commit the API key. MARBLE_API_KEY must come from the env.
#
# References:
#   - https://docs.worldlabs.ai/api/index.md (quickstart)
#   - https://docs.worldlabs.ai/api/reference/worlds/generate.md
#   - https://docs.worldlabs.ai/api/reference/operations/get.md

set -euo pipefail

usage() {
  cat <<'EOF'
usage:
  MARBLE_API_KEY=... scripts/marble-generate.sh text <slug> "<prompt>"
  MARBLE_API_KEY=... scripts/marble-generate.sh pano <slug> "<image-url>" ["text guidance"]

env:
  MARBLE_API_KEY    World Labs API key (required)
  MARBLE_MODEL      defaults to marble-1.1
  MARBLE_BASE_URL   defaults to https://api.worldlabs.ai
  MARBLE_POLL_SECS  defaults to 15
EOF
}

if [[ $# -lt 3 ]]; then
  usage >&2
  exit 64
fi

mode="$1"
slug="$2"
prompt="$3"
text_guidance="${4:-}"

if [[ -z "${MARBLE_API_KEY:-}" ]]; then
  echo "error: MARBLE_API_KEY is not set" >&2
  exit 64
fi

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "error: <slug> must be lowercase alphanumeric + dashes (got: $slug)" >&2
  exit 64
fi

base_url="${MARBLE_BASE_URL:-https://api.worldlabs.ai}"
model="${MARBLE_MODEL:-marble-1.1}"
poll_secs="${MARBLE_POLL_SECS:-15}"

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: missing required command: $cmd" >&2
    exit 1
  fi
done

case "$mode" in
  text)
    payload="$(jq -nc \
      --arg name "$slug" \
      --arg model "$model" \
      --arg p "$prompt" \
      '{display_name:$name, model:$model, world_prompt:{type:"text", text_prompt:$p}}')"
    ;;
  pano)
    payload="$(jq -nc \
      --arg name "$slug" \
      --arg model "$model" \
      --arg uri "$prompt" \
      --arg guidance "$text_guidance" \
      '{
        display_name:$name,
        model:$model,
        world_prompt:{
          type:"image",
          image_prompt:{source:"uri", uri:$uri, is_pano:true},
          text_prompt:(if $guidance == "" then null else $guidance end)
        } | walk(if type == "object" then with_entries(select(.value != null)) else . end)
      }')"
    ;;
  *)
    echo "error: mode must be 'text' or 'pano' (got: $mode)" >&2
    usage >&2
    exit 64
    ;;
esac

echo "submitting Marble generation: slug=$slug mode=$mode model=$model" >&2
echo "payload: $payload" >&2

submit_response="$(curl -fsS -X POST "$base_url/marble/v1/worlds:generate" \
  -H "WLT-Api-Key: $MARBLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload")"

operation_id="$(jq -er .operation_id <<<"$submit_response")"
echo "operation_id=$operation_id" >&2

start_ts=$(date +%s)
while :; do
  op="$(curl -fsS "$base_url/marble/v1/operations/$operation_id" \
    -H "WLT-Api-Key: $MARBLE_API_KEY")"
  done_flag="$(jq -r '.done // false' <<<"$op")"
  progress="$(jq -r '.metadata.progress // empty' <<<"$op")"
  elapsed=$(( $(date +%s) - start_ts ))
  echo "[t+${elapsed}s] done=$done_flag progress=$progress" >&2
  if [[ "$done_flag" == "true" ]]; then
    break
  fi
  sleep "$poll_secs"
done

err="$(jq -r '.error // empty' <<<"$op")"
if [[ -n "$err" && "$err" != "null" ]]; then
  echo "error: operation failed: $err" >&2
  echo "$op" >&2
  exit 1
fi

# Emit machine-friendly summary: world_id, ply_full_res_url, spz_500k_url, spz_full_res_url.
jq -e '{
  world_id: (.metadata.world_id // .response.world_id),
  ply_full_res: (.response.assets.splats.ply_urls.full_res // .response.assets.splats.ply_urls["full_res"] // null),
  ply_500k: (.response.assets.splats.ply_urls["500k"] // null),
  spz_full_res: (.response.assets.splats.spz_urls.full_res // null),
  spz_500k: (.response.assets.splats.spz_urls["500k"] // null),
  spz_100k: (.response.assets.splats.spz_urls["100k"] // null),
  raw: .response.assets
}' <<<"$op"
