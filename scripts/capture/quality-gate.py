#!/usr/bin/env python3
# DWEA capture quality gate.
#
# Wraps the SfM pose-registration step that Brush 0.3 / glomap performs
# upstream of splat training, and rejects captures that won't train well.
# See docs/capture-protocol/v1.md for the operator-facing protocol.
#
# Usage:
#   quality-gate.py --capture-dir captures/<sceneId>/v<n>/
#   quality-gate.py --sfm-report  path/to/sfm-report.json
#
# The first form runs glomap (via `brush sfm --report` if present, falling
# back to a direct `glomap` invocation) over the capture, then evaluates
# the resulting report. The second form skips SfM entirely and grades a
# pre-computed report — that's how CI proves green-on-good / red-on-bad
# in unit tests without shipping a 200-MB photo fixture.
#
# Exit codes:
#   0 = PASS
#   1 = FAIL (re-shoot)
#   2 = SCHEMA_INVALID or other operator-fixable input error
#   3 = INTERNAL (SfM tool missing or crashed) — not the operator's fault
#
# Output: a single-line operator message on stderr, plus a structured
# JSON report on stdout (or to --output-json if given). Both go in the
# CI PR comment.

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "1.0"
DEFAULT_REGISTRATION_THRESHOLD = 0.95
DEFAULT_MIN_FRAMES = 80
DEFAULT_MIN_RINGS = 3
DEFAULT_MAX_LIGHTING_DRIFT = 0.20
DEFAULT_MIN_SHARPNESS = 60.0
DEFAULT_MIN_LUMA = 35.0
DEFAULT_MAX_GAP_DEG = 25.0


@dataclass
class GateResult:
    ok: bool
    protocol_version: str
    threshold: float
    registration_rate: float
    frames_total: int
    frames_registered: int
    rings_detected: int | None
    sharpness_mean: float | None
    luma_mean: float | None
    lighting_drift: float | None
    max_orbit_gap_deg: float | None
    reasons: list[str] = field(default_factory=list)
    operator_message: str = ""
    reshoot_actions: list[str] = field(default_factory=list)
    raw_report_path: str | None = None


