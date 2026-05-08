/**
 * Hardware-tier presets for the v1 frame-budget bench (DWEA-59) keyed against
 * the [v1 Realism Bar §2](/DWEA/issues/DWEA-52#document-v1-realism-bar).
 *
 * Each preset bundles:
 *  - the active-splat target the bench should hit on the device
 *  - the §2 sustained-fps commitment for that tier
 *  - the §6 rejection thresholds the bench can evaluate from its own probes
 *    (initial JS+wasm transfer, first-scene splat payload, GPU buffer)
 *
 * The runtime renderer (Spark or gsplat.js) is orthogonal to the tier — the
 * same preset is meant to be replayed across both runtimes for the OD-3
 * bake-off in [DWEA-55](/DWEA/issues/DWEA-55).
 */

export type TierId = 'laptop-a' | 'laptop-b' | 'laptop-c' | 'mobile-a' | 'mobile-b';

export type Tier = {
  readonly id: TierId;
  /** Short human-facing label. */
  readonly label: string;
  /** Reference hardware example (informational; the bench reads UA / navigator.gpu). */
  readonly referenceHardware: string;
  /** §2 active-splats-per-frame target. Drives `?dup=` autoselect. */
  readonly activeSplatsTarget: number;
  /** §2 sustained-fps target the bench evaluates against (PASS threshold). */
  readonly targetFps: number;
  /** §6 reject-if-min-fps-below-this on this tier (FAIL threshold). */
  readonly minSustainedFpsFloor: number;
  /** §2 GPU buffer ceiling (MB), informational; bench probe is best-effort. */
  readonly gpuBufferCeilingMb: number;
  /** §6 GPU buffer reject-if-above (MB) on the laptop tier; null on mobile (§6 doesn't quote one). */
  readonly gpuBufferRejectMb: number | null;
  /** §6 reject-if-initial-payload-above (MB) — applies to all tiers. */
  readonly initialPayloadRejectMb: number;
  /** §2 initial-JS+wasm transferred ceiling (MB) — laptop only; null on mobile. */
  readonly initialJsWasmCeilingMb: number | null;
  /** §2 first-scene splat payload ceiling (MB) — laptop only; null on mobile. */
  readonly firstSceneSplatCeilingMb: number | null;
};

export const TIERS: Readonly<Record<TierId, Tier>> = {
  'laptop-a': {
    id: 'laptop-a',
    label: 'Laptop A — unified mem (M2 Air)',
    referenceHardware: 'M2 Air (8/16 GB)',
    activeSplatsTarget: 1_250_000,
    targetFps: 60,
    minSustainedFpsFloor: 30,
    gpuBufferCeilingMb: 600,
    gpuBufferRejectMb: 800,
    initialPayloadRejectMb: 25,
    initialJsWasmCeilingMb: 25,
    firstSceneSplatCeilingMb: 15,
  },
  'laptop-b': {
    id: 'laptop-b',
    label: 'Laptop B — discrete dGPU (RTX 30-series mobile)',
    referenceHardware: 'RTX 3050 / 3060 mobile',
    activeSplatsTarget: 1_500_000,
    targetFps: 60,
    minSustainedFpsFloor: 30,
    gpuBufferCeilingMb: 600,
    gpuBufferRejectMb: 800,
    initialPayloadRejectMb: 25,
    initialJsWasmCeilingMb: 25,
    firstSceneSplatCeilingMb: 15,
  },
  'laptop-c': {
    id: 'laptop-c',
    label: 'Laptop C — integrated (Iris Xe + 16 GB)',
    referenceHardware: 'Iris Xe + 16 GB RAM',
    activeSplatsTarget: 1_000_000,
    targetFps: 30,
    minSustainedFpsFloor: 30,
    gpuBufferCeilingMb: 600,
    gpuBufferRejectMb: 800,
    initialPayloadRejectMb: 25,
    initialJsWasmCeilingMb: 25,
    firstSceneSplatCeilingMb: 15,
  },
  'mobile-a': {
    id: 'mobile-a',
    label: 'Mobile A — iPhone 13 / 14',
    referenceHardware: 'iPhone 13 / 14',
    activeSplatsTarget: 500_000,
    targetFps: 30,
    minSustainedFpsFloor: 30,
    gpuBufferCeilingMb: 250,
    gpuBufferRejectMb: null,
    initialPayloadRejectMb: 25,
    initialJsWasmCeilingMb: null,
    firstSceneSplatCeilingMb: null,
  },
  'mobile-b': {
    id: 'mobile-b',
    label: 'Mobile B — mid-range Android 2024 (Pixel 7a)',
    referenceHardware: 'Pixel 7a / equivalent',
    activeSplatsTarget: 500_000,
    targetFps: 30,
    minSustainedFpsFloor: 30,
    gpuBufferCeilingMb: 250,
    gpuBufferRejectMb: null,
    initialPayloadRejectMb: 25,
    initialJsWasmCeilingMb: null,
    firstSceneSplatCeilingMb: null,
  },
} as const;

