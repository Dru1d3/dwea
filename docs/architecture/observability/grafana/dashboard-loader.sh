#!/usr/bin/env bash
# dashboard-loader.sh — render the σ_log overlays dashboard with the current
# verdict baked into the $verdict template variable, then POST it to a Grafana
# instance via the dashboard API.
#
# Reads:
#   docs/architecture/observability/sigma_log_verdict.json (the verdict file)
#   docs/architecture/observability/grafana/sigma-log-overlays.json (the dashboard template)
#
# Env vars:
#   GRAFANA_URL    — e.g. https://example.grafana.net
#   GRAFANA_TOKEN  — Grafana API token with dashboards:write
#   GRAFANA_FOLDER_UID (optional) — target folder UID
#
# Usage:
#   dashboard-loader.sh [--dry-run]
#
# In --dry-run mode, prints the rendered dashboard JSON to stdout and skips the API call.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verdict_file="${script_dir}/../sigma_log_verdict.json"
dashboard_file="${script_dir}/sigma-log-overlays.json"

dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true; shift ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "dashboard-loader: unknown argument '$1'" >&2
      exit 64
      ;;
  esac
done

if [[ ! -f "${verdict_file}" ]]; then
  echo "dashboard-loader: verdict file missing at ${verdict_file}" >&2
  exit 2
fi
if [[ ! -f "${dashboard_file}" ]]; then
  echo "dashboard-loader: dashboard template missing at ${dashboard_file}" >&2
  exit 2
fi

verdict="$(
  grep -oE '"verdict"[[:space:]]*:[[:space:]]*"[A-Z0-9_]+"' "${verdict_file}" \
    | head -n1 \
    | sed -E 's/.*"verdict"[[:space:]]*:[[:space:]]*"([A-Z0-9_]+)".*/\1/'
)"
case "${verdict}" in
  GREEN_500|GREEN_500_FLAG|RED_1000) ;;
  *)
    echo "dashboard-loader: verdict file holds unknown value '${verdict}'" >&2
    exit 2
    ;;
esac

# Render: rewrite the verdict template-variable's `current` to ${verdict}.
rendered="$(
  VERDICT="${verdict}" python3 - "${dashboard_file}" <<'PY'
import json, os, sys
verdict = os.environ["VERDICT"]
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    dash = json.load(fh)
for var in dash.get("templating", {}).get("list", []):
    if var.get("name") == "verdict":
        var["current"] = {"text": verdict, "value": verdict}
        for opt in var.get("options", []):
            opt["selected"] = opt.get("value") == verdict
print(json.dumps({"dashboard": dash, "overwrite": True, "folderUid": os.environ.get("GRAFANA_FOLDER_UID", "")}))
PY
)"

if [[ "${dry_run}" == "true" ]]; then
  printf '%s\n' "${rendered}"
  exit 0
fi

if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_TOKEN:-}" ]]; then
  echo "dashboard-loader: GRAFANA_URL and GRAFANA_TOKEN are required (or pass --dry-run)." >&2
  exit 64
fi

curl -fsS \
  -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST "${GRAFANA_URL%/}/api/dashboards/db" \
  --data-raw "${rendered}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"dashboard-loader: pushed dashboard uid={d.get('uid')} version={d.get('version')} status={d.get('status')}\")"