REASON_ACTIONS: dict[str, str] = {
    "LOW_REGISTRATION": "Walk slower, increase frame overlap to ≥70%, and re-orbit. Aim for ≥100 frames covering all three rings.",
    "LOW_OVERLAP_REGION": "Re-shoot only the orbit arc with the gap. Take a frame every ~10° (more, not fewer) through that arc.",
    "BLURRY_FRAMES": "Use a tripod or raise shutter speed (≥1/60 s walking, ≥1/30 s on tripod). Re-shoot the affected ring.",
    "MOTION_IN_SCENE": "Wait until the scene is fully static. Clear out passersby. Re-shoot the full orbit.",
    "LIGHTING_DRIFT": "Lock AE and WB before starting. Pick a single hour-of-day. Re-shoot the full orbit.",
    "UNDEREXPOSED": "Pick a brighter hour, or open the aperture / raise ISO (≤800). Re-shoot the full orbit.",
    "SPARSE_COVERAGE": "Add the missing ring(s). Aim for at least 3 elevation rings and ≥100 frames total.",
    "SCHEMA_INVALID": "Fix `capture.json` to match `scripts/capture/capture.schema.json` and resubmit.",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="quality-gate",
        description="DWEA capture SfM-quality gate (≥95% pose-registration).",
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--capture-dir", type=Path, help="Path to captures/<sceneId>/v<n>/")
    src.add_argument("--sfm-report", type=Path, help="Path to a pre-computed SfM report JSON (skips SfM)")
    parser.add_argument("--threshold", type=float, default=DEFAULT_REGISTRATION_THRESHOLD,
                        help=f"Minimum pose-registration rate. Default {DEFAULT_REGISTRATION_THRESHOLD}.")
    parser.add_argument("--min-frames", type=int, default=DEFAULT_MIN_FRAMES)
    parser.add_argument("--min-rings", type=int, default=DEFAULT_MIN_RINGS)
    parser.add_argument("--output-json", type=Path,
                        help="Write structured report here. Otherwise prints to stdout.")
    parser.add_argument("--strict-schema", action="store_true",
                        help="Validate capture.json against capture.schema.json. Default on for --capture-dir, off for --sfm-report.")
    parser.add_argument("--skip-schema", action="store_true",
                        help="Skip capture.json schema validation entirely.")
    args = parser.parse_args(argv)

    try:
        if args.capture_dir is not None:
            if not args.skip_schema:
                schema_err = _validate_capture_json(args.capture_dir)
                if schema_err is not None:
                    return _emit(_schema_invalid_result(args.threshold, schema_err), args.output_json, exit_code=2)
            report = _run_sfm(args.capture_dir)
        else:
            report = _load_report(args.sfm_report)
            if args.strict_schema:
                # Caller wanted schema check even on --sfm-report mode (rare,
                # but useful when the fixture also bundles a capture.json).
                cap_dir = args.sfm_report.parent
                schema_err = _validate_capture_json(cap_dir, soft=True)
                if schema_err is not None:
                    return _emit(_schema_invalid_result(args.threshold, schema_err), args.output_json, exit_code=2)
    except _SfMRunError as exc:
        sys.stderr.write(f"INTERNAL: SfM tool failed: {exc}\n")
        return 3
    except _OperatorInputError as exc:
        return _emit(_schema_invalid_result(args.threshold, str(exc)), args.output_json, exit_code=2)

    result = _evaluate(report, args.threshold, args.min_frames, args.min_rings)
    if args.sfm_report is not None:
        result.raw_report_path = str(args.sfm_report)
    return _emit(result, args.output_json, exit_code=0 if result.ok else 1)


# --- evaluation ---------------------------------------------------------

def _evaluate(report: dict[str, Any], threshold: float, min_frames: int, min_rings: int) -> GateResult:
    frames_total = int(report.get("frames_total", 0))
    frames_registered = int(report.get("frames_registered", 0))
    rate = (frames_registered / frames_total) if frames_total > 0 else 0.0

    sharpness = _opt_float(report.get("sharpness_mean"))
    luma = _opt_float(report.get("luma_mean"))
    drift = _opt_float(report.get("lighting_drift"))
    rings = _opt_int(report.get("rings_detected"))
    max_gap = _opt_float(report.get("max_orbit_gap_deg"))
    motion = bool(report.get("motion_in_scene", False))

    reasons: list[str] = []

    if frames_total < min_frames or (rings is not None and rings < min_rings):
        reasons.append("SPARSE_COVERAGE")
    if max_gap is not None and max_gap > DEFAULT_MAX_GAP_DEG:
        reasons.append("LOW_OVERLAP_REGION")
    if sharpness is not None and sharpness < DEFAULT_MIN_SHARPNESS:
        reasons.append("BLURRY_FRAMES")
    if motion:
        reasons.append("MOTION_IN_SCENE")
    if drift is not None and drift > DEFAULT_MAX_LIGHTING_DRIFT:
        reasons.append("LIGHTING_DRIFT")
    if luma is not None and luma < DEFAULT_MIN_LUMA:
        reasons.append("UNDEREXPOSED")
    if rate < threshold:
        # LOW_REGISTRATION is the umbrella reason — it always wins first
        # position so the operator sees the headline metric first.
        reasons.insert(0, "LOW_REGISTRATION")

    ok = len(reasons) == 0

    if ok:
        msg = (
            f"PASS — {frames_registered}/{frames_total} frames registered "
            f"({rate * 100:.1f}% ≥ {threshold * 100:.0f}%). Going to Brush."
        )
    else:
        head = (
            f"FAIL — {frames_registered}/{frames_total} frames registered "
            f"({rate * 100:.1f}% < {threshold * 100:.0f}%)."
            if rate < threshold
            else
            f"FAIL — registration {rate * 100:.1f}% but other quality checks tripped."
        )
        msg = head + " Re-shoot reasons: " + ", ".join(reasons) + ". See report for details."

    actions = [REASON_ACTIONS[r] for r in reasons if r in REASON_ACTIONS]

    return GateResult(
        ok=ok,
        protocol_version=PROTOCOL_VERSION,
        threshold=threshold,
        registration_rate=round(rate, 4),
        frames_total=frames_total,
        frames_registered=frames_registered,
        rings_detected=rings,
        sharpness_mean=sharpness,
        luma_mean=luma,
        lighting_drift=drift,
        max_orbit_gap_deg=max_gap,
        reasons=reasons,
        operator_message=msg,
        reshoot_actions=actions,
    )


def _schema_invalid_result(threshold: float, err: str) -> GateResult:
    return GateResult(
        ok=False,
        protocol_version=PROTOCOL_VERSION,
        threshold=threshold,
        registration_rate=0.0,
        frames_total=0,
        frames_registered=0,
        rings_detected=None,
        sharpness_mean=None,
        luma_mean=None,
        lighting_drift=None,
        max_orbit_gap_deg=None,
        reasons=["SCHEMA_INVALID"],
        operator_message=f"FAIL — capture.json invalid: {err}",
        reshoot_actions=[REASON_ACTIONS["SCHEMA_INVALID"]],
    )


# --- IO -----------------------------------------------------------------

def _emit(result: GateResult, output_json: Path | None, exit_code: int) -> int:
    payload = asdict(result)
    body = json.dumps(payload, indent=2, sort_keys=True)
    if output_json is not None:
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(body + "\n", encoding="utf-8")
    else:
        sys.stdout.write(body + "\n")
    sys.stderr.write(result.operator_message + "\n")
    return exit_code


def _load_report(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise _OperatorInputError(f"SfM report not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise _OperatorInputError(f"SfM report is not valid JSON: {exc}") from exc


def _validate_capture_json(capture_dir: Path, *, soft: bool = False) -> str | None:
    cap = capture_dir / "capture.json"
    if not cap.is_file():
        return None if soft else "capture.json missing"
    try:
        data = json.loads(cap.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return f"capture.json is not valid JSON: {exc}"
    schema_path = Path(__file__).with_name("capture.schema.json")
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None  # schema not shipped — skip rather than block
    err = _check_schema(data, schema)
    return err


def _check_schema(data: Any, schema: dict[str, Any]) -> str | None:
    # Minimal, dependency-free schema check. Validates required fields,
    # types, enum membership, simple patterns, numeric bounds, and the
    # frames oneOf branch. Sufficient for the ~12 fields v1 cares about
    # and avoids pulling jsonschema into the CI image.
    required = schema.get("required", [])
    if not isinstance(data, dict):
        return "capture.json must be a JSON object"
    for k in required:
        if k not in data:
            return f"missing required field: {k}"
    props = schema.get("properties", {})
    for key, val in data.items():
        if key not in props and not schema.get("additionalProperties", True):
            return f"unknown field: {key}"
        prop = props.get(key)
        if prop is None:
            continue
        err = _check_value(key, val, prop)
        if err is not None:
            return err
    return None


def _check_value(key: str, val: Any, prop: dict[str, Any]) -> str | None:
    if "const" in prop:
        if val != prop["const"]:
            return f"{key}: expected {prop['const']!r}, got {val!r}"
    if "enum" in prop:
        if val not in prop["enum"]:
            return f"{key}: {val!r} not in {prop['enum']}"
    if "type" in prop:
        t = prop["type"]
        py_types = {
            "string": str,
            "integer": int,
            "number": (int, float),
            "boolean": bool,
            "object": dict,
            "array": list,
        }.get(t)
        if py_types is not None and not isinstance(val, py_types):
            return f"{key}: expected {t}, got {type(val).__name__}"
        if t == "integer" and isinstance(val, bool):
            return f"{key}: expected integer, got boolean"
    if "minimum" in prop and isinstance(val, (int, float)) and val < prop["minimum"]:
        return f"{key}: {val} < minimum {prop['minimum']}"
    if "maximum" in prop and isinstance(val, (int, float)) and val > prop["maximum"]:
        return f"{key}: {val} > maximum {prop['maximum']}"
    if "minLength" in prop and isinstance(val, str) and len(val) < prop["minLength"]:
        return f"{key}: too short"
    if "pattern" in prop and isinstance(val, str):
        import re
        if not re.search(prop["pattern"], val):
            return f"{key}: {val!r} does not match {prop['pattern']!r}"
    if "properties" in prop and isinstance(val, dict):
        return _check_schema(val, prop)
    if "oneOf" in prop:
        errs = []
        for branch in prop["oneOf"]:
            err = _check_value(key, val, branch) if not isinstance(val, dict) else _check_schema(val, branch)
            if err is None:
                return None
            errs.append(err)
        return f"{key}: matched no oneOf branch — {errs[0]}"
    return None


# --- SfM wrapper --------------------------------------------------------

def _run_sfm(capture_dir: Path) -> dict[str, Any]:
    if not capture_dir.is_dir():
        raise _OperatorInputError(f"capture dir not found: {capture_dir}")
    # Prefer a project-local SfM runner if present.
    runner = shutil.which("brush") or shutil.which("glomap") or shutil.which("colmap")
    if runner is None:
        raise _SfMRunError(
            "no SfM runner on PATH (looked for brush, glomap, colmap). "
            "In CI, use the dwea-ci image which bundles brush 0.3."
        )
    out_dir = capture_dir / "_sfm-out"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "sfm-report.json"
    cmd: list[str]
    if runner.endswith("brush"):
        cmd = [runner, "sfm", "--input", str(capture_dir / "frames"),
               "--output", str(out_dir), "--report", str(report_path)]
    elif runner.endswith("glomap"):
        cmd = [runner, "mapper", "--input", str(capture_dir / "frames"),
               "--output", str(out_dir), "--report-json", str(report_path)]
    else:
        # COLMAP fallback — write a minimal compatible report from its
        # text output. Kept pragmatic; CI image should have brush.
        cmd = [runner, "automatic_reconstructor",
               "--workspace_path", str(out_dir),
               "--image_path", str(capture_dir / "frames")]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        raise _SfMRunError(str(exc)) from exc
    if proc.returncode != 0:
        raise _SfMRunError(
            f"{Path(runner).name} exited {proc.returncode}: {proc.stderr.strip()[:400]}"
        )
    if not report_path.is_file():
        raise _SfMRunError(f"{Path(runner).name} did not produce a report at {report_path}")
    return _load_report(report_path)


class _SfMRunError(RuntimeError):
    pass


class _OperatorInputError(ValueError):
    pass


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _opt_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    sys.exit(main())
