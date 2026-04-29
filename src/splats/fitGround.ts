/**
 * Auto-fit a cakewalk antimatter15-format `.splat` asset to a target ground
 * plane.
 *
 * Per-asset hardcoded Y offsets (`position: [0, -1.2, 0]` etc) are guesses —
 * they drift from real ground level whenever a splat's origin is offset from
 * its captured ground, and they cannot be tuned without a browser. Instead,
 * we read the file's own Y distribution and shift the group so its lower
 * percentile lands at the world ground.
 *
 * Why this works for cakewalk format:
 * - drei's `<Splat>` renders local Y as `-file_y` (see node_modules/@react-
 *   three/drei/core/Splat.js, `pushDataBuffer` flips the Y component when
 *   building the centerAndScale texture). So the rendered local Y of vertex
 *   `i` is `-file_y`. The bottom of the rendered cloud corresponds to the
 *   *highest* file Y values.
 * - Photogrammetric captures usually have far more "ground / floor" splats
 *   than ceiling/canopy splats, but a few outliers extend below. A small
 *   percentile (default 1%) ignores those outliers without losing the real
 *   floor.
 *
 * Net offset (uniform group scale `s`, target ground `g`):
 *   posY = g - s * lowerRenderedLocalY
 *        = g + s * fileY_atUpperPercentile
 */

const ROW_LENGTH = 32; // 12 (xyz) + 12 (scale) + 4 (rgba) + 4 (quat)

export type GroundFit = {
  /** Y offset to apply to the splat group so the cloud's lower percentile sits at groundY. */
  readonly offsetY: number;
  /** Diagnostic distribution (rendered local Y, i.e. -file_y). */
  readonly stats: {
    readonly min: number;
    readonly max: number;
    readonly p1: number;
    readonly p5: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly count: number;
  };
};

export type FitOptions = {
  /** Target ground Y in world space. Default 0. */
  readonly groundY?: number;
  /** Percentile of *rendered* Y to align with the ground. Default 1 (lower 1% land at ground). */
  readonly percentile?: number;
  /** Uniform group scale. Default 1. */
  readonly scale?: number;
};

const cache = new Map<string, Promise<GroundFit>>();

export function clearGroundFitCache(): void {
  cache.clear();
}

export async function fitGround(url: string, opts: FitOptions = {}): Promise<GroundFit> {
  const key = cacheKey(url, opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = doFit(url, opts);
  cache.set(key, pending);
  // If the fetch itself fails, allow a retry on the next mount.
  pending.catch(() => {
    cache.delete(key);
  });
  return pending;
}

async function doFit(url: string, opts: FitOptions): Promise<GroundFit> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`fitGround: fetch ${url} failed with ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return computeFit(buf, opts);
}

export function computeFit(buf: ArrayBuffer, opts: FitOptions = {}): GroundFit {
  const groundY = opts.groundY ?? 0;
  const percentile = clamp(opts.percentile ?? 1, 0, 100);
  const scale = opts.scale ?? 1;

  const view = new DataView(buf);
  const count = Math.floor(buf.byteLength / ROW_LENGTH);
  if (count === 0) {
    return {
      offsetY: groundY,
      stats: { min: 0, max: 0, p1: 0, p5: 0, p50: 0, p95: 0, p99: 0, count: 0 },
    };
  }

  // Rendered local Y is `-file_y` (drei Y-flip in pushDataBuffer).
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const fileY = view.getFloat32(i * ROW_LENGTH + 4, true);
    ys[i] = -fileY;
  }

  // Sort ascending so percentile selection is straightforward.
  const sorted = ys.slice().sort();
  const stats = {
    min: pick(sorted, 0),
    max: pick(sorted, 100),
    p1: pick(sorted, 1),
    p5: pick(sorted, 5),
    p50: pick(sorted, 50),
    p95: pick(sorted, 95),
    p99: pick(sorted, 99),
    count,
  };

  const lowerLocal = pick(sorted, percentile);
  // world_y = posY + scale * lowerLocal === groundY  →  posY = groundY - scale * lowerLocal.
  const offsetY = groundY - scale * lowerLocal;

  return { offsetY, stats };
}

function pick(sorted: Float32Array, percentile: number): number {
  const idx = clamp(Math.floor((percentile / 100) * sorted.length), 0, sorted.length - 1);
  // sorted is non-empty by construction at every call site (count > 0 guarded above).
  return sorted[idx] as number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function cacheKey(url: string, opts: FitOptions): string {
  return `${url}|g=${opts.groundY ?? 0}|p=${opts.percentile ?? 1}|s=${opts.scale ?? 1}`;
}
