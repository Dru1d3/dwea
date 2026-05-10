# Latency telemetry — TTFA / TTF-Face

Owner: FoundingEngineer (DWEA-100)
Consumer: σ_log measurement run under DWEA-98 → cohort dashboards under DWEA-97

## What this is

Per-session capture of two latencies on the M0 dogfood path:

- `ttfa_ms` — Time To First Audio: from "user finishes speaking" to first audible TTS sample on the wire.
- `ttf_face_ms` — Time To First Face animation: from "user finishes speaking" to first viseme/blendshape applied to the avatar.

Submitted with `session_id`, `turn_id`, `npc_id`, `route` (warm/cold), provider tags (LLM, TTS), `device_tier`, `input_modality`, ISO `ts`, and `schema_version`.

## Transport choice

The issue suggests two transport options: (a) Plausible self-host custom event, (b) tiny `/api/telemetry` POST endpoint writing to a flat append-only file/log.

**Picked**: a third hybrid option that ships in an afternoon and matches our static deploy.

- **Source of record is local.** Each browser owns an append-only buffer in `localStorage` (`dwea.telemetry.buffer.v1`). Records survive page reloads. At a 1 KB record × 200 sessions ≈ 200 KB, we are well under any browser's quota.
- **Optional remote tee.** When `VITE_TELEMETRY_ENDPOINT` is set at build time, every record is also sent best-effort via `navigator.sendBeacon` (with `fetch keepalive` fallback). The endpoint contract is `POST application/json` with a single record per request; 2xx is success, anything else is silent. The chat path never blocks on the network, never retries, never logs a failure — a flaky sink must not deform the σ_log distribution we are trying to measure.
- **Export hooks.**
  - In-app: Settings dialog → "Download CSV" produces `dwea-telemetry-<ts>.csv` from the local buffer.
  - Aggregator: `scripts/export-telemetry-csv.mjs` reads a directory of dogfood drops (CSV + JSON + NDJSON), de-dupes on (session_id, turn_id), and writes one σ_log-ready CSV.

This pattern fits GitHub Pages (no backend) and keeps the door open for Plausible self-host (DWEA-85 §7) once an operator stands one up — at that point the operator just sets `VITE_TELEMETRY_ENDPOINT` and every dogfood client tees there with no code change.

## Schema

Canonical column order is in `src/telemetry/csv.ts`. The σ_log script (`compute_sigma_log.py`) accepts `--ttfa-col` / `--ttf-face-col` flags so renaming is fine; the columns we ship are:

| column           | type   | notes                                                          |
| ---------------- | ------ | -------------------------------------------------------------- |
| `ts`             | string | ISO-8601 UTC at "user done speaking" instant                   |
| `ttfa_ms`        | number | ms from `ts` to first audible TTS sample                       |
| `ttf_face_ms`    | number | ms from `ts` to first face/expression update on the rig        |
| `session_id`     | string | per-tab UUID, persisted in `sessionStorage`                    |
| `turn_id`        | string | per-turn UUID                                                  |
| `npc_id`         | string | bible id (e.g. `mara-arboreal`)                                |
| `route`          | string | `cold` for the first turn in a session, `warm` thereafter      |
| `llm_provider`   | string | model tag (provider:model from the bible)                      |
| `tts_provider`   | string | TTS tag (today: `web-speech`)                                  |
| `device_tier`    | string | `high` / `mid` / `low` / `unknown` heuristic                   |
| `input_modality` | string | `text`, `web-speech`, `groq`                                   |
| `schema_version` | string | `1`. Bump on breaking column changes.                          |

## Definition of "user finished speaking"

- **Push-to-talk via mic**: the moment `mic.stop()` fires (PTT release). We snapshot `performance.now()` the frame the mic state leaves `listening`. STT processing time is *included* in TTFA — that's correct, the user perceives "I let go of the button" as t=0.
- **Text input via Send**: the moment `chat.send()` is called. Type-time is excluded by definition (the user already finished writing).

## Definition of "first face animation"

V0 has no visemes — Web Speech TTS exposes no phoneme-level events. The proxy is the *first* avatar face change per turn: when `setEmotion` is called inside `useChat.send` after the brain returns. This is the EmotionBadge expression flip; in the current rig, `set_face` actions also dispatch on the same tick. We mark `ttf_face_ms` at that point.

When A2F-3D lands (DWEA-59 / v1 realism bar), swap the proxy for the first viseme apply on the rig — that is a one-line change inside `useChat`, and the schema does not move.

## Privacy

- The local buffer only holds latency timings, ids, and provider/device tags. No transcripts, no audio, no PII.
- The `VITE_TELEMETRY_ENDPOINT` is opt-in: unset by default, no network call happens. When set, the operator is on the hook for the receiver's privacy posture.
- The "Clear" button in Settings drops the local buffer.

## How to drain the buffer for σ_log

1. Each dogfood participant clicks Settings → Download CSV at the end of their session.
2. They post the file into the dogfood drop folder (Slack thread, shared drive, etc.).
3. Run `node scripts/export-telemetry-csv.mjs --input <drop-dir> --output dwea-sigma-log.csv`.
4. Hand the resulting CSV to whoever is running `compute_sigma_log.py` under DWEA-98.

## What's out of scope here

- Full Grafana dashboard build — DWEA-97.
- Vendor TTS integration (vendor swap will produce a real `tts_provider` tag) — see `voice.ts` header.
- Any metric beyond TTFA / TTF-Face — DWEA-53 §8.1 lists the full set; that is a follow-up.
