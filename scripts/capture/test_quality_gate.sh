#!/usr/bin/env bash
# CI test runner for the capture quality gate.
# Verifies green-on-good and red-on-bad fixture behaviour.
# Exits 0 if both fixtures behave as expected, non-zero otherwise.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/quality-gate.py"
FIXTURES="$HERE/fixtures"

fail=0

run_case() {
  local label="$1" report="$2" expected_rc="$3" must_contain="$4"
  local out rc=0
  out="$(python3 "$GATE" --sfm-report "$report" 2>&1 1>/tmp/gate.stdout)" || rc=$?
  rc=${rc:-0}
  if [[ "$rc" -ne "$expected_rc" ]]; then
    echo "FAIL [$label]: expected exit $expected_rc, got $rc"
    echo "--- stderr ---"; echo "$out"
    echo "--- stdout ---"; cat /tmp/gate.stdout
    fail=1
    return
  fi
  if [[ -n "$must_contain" ]] && ! grep -q "$must_contain" /tmp/gate.stdout; then
    echo "FAIL [$label]: stdout missing expected token: $must_contain"
    cat /tmp/gate.stdout
    fail=1
    return
  fi
  echo "OK   [$label]: exit $rc"
}

run_case "known-good"      "$FIXTURES/known-good.sfm-report.json"      0 '"ok": true'
run_case "known-bad"       "$FIXTURES/known-bad.sfm-report.json"       1 '"LOW_REGISTRATION"'

# Boundary check: a synthetic at-threshold case (95.0% should pass; 94.9% should fail).
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
cat > "$TMPDIR/at-threshold.json" <<'JSON'
{ "frames_total": 100, "frames_registered": 95,
  "rings_detected": 3, "sharpness_mean": 120, "luma_mean": 80,
  "lighting_drift": 0.05, "max_orbit_gap_deg": 12, "motion_in_scene": false }
JSON
cat > "$TMPDIR/just-below.json" <<'JSON'
{ "frames_total": 1000, "frames_registered": 949,
  "rings_detected": 3, "sharpness_mean": 120, "luma_mean": 80,
  "lighting_drift": 0.05, "max_orbit_gap_deg": 12, "motion_in_scene": false }
JSON

run_case "boundary-pass-95"  "$TMPDIR/at-threshold.json"  0 '"ok": true'
run_case "boundary-fail-949" "$TMPDIR/just-below.json"    1 '"LOW_REGISTRATION"'

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "quality-gate test FAILED"
  exit 1
fi

echo
echo "quality-gate test passed (4 cases)"
