// A2F-3D WebSocket ↔ gRPC relay (Spike B / DWEA-118).
//
// Bridges the browser (`src/lipsync/a2f3dClient.ts`) to the NVIDIA A2F-3D NIM
// gRPC service. Spike-only — production deployment will replace this with a
// vendor-pinned service.
//
// Protocol (from `src/lipsync/a2f3dClient.ts`):
//
//   client → relay
//     { type: 'start', protoVersion: 1, sampleRate, format, sessionTag }
//     { type: 'audio', sequence, dataB64 }
//     { type: 'stop' }
//
//   relay → client
//     { type: 'session', sessionId, serverTimeMs }
//     { type: 'frame', sequence, audioTimeMs, coefficients[52] }
//     { type: 'end' }
//     { type: 'error', code, message }
//
// To complete this relay an operator must:
//   1. Add `@grpc/grpc-js` + `@grpc/proto-loader` (or pre-generated stubs)
//      from `NVIDIA/Audio2Face-3D-SDK`.
//   2. Wire the `start` → `OpenStream` / `audio` → `PushAudio` /
//      `stop` → `CloseStream` gRPC calls to the NIM at
//      `process.env.A2F_GRPC_ADDR`.
//   3. Map NIM's blendshape stream output to the 52-channel ordered array
//      defined by `ARKIT_52_CHANNELS` in `src/lipsync/arkit52.ts`.
//
// The relay currently runs a canned 3-second jaw-oscillation stub so the
// browser pipeline + telemetry harness is exercisable end-to-end without a
// GPU host. This matches the `stub` mode in the test page.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws'; // operator must `pnpm add ws` in this folder

const PORT = Number(process.env.RELAY_PORT ?? 7890);
const ENGINE_ID = process.env.ENGINE_ID ?? 'a2f3d';

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`A2F-3D relay (${ENGINE_ID}) — connect via WebSocket on port ${PORT}\n`);
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const sessionId = randomUUID();
  console.log(`[relay] open ${sessionId}`);
  let audioStart = null;
  let stubTimer = null;

  function send(msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  send({ type: 'session', sessionId, serverTimeMs: Date.now() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      send({ type: 'error', code: 'BAD_JSON', message: err.message });
      return;
    }
    if (msg.type === 'start') {
      audioStart = performance.now();
      // Canned 3-second stub stream. Replace with the gRPC bridge per the
      // operator checklist above. Frame cadence: 60 fps, jawOpen at 4 Hz.
      let i = 0;
      stubTimer = setInterval(() => {
        if (i >= 180) {
          clearInterval(stubTimer);
          send({ type: 'end' });
          return;
        }
        const audioTimeMs = (i / 60) * 1000;
        const phase = (i / 60) * 2 * Math.PI * 4;
        const jaw = (Math.sin(phase) + 1) / 2;
        const coefficients = new Array(52).fill(0);
        coefficients[17] = jaw; // jawOpen
        send({ type: 'frame', sequence: i, audioTimeMs, coefficients });
        i += 1;
      }, 1000 / 60);
    } else if (msg.type === 'audio') {
      // Forward to NIM in the production path. The stub ignores audio.
    } else if (msg.type === 'stop') {
      if (stubTimer) clearInterval(stubTimer);
      send({ type: 'end' });
    }
  });

  ws.on('close', () => {
    if (stubTimer) clearInterval(stubTimer);
    console.log(`[relay] close ${sessionId} (audioStart=${audioStart})`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] listening on :${PORT}`);
});
