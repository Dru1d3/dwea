/**
 * Best-effort outbound POST for telemetry.
 *
 * The durable buffer is local (see [store.ts](./store.ts)); this transport
 * tees a copy to a remote endpoint when the operator configures one. We
 * never block the chat path on the request, never retry on failure, never
 * log a stack — a flaky telemetry sink must not change the σ_log
 * distribution we're trying to measure.
 *
 * Endpoint contract: POST application/json, body is one
 * [TelemetryRecord](./types.ts). 2xx is success; everything else is silent.
 * If the env var is missing the function is a no-op so dev never tries to
 * hit a real network.
 */
import type { TelemetryRecord } from './types.js';

export type SendTelemetry = (record: TelemetryRecord) => void;

export interface TransportOptions {
  /** Fully-qualified URL. Empty string → no-op transport. */
  endpoint?: string | undefined;
  /** Test seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export function createHttpTransport(opts: TransportOptions = {}): SendTelemetry {
  const endpoint = (opts.endpoint ?? '').trim();
  const f = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!endpoint || !f) return () => {};

  return (record) => {
    // sendBeacon is the right primitive for ship-and-forget; fall back to
    // fetch with keepalive when sendBeacon isn't reachable (Node, jsdom,
    // strict CSPs that ban Beacon API).
    const body = JSON.stringify(record);
    const beacon = (globalThis as unknown as { navigator?: Navigator }).navigator;
    const beaconFn = beacon?.sendBeacon?.bind(beacon);
    if (beaconFn) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (beaconFn(endpoint, blob)) return;
      } catch {
        // fall through to fetch
      }
    }
    void f(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Swallow — see file header.
    });
  };
}

/**
 * Resolve the transport endpoint from Vite's import.meta.env. Returns an
 * empty string when unset so [createHttpTransport](./transport.ts) becomes a
 * no-op without the caller having to special-case dev.
 */
export function resolveEndpointFromEnv(): string {
  // import.meta.env is the Vite-injected env block; tests run under Node and
  // typically don't have it, hence the guarded reads.
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = meta?.VITE_TELEMETRY_ENDPOINT?.trim();
  if (fromVite) return fromVite;
  return '';
}
