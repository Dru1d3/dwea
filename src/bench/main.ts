/**
 * Bench entry — boots the splat-runtime harness used to settle DWEA-55 (OD-3).
 *
 * URL parameters:
 *   ?runtime=spark|gsplatjs   (required) which adapter to mount
 *   ?asset=<url>              (optional) override default asset; same-origin or CORS-allowed
 *   ?dup=<n>                  (optional, default 4) duplicate splats to ~N× density
 *                                                   must be a perfect square; 4 ≈ 1.1 M
 *   ?duration=<seconds>       (optional, default 60) measurement window length
 *   ?dpr=<n>                  (optional, default min(devicePixelRatio, 2))
 *   ?spacing=<m>              (optional, default 4) tile spacing in metres
 *   ?warmup=<seconds>         (optional, default 2) frames before sampling starts
 *
 * Output: a results panel with copy-able JSON + a console.log payload.
 */

import { duplicateSplat, splatCountFromBytes } from './duplicate.js';
import { DEFAULT_ORBIT, type OrbitConfig, poseAt } from './orbit.js';
import {
  type FrameStats,
  type MemorySnapshot,
  captureMemorySnapshot,
  makeRecorder,
  summarise,
} from './perf.js';
import type { SplatRuntime } from './runtimes/types.js';

type BenchConfig = {
  readonly runtimeId: 'spark' | 'gsplatjs';
  readonly assetUrl: string;
  readonly dup: number;
  readonly durationSec: number;
  readonly warmupSec: number;
  readonly pixelRatio: number;
  readonly spacingMeters: number;
  readonly orbit: OrbitConfig;
};

type BenchResult = {
  readonly schema: 'dwea-55-bench/v1';
  readonly recordedAt: string;
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly displayHz: number | null;
  readonly viewport: { width: number; height: number };
  readonly runtime: { id: string; label: string; contextLabel: string };
  readonly asset: {
    url: string;
    sourceBytes: number;
    sourceSplats: number;
    duplicateTiles: number;
    effectiveSplats: number;
    effectiveBytes: number;
    spacingMeters: number;
  };
  readonly timing: {
    durationSec: number;
    warmupSec: number;
    fetchMs: number;
    duplicateMs: number;
    runtimeMountMs: number;
    runtimeReadyMs: number;
    firstSplatFrameMs: number;
  };
  readonly frame: FrameStats;
  readonly memory: MemorySnapshot;
};

const STATUS_BODY = mustGetById('status-body');
const RESULTS_PANEL = mustGetById('results');
const RESULTS_BODY = mustGetById('results-body');
const STAGE = mustGetById('stage');

const DEFAULT_ASSET = withBase('splats/plush.splat');

main().catch((err) => {
  reportError(err);
});

