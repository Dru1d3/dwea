#!/usr/bin/env bash
# sigma-log-gate.sh — M1 launch deploy-gate guard.
#
# Reads docs/architecture/observability/sigma_log_verdict.json (or the path passed
# as $1) and exits:
#   0  on GREEN_500 or GREEN_500_FLAG
#   2  on RED_1000, missing file, malformed file, or unknown verdict
#
# Fail-closed: anything other than an explicit GREEN verdict blocks the launch.
#
# References: DWEA-95 (source decision) -> DWEA-97 (scaffolding) -> DWEA-99
# (Grafana panels + CI workflow). State machine spec: sigma-log-verdict-state.md.
set -u
set -o pipefail

usage() {
  cat <<'USAGE'
sigma-log-gate.sh [<verdict-json-path>]

Exits 0 on GREEN_500 / GREEN_500_FLAG, 2 otherwise. Defaults the path to
docs/architecture/observability/sigma_log_verdict.json relative to the repo root.

Examples:
  sigma-log-gate.sh
  sigma-log-gate.sh path/to/sigma_log_verdict.json
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

# Resolve repo root so the default path works regardless of CWD when invoked.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_path="${script_dir}/sigma_log_verdict.json"
verdict_path="${1:-${default_path}}"

if [[ ! -f "${verdict_path}" ]]; then
  echo "sigma-log-gate: verdict file missing at ${verdict_path} — fail-closed." >&2
  exit 2
fi

# Extract verdict without depending on jq (CI runners may not have it).
# The verdict field is the only string field whose value is one of the three
# enum values, so a tolerant grep is safe for v1.
verdict="$(
  grep -oE '"verdict"[[:space:]]*:[[:space:]]*"[A-Z0-9_]+"' "${verdict_path}" \
    | head -n1 \
    | sed -E 's/.*"verdict"[[:space:]]*:[[:space:]]*"([A-Z0-9_]+)".*/\1/'
)"

if [[ -z "${verdict}" ]]; then
  echo "sigma-log-gate: could not parse verdict from ${verdict_path} — fail-closed." >&2
  exit 2
fi

case "${verdict}" in
  GREEN_500)
    echo "sigma-log-gate: verdict=GREEN_500 — M1 launch may proceed."
    exit 0
    ;;
  GREEN_500_FLAG)
    echo "sigma-log-gate: verdict=GREEN_500_FLAG — M1 launch may proceed (cohort-floor unmeasured; see DWEA-95)."
    exit 0
    ;;
  RED_1000)
    echo "sigma-log-gate: verdict=RED_1000 — M1 launch BLOCKED. Runbook: docs/architecture/observability/sigma-log-red-runbook.md" >&2
    exit 2
    ;;
  *)
    echo "sigma-log-gate: unknown verdict '${verdict}' in ${verdict_path} — fail-closed." >&2
    exit 2
    ;;
esac
