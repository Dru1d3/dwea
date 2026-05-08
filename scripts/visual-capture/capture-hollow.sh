#!/usr/bin/env bash
# scripts/visual-capture/capture-hollow.sh
#
# Operator script: capture the DWEA-62 acceptance pair (The Hollow,
# `#/garden`) — before vs. after stripping the relight rig.
#
# Designed to be runnable by a board operator on macOS or any Linux host
# that already has a usable Chromium for Playwright (Apple Silicon Macs:
# `npx playwright install chromium chromium-headless-shell` works out of
# the box; bare-metal Linux: see scripts/visual-capture/README.md).
#
# Run with no arguments from the repo root:
#
#   ./scripts/visual-capture/capture-hollow.sh
#
# Outputs (relative to repo root):
#   artifacts/dwea-62/hollow-before.png  — `origin/main` (legacy ambient/hemi/dir/<Sky> rig)
#   artifacts/dwea-62/hollow-after.png   — this branch (LightingStory + rim light)
#
# Both PNGs are at 1280×800, UI chrome hidden, splat allowed 14 s of
# settle time after networkidle. Attach both to PR #15 / DWEA-62.

set -euo pipefail

# Resolve the repo root so the script is location-agnostic.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ART_DIR="${REPO_ROOT}/artifacts/dwea-62"
BEFORE_PNG="${ART_DIR}/hollow-before.png"
AFTER_PNG="${ART_DIR}/hollow-after.png"

PORT_AFTER=4279
PORT_BEFORE=4280
SCENE="garden"     # `garden` is the splat-registry id wired to archetype `hollow` (The Hollow).
VIEWPORT="1280x800"
SETTLE_MS=14000    # bump if splat is still densifying when the snapshot fires.

mkdir -p "${ART_DIR}"

# --- helpers ----------------------------------------------------------------

log() { printf '\n[capture-hollow] %s\n' "$*" >&2; }

ensure_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required (the repo pins pnpm@10.x via packageManager). Install via corepack: \`corepack enable && corepack prepare pnpm@10.33.2 --activate\`." >&2
    exit 65
  fi
}

require_clean_branch() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "${branch}" != "dwea-62-lighting-strip" ]; then
    echo "Run this from the dwea-62-lighting-strip branch (you are on '${branch}'). The 'after' frame must come from the branch under review." >&2
    exit 65
  fi
}

start_preview() {
  local dir="$1" port="$2" log_file="$3" pid_var="$4"
  log "building ${dir} …"
  ( cd "${dir}" && pnpm install --frozen-lockfile && pnpm build ) >"${log_file}.build" 2>&1
  log "starting preview on :${port} (logs: ${log_file})"
  ( cd "${dir}" && pnpm preview --port "${port}" --strictPort ) >"${log_file}" 2>&1 &
  local pid=$!
  printf -v "${pid_var}" '%s' "${pid}"
  # Wait for vite to serve.
  local tries=0
  until curl -sf "http://localhost:${port}/" -o /dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "${tries}" -gt 60 ]; then
      echo "preview on :${port} did not come up in 60s — see ${log_file}" >&2
      kill "${pid}" 2>/dev/null || true
      exit 70
    fi
    sleep 1
  done
  log "preview on :${port} is up"
}

cleanup() {
  for pid in "${PID_AFTER:-}" "${PID_BEFORE:-}"; do
    [ -n "${pid}" ] && kill "${pid}" 2>/dev/null || true
  done
  if [ -n "${MAIN_WORKTREE:-}" ] && [ -d "${MAIN_WORKTREE}" ]; then
    log "removing temporary worktree ${MAIN_WORKTREE}"
    git worktree remove --force "${MAIN_WORKTREE}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- run --------------------------------------------------------------------

ensure_pnpm
require_clean_branch

# 1. AFTER preview (this branch).
start_preview "${REPO_ROOT}" "${PORT_AFTER}" "/tmp/dwea62-preview-after.log" PID_AFTER

# 2. BEFORE preview (origin/main worktree).
MAIN_WORKTREE="$(mktemp -d -t dwea62-before-XXXXXX)/repo"
log "creating main worktree at ${MAIN_WORKTREE}"
git fetch origin main --quiet
git worktree add "${MAIN_WORKTREE}" origin/main >/dev/null
start_preview "${MAIN_WORKTREE}" "${PORT_BEFORE}" "/tmp/dwea62-preview-before.log" PID_BEFORE

# 3. Capture both frames via the shared harness.
log "capturing AFTER → ${AFTER_PNG}"
node scripts/visual-capture/capture.mjs \
  --url "http://localhost:${PORT_AFTER}" \
  --scene "${SCENE}" \
  --out "${AFTER_PNG}" \
  --viewport "${VIEWPORT}" \
  --settle-ms "${SETTLE_MS}"

log "capturing BEFORE → ${BEFORE_PNG}"
node scripts/visual-capture/capture.mjs \
  --url "http://localhost:${PORT_BEFORE}" \
  --scene "${SCENE}" \
  --out "${BEFORE_PNG}" \
  --viewport "${VIEWPORT}" \
  --settle-ms "${SETTLE_MS}"

log "done. attach the two PNGs below to PR #15 / DWEA-62:"
echo "  ${BEFORE_PNG}"
echo "  ${AFTER_PNG}"