async function main(): Promise<void> {
  const parsed = parseUrl();
  if (!parsed) return;
  const cfg: BenchConfig = parsed;
  // Dynamic import keeps the initial bundle from carrying both runtimes; the
  // harness only ever uses one per page load. This also matches what a v1
  // shipping bundle would look like.
  const runtime: SplatRuntime =
    cfg.runtimeId === 'spark'
      ? (await import('./runtimes/spark.js')).sparkRuntime
      : (await import('./runtimes/gsplatjs.js')).gsplatjsRuntime;
  setStatus({
    runtime: runtime.label,
    asset: cfg.assetUrl,
    durationSec: cfg.durationSec,
    pixelRatio: cfg.pixelRatio,
    state: 'fetching asset…',
  });

  const fetchStart = performance.now();
  const sourceBytes = await fetchAsset(cfg.assetUrl);
  const fetchMs = performance.now() - fetchStart;

  const dupStart = performance.now();
  const dup = duplicateSplat(sourceBytes, cfg.dup, cfg.spacingMeters);
  const duplicateMs = performance.now() - dupStart;

  setStatus({
    runtime: runtime.label,
    asset: cfg.assetUrl,
    durationSec: cfg.durationSec,
    pixelRatio: cfg.pixelRatio,
    state: `mounting runtime · ${dup.splatCount.toLocaleString()} splats`,
  });

  const mountStart = performance.now();
  const mounted = await runtime.mount({
    container: STAGE,
    splatBytes: dup.bytes,
    pixelRatio: cfg.pixelRatio,
  });
  const runtimeMountMs = performance.now() - mountStart;

  // First-paint = (mount handed back) → first rAF after `ready` resolves.
  // We start the rAF loop immediately so we have a deterministic camera path
  // both before and after `ready`; we just don't accept samples until ready+warmup.
  const firstPaintStart = performance.now();
  let runtimeReadyMs: number | null = null;
  let firstSplatFrameMs: number | null = null;
  let warmupUntil: number | null = null;
  let measureStart: number | null = null;

  const recorder = makeRecorder();
  const stopBy = (ms: number): boolean =>
    measureStart != null && performance.now() - measureStart >= ms;

  let stopped = false;
  let onComplete: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => {
    onComplete = resolve;
  });

  mounted.ready.then(() => {
    runtimeReadyMs = performance.now() - mountStart;
  });

  function loop(now: DOMHighResTimeStamp): void {
    if (stopped) return;
    const tNow = performance.now();
    const elapsed = (tNow - firstPaintStart) / 1000;
    const pose = poseAt(elapsed, cfg.orbit);
    mounted.render(pose);

    if (firstSplatFrameMs == null && runtimeReadyMs != null) {
      firstSplatFrameMs = tNow - firstPaintStart;
      warmupUntil = tNow + cfg.warmupSec * 1000;
      setStatus({
        runtime: runtime.label,
        asset: cfg.assetUrl,
        durationSec: cfg.durationSec,
        pixelRatio: cfg.pixelRatio,
        state: 'warming up…',
      });
    }
    if (warmupUntil != null && measureStart == null && tNow >= warmupUntil) {
      measureStart = tNow;
      setStatus({
        runtime: runtime.label,
        asset: cfg.assetUrl,
        durationSec: cfg.durationSec,
        pixelRatio: cfg.pixelRatio,
        state: 'measuring frame times…',
      });
    }
    if (measureStart != null) {
      recorder.tick(now);
      if (stopBy(cfg.durationSec * 1000)) {
        recorder.stop();
        stopped = true;
        onComplete();
        return;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  await completed;
  const memory = await captureMemorySnapshot();
  const frame = summarise({ samples: recorder.samples });

  const result: BenchResult = {
    schema: 'dwea-55-bench/v1',
    recordedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    displayHz: null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    runtime: {
      id: runtime.id,
      label: runtime.label,
      contextLabel: mounted.contextLabel,
    },
    asset: {
      url: cfg.assetUrl,
      sourceBytes: sourceBytes.byteLength,
      sourceSplats: splatCountFromBytes(sourceBytes.byteLength),
      duplicateTiles: dup.tiles,
      effectiveSplats: dup.splatCount,
      effectiveBytes: dup.bytes.byteLength,
      spacingMeters: dup.tileSpacingMeters,
    },
    timing: {
      durationSec: cfg.durationSec,
      warmupSec: cfg.warmupSec,
      fetchMs: round(fetchMs),
      duplicateMs: round(duplicateMs),
      runtimeMountMs: round(runtimeMountMs),
      runtimeReadyMs: round(runtimeReadyMs ?? 0),
      firstSplatFrameMs: round(firstSplatFrameMs ?? 0),
    },
    frame,
    memory,
  };

  renderResults(result, runtime);
  console.info('[dwea-55-bench] result', result);
}

async function fetchAsset(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`asset fetch failed: ${res.status} ${res.statusText} ${url}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function parseUrl(): BenchConfig | null {
  const params = new URLSearchParams(window.location.search);
  const runtimeIdRaw = params.get('runtime');
  if (runtimeIdRaw !== 'spark' && runtimeIdRaw !== 'gsplatjs') {
    renderRuntimePicker();
    return null;
  }
  const dup = parsePositiveInt(params.get('dup'), 4);
  const durationSec = parsePositiveNumber(params.get('duration'), 60);
  const warmupSec = parsePositiveNumber(params.get('warmup'), 2);
  const pixelRatio = parsePositiveNumber(params.get('dpr'), Math.min(window.devicePixelRatio, 2));
  const spacingMeters = parsePositiveNumber(params.get('spacing'), 4);
  const assetUrl = params.get('asset') ?? DEFAULT_ASSET;
  return {
    runtimeId: runtimeIdRaw,
    assetUrl,
    dup,
    durationSec,
    warmupSec,
    pixelRatio,
    spacingMeters,
    orbit: DEFAULT_ORBIT,
  };
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function parsePositiveNumber(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function setStatus(info: {
  runtime: string;
  asset: string;
  durationSec: number;
  pixelRatio: number;
  state: string;
}): void {
  STATUS_BODY.innerHTML = '';
  appendRow(STATUS_BODY, 'runtime', info.runtime);
  appendRow(STATUS_BODY, 'asset', info.asset);
  appendRow(STATUS_BODY, 'duration', `${info.durationSec}s`);
  appendRow(STATUS_BODY, 'dpr', info.pixelRatio.toFixed(2));
  const s = document.createElement('div');
  s.style.marginTop = '6px';
  s.textContent = `state · ${info.state}`;
  STATUS_BODY.appendChild(s);
}

function appendRow(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  row.className = 'row';
  const k = document.createElement('span');
  k.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  parent.appendChild(row);
}

function renderRuntimePicker(): void {
  STATUS_BODY.innerHTML = '';
  const lead = document.createElement('div');
  lead.textContent =
    'Pick a runtime to benchmark. Runs a 60s deterministic orbit and emits p50/p95 frame timings.';
  STATUS_BODY.appendChild(lead);
  const links = document.createElement('div');
  links.style.marginTop = '8px';
  for (const id of ['spark', 'gsplatjs'] as const) {
    const a = document.createElement('a');
    a.href = `?runtime=${id}`;
    a.textContent = id;
    a.style.marginRight = '12px';
    links.appendChild(a);
  }
  STATUS_BODY.appendChild(links);
}

function renderResults(result: BenchResult, runtime: SplatRuntime): void {
  RESULTS_PANEL.removeAttribute('hidden');
  RESULTS_BODY.innerHTML = '';
  appendRow(
    RESULTS_BODY,
    'frame p50 / p95 / p99',
    `${result.frame.p50Ms} / ${result.frame.p95Ms} / ${result.frame.p99Ms} ms`,
  );
  appendRow(RESULTS_BODY, 'frames / mean', `${result.frame.count} · ${result.frame.meanMs} ms`);
  appendRow(RESULTS_BODY, 'first splat frame', `${result.timing.firstSplatFrameMs} ms`);
  appendRow(
    RESULTS_BODY,
    'splats',
    `${result.asset.effectiveSplats.toLocaleString()} (${result.asset.duplicateTiles}× ${result.asset.sourceSplats.toLocaleString()})`,
  );
  appendRow(RESULTS_BODY, 'context', result.runtime.contextLabel);

  const json = document.createElement('pre');
  json.textContent = JSON.stringify(result, null, 2);
  RESULTS_BODY.appendChild(json);

  const btn = document.createElement('button');
  btn.textContent = 'copy JSON';
  btn.style.marginTop = '6px';
  btn.addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    btn.textContent = 'copied ✓';
    setTimeout(() => {
      btn.textContent = 'copy JSON';
    }, 1500);
  });
  RESULTS_BODY.appendChild(btn);

  void runtime;
  void result;
}

function reportError(err: unknown): void {
  console.error('[dwea-55-bench] fatal', err);
  STATUS_BODY.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'err';
  div.textContent = `fatal · ${err instanceof Error ? err.message : String(err)}`;
  STATUS_BODY.appendChild(div);
}

function withBase(rel: string): string {
  // Vite injects the configured base path here, so the harness works on both
  // `pnpm dev` (base `/`) and the gh-pages deploy (base `/dwea/`).
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  return `${base}/${rel.replace(/^\//, '')}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function mustGetById(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}
