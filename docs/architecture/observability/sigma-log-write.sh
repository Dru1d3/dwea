#!/usr/bin/env bash
# sigma-log-write.sh — canonical writer for sigma_log_verdict.json.
#
# Implements DWEA-99 verdict-write integration choice (Option 1 — promote the
# ad-hoc compute_sigma_log.py invocation to a standardised writer). Single
# truth-bearing surface that the Grafana panels and the M1 launch gate read.
#
# Modes:
#   --manual-override --verdict <V> [--notes <S>]
#       Set the verdict explicitly. verdict_source is recorded as
#       "manual-override". Used for emergency state flips, M0 not yet run, etc.
#
#   --from-measurement <measurement.json>
#       Read sigma_log + ci_lower + ci_upper + sample_count + measured_at from a
#       measurement-output JSON, derive the verdict from the rules in
#       sigma-log-verdict-state.md, and write the verdict file. verdict_source
#       is recorded as "m0-measurement".
#
# Always writes atomically (tmpfile + rename) to a path that defaults to
# docs/architecture/observability/sigma_log_verdict.json. Override with --output.
#
# Verdict derivation (matches sigma-log-verdict-state.md §2):
#   ci_upper <= 0.5                                  -> GREEN_500
#   sigma_log <= 0.5 AND 0.5 < ci_upper <= 0.6        -> GREEN_500_FLAG
#   ci_upper > 0.6                                    -> RED_1000
#   any other shape                                   -> error (no write)

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_output="${script_dir}/sigma_log_verdict.json"

usage() {
  cat <<'USAGE'
sigma-log-write.sh --manual-override --verdict <GREEN_500|GREEN_500_FLAG|RED_1000> [--notes <text>] [--output <path>]
sigma-log-write.sh --from-measurement <path> [--output <path>]

Writes docs/architecture/observability/sigma_log_verdict.json (or --output) atomically.
USAGE
}

mode=""
verdict=""
notes=""
measurement_path=""
output_path="${default_output}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manual-override)
      mode="manual"
      shift
      ;;
    --from-measurement)
      mode="measurement"
      measurement_path="${2:-}"
      shift 2
      ;;
    --verdict)
      verdict="${2:-}"
      shift 2
      ;;
    --notes)
      notes="${2:-}"
      shift 2
      ;;
    --output)
      output_path="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "sigma-log-write: unknown argument '$1'" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "${mode}" ]]; then
  echo "sigma-log-write: must pass --manual-override or --from-measurement." >&2
  usage >&2
  exit 64
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "sigma-log-write: python3 is required (used for safe JSON encoding)." >&2
  exit 70
fi

write_atomic() {
  # $1 = JSON body
  local body="$1"
  local tmp
  tmp="$(mktemp "${output_path}.XXXXXX")"
  printf '%s\n' "${body}" >"${tmp}"
  mv "${tmp}" "${output_path}"
  echo "sigma-log-write: wrote ${output_path}"
}

case "${mode}" in
  manual)
    case "${verdict}" in
      GREEN_500 | GREEN_500_FLAG | RED_1000) ;;
      *)
        echo "sigma-log-write: --verdict must be one of GREEN_500, GREEN_500_FLAG, RED_1000 (got '${verdict}')." >&2
        exit 64
        ;;
    esac
    body="$(
      VERDICT="${verdict}" NOTES="${notes}" python3 - <<'PY'
import json, os, datetime
verdict = os.environ["VERDICT"]
notes = os.environ.get("NOTES") or f"Manual override at {datetime.datetime.utcnow().isoformat()}Z."
cohort_floor = 1000 if verdict == "RED_1000" else 500
doc = {
    "$schema": "./sigma_log_verdict.schema.json",
    "version": 1,
    "verdict": verdict,
    "verdict_source": "manual-override",
    "sigma_log": None,
    "ci_lower": None,
    "ci_upper": None,
    "sample_count": None,
    "measured_at": None,
    "cohort_floor": cohort_floor,
    "notes": notes,
}
print(json.dumps(doc, indent=2))
PY
    )"
    write_atomic "${body}"
    ;;
  measurement)
    if [[ -z "${measurement_path}" || ! -f "${measurement_path}" ]]; then
      echo "sigma-log-write: --from-measurement requires a path to a measurement JSON file." >&2
      exit 64
    fi
    body="$(
      MEASUREMENT="${measurement_path}" NOTES="${notes}" python3 - <<'PY'
import json, os, sys
path = os.environ["MEASUREMENT"]
notes = os.environ.get("NOTES") or ""
with open(path, "r", encoding="utf-8") as fh:
    m = json.load(fh)
required = ["sigma_log", "ci_lower", "ci_upper", "measured_at"]
missing = [k for k in required if k not in m]
if missing:
    sys.stderr.write(f"sigma-log-write: measurement missing keys: {missing}\n")
    sys.exit(65)
sigma = float(m["sigma_log"])
ci_lower = float(m["ci_lower"])
ci_upper = float(m["ci_upper"])
sample_count = m.get("sample_count")
if ci_upper <= 0.5:
    verdict = "GREEN_500"
    cohort_floor = 500
elif sigma <= 0.5 and 0.5 < ci_upper <= 0.6:
    verdict = "GREEN_500_FLAG"
    cohort_floor = 500
elif ci_upper > 0.6:
    verdict = "RED_1000"
    cohort_floor = 1000
else:
    sys.stderr.write(
        f"sigma-log-write: measurement does not match a verdict band "
        f"(sigma_log={sigma}, ci=[{ci_lower}, {ci_upper}]).\n"
    )
    sys.exit(65)
doc = {
    "$schema": "./sigma_log_verdict.schema.json",
    "version": 1,
    "verdict": verdict,
    "verdict_source": "m0-measurement",
    "sigma_log": sigma,
    "ci_lower": ci_lower,
    "ci_upper": ci_upper,
    "sample_count": sample_count,
    "measured_at": m["measured_at"],
    "cohort_floor": cohort_floor,
    "notes": notes or f"Auto-derived from {os.path.basename(path)}.",
}
print(json.dumps(doc, indent=2))
PY
    )"
    write_atomic "${body}"
    ;;
esac