export function getTier(id: string | null | undefined): Tier | null {
  if (!id) return null;
  return Object.hasOwn(TIERS, id) ? TIERS[id as TierId] : null;
}

/**
 * Smallest tile count that hits `tier.activeSplatsTarget` given a source asset
 * with `perTile` splats. Always a perfect square (the duplicator's contract)
 * and at minimum 1.
 */
export function tilesForTier(tier: Tier, perTile: number): number {
  if (perTile <= 0) return 1;
  const ratio = tier.activeSplatsTarget / perTile;
  const linear = Math.max(1, Math.ceil(Math.sqrt(ratio)));
  return linear * linear;
}

export type PassFail = 'pass' | 'fail' | 'na';

export type TierMeasurement = {
  readonly p50Fps: number | null;
  readonly minFps: number | null;
  readonly gpuBufferMb: number | null;
  readonly initialJsWasmMb: number | null;
  readonly firstSceneSplatMb: number | null;
};

export type TierEvaluation = {
  /** §2 sustained-fps verdict. PASS iff p50 ≥ targetFps and min ≥ minSustainedFpsFloor. */
  readonly sustainedFps: PassFail;
  /** §6 GPU-buffer reject criterion, when measurable + applicable to tier. */
  readonly gpuBuffer: PassFail;
  /** §6 initial-payload reject criterion (JS+wasm + first-scene splat over the wire). */
  readonly initialPayload: PassFail;
  /** Notes explaining why a verdict is `na`. */
  readonly notes: ReadonlyArray<string>;
};

/**
 * Evaluate a measurement against the §2 commitments and §6 reject criteria
 * for the named tier. We intentionally evaluate §6 rejection separately from
 * §2 commitments so a "missed §2 target but inside §6" run gets reported as
 * a borderline pass rather than a hard fail — §2 is "what we promised", §6
 * is "what gets the asset rejected from v1".
 */
export function evaluate(tier: Tier, m: TierMeasurement): TierEvaluation {
  const notes: string[] = [];

  let sustainedFps: PassFail;
  if (m.p50Fps === null || m.minFps === null) {
    sustainedFps = 'na';
    notes.push('fps not recorded');
  } else if (m.minFps < tier.minSustainedFpsFloor) {
    sustainedFps = 'fail';
  } else if (m.p50Fps >= tier.targetFps) {
    sustainedFps = 'pass';
  } else {
    sustainedFps = 'fail';
  }

  let gpuBuffer: PassFail;
  if (tier.gpuBufferRejectMb === null) {
    gpuBuffer = 'na';
    notes.push('§6 GPU-buffer reject threshold not specified for this tier');
  } else if (m.gpuBufferMb === null) {
    gpuBuffer = 'na';
    notes.push('GPU buffer estimate unavailable on this device');
  } else if (m.gpuBufferMb > tier.gpuBufferRejectMb) {
    gpuBuffer = 'fail';
  } else {
    gpuBuffer = 'pass';
  }

  let initialPayload: PassFail;
  const summed = sumNullable(m.initialJsWasmMb, m.firstSceneSplatMb);
  if (summed === null) {
    initialPayload = 'na';
    notes.push('initial transfer total unavailable');
  } else if (summed > tier.initialPayloadRejectMb) {
    initialPayload = 'fail';
  } else {
    initialPayload = 'pass';
  }

  return { sustainedFps, gpuBuffer, initialPayload, notes };
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
