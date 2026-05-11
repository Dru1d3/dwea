# A2F-3D self-host (Spike B / [DWEA-118](/DWEA/issues/DWEA-118))

Self-hosts NVIDIA Audio2Face-3D NIM on an L4-class GPU plus a thin WS↔gRPC
relay so the browser test page (`/?lipsync-test`) can drive it.

## Scope

- **Spike-only.** Pin a NIM image digest and add a hardened relay before any
  production wiring.
- Browser path: `ws://<host>:7890/lipsync` → relay → gRPC `:50051` → A2F-3D NIM.
- Output: ARKit-52 blendshape frames at the rate NIM produces them (target
  30 fps from NVIDIA's docs; up to 60 fps with the SDK). The browser client
  uplifts to 60 fps render via `lerpFrame()` if needed.

## Bring up

```bash
export NGC_API_KEY=<your-NGC-personal-API-key-with-NIM-access>
docker compose -f infra/a2f-3d/compose.yaml up
```

Then in the browser: <http://localhost:5173/?lipsync-test>, set mode = "live
A2F-3D relay", relay = `ws://localhost:7890`, click Start.

The relay's current code path is a 3-second jaw-oscillation stub — the
operator still owes the gRPC bridge to NIM (checklist in
`relay/index.mjs`). Replace `[relay] stub stream` with real gRPC streaming
once the bridge is wired.

## Cost + latency benchmark (escalation owner)

Acceptance criteria require L4 cost + p95 latency under ≥2 (target 5)
concurrent streams. **The agent container has no GPU**, so the bench is
escalated to the operator:

- Host: any L4-class GPU box reachable from `pnpm dev`.
- Repro: open N tabs to `/?lipsync-test`, mode = live, start each one against
  the same relay. The browser console logs the `[lipsync.telemetry]`
  snapshot after every utterance — capture
  `viseme_frame_rate`, `viseme_audio_drift_ms_p95`, `jaw_open_amplitude_p95`.
- Tag every run with `lipsync_engine_id`.
- Per-stream GPU $ = (per-hour L4 spot price) / (sustainable concurrent
  stream count). NVIDIA's marketing claim is "real-time on a single L4" — we
  treat that as 1, the bench tells us how far above 1 we get.

## Migration to production

When (and only if) [DWEA-118](/DWEA/issues/DWEA-118)'s flip-trigger fires
([DWEA-115](/DWEA/issues/DWEA-115) AR note §7), this stack moves under our
LiveKit data-channel transport rather than a raw WS relay. The
`a2f3dClient.ts` protocol is intentionally trivial so the LiveKit shim is
one file.
