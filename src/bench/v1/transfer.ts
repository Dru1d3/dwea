/**
 * Network-transfer probe for the v1 frame-budget bench.
 *
 * Reads `performance.getEntriesByType('resource')` and `…('navigation')` to
 * report the two §2 budgets that map to "what the user actually downloaded
 * before the first coherent frame":
 *  - **initial JS + wasm transferred** — the harness page itself plus every
 *    JS/wasm fetch up to capture time, encoded byte size (`transferSize`).
 *  - **first-scene splat payload over the wire** — anything ending in
 *    `.splat`/`.spz`/`.ply`/`.ksplat`.
 *
 * Best-effort: cross-origin resources without `Timing-Allow-Origin` return
 * `transferSize=0` even when the body has bytes. We mark the run `partial`
 * when this happens so the methodology doc tells the operator to verify in
 * DevTools.
 */

export type TransferProbe = {
  readonly initialJsWasmBytes: number;
  readonly firstSceneSplatBytes: number;
  readonly entryCount: number;
  /** True if any resource entry had a 0 transferSize despite a non-empty body. */
  readonly partial: boolean;
  /** Summary of `navigator.connection` when present. */
  readonly connection: ConnectionInfo | null;
};

export type ConnectionInfo = {
  readonly effectiveType?: string;
  readonly downlinkMbps?: number;
  readonly rttMs?: number;
  readonly saveData?: boolean;
};

const SPLAT_EXT = /\.(splat|spz|ply|ksplat)(\?|#|$)/i;

export function captureTransferProbe(): TransferProbe {
  const entries = readResourceEntries();
  let jsWasm = 0;
  let splat = 0;
  let partial = false;
  for (const e of entries) {
    const transfer = e.transferSize ?? 0;
    const decoded = e.decodedBodySize ?? 0;
    if (transfer === 0 && decoded > 0) partial = true;
    const url = e.name ?? '';
    if (isJsOrWasm(url, e.initiatorType)) jsWasm += transfer;
    else if (SPLAT_EXT.test(url)) splat += transfer;
  }
  const nav = readNavigationEntry();
  if (nav) jsWasm += nav.transferSize ?? 0;

  return {
    initialJsWasmBytes: jsWasm,
    firstSceneSplatBytes: splat,
    entryCount: entries.length + (nav ? 1 : 0),
    partial,
    connection: readConnectionInfo(),
  };
}

function isJsOrWasm(url: string, initiator: string | undefined): boolean {
  if (/\.(m?js|wasm)(\?|#|$)/i.test(url)) return true;
  // Vite dev fetches transformed modules without a `.js` extension; their
  // initiatorType is `script`. Same for blob: workers.
  return initiator === 'script';
}

type ResourceEntry = {
  readonly name?: string;
  readonly initiatorType?: string;
  readonly transferSize?: number;
  readonly decodedBodySize?: number;
};

function readResourceEntries(): ReadonlyArray<ResourceEntry> {
  if (typeof performance === 'undefined') return [];
  if (typeof performance.getEntriesByType !== 'function') return [];
  return performance.getEntriesByType('resource') as ReadonlyArray<ResourceEntry>;
}

function readNavigationEntry(): ResourceEntry | null {
  if (typeof performance === 'undefined') return null;
  if (typeof performance.getEntriesByType !== 'function') return null;
  const list = performance.getEntriesByType('navigation') as ReadonlyArray<ResourceEntry>;
  return list[0] ?? null;
}

function readConnectionInfo(): ConnectionInfo | null {
  const nav = navigator as unknown as {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };
  const c = nav.connection;
  if (!c) return null;
  const out: { -readonly [K in keyof ConnectionInfo]: ConnectionInfo[K] } = {};
  if (c.effectiveType !== undefined) out.effectiveType = c.effectiveType;
  if (c.downlink !== undefined) out.downlinkMbps = c.downlink;
  if (c.rtt !== undefined) out.rttMs = c.rtt;
  if (c.saveData !== undefined) out.saveData = c.saveData;
  return out;
}
