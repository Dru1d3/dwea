import { Splat } from '@react-three/drei';
import { useEffect, useState } from 'react';
import { fitGround } from './splats/fitGround.js';
import type { SplatTransform } from './splats/registry.js';
import { DEFAULT_TRANSFORM } from './splats/registry.js';
import type { Tuning } from './splats/tuningStore.js';

export type SplatGroundFit = {
  /** Target ground Y in world space (metres). Default 0. */
  readonly groundY?: number;
  /** Percentile of rendered Y to align with the ground. Default 1. */
  readonly percentile?: number;
};

export type SplatSceneProps = {
  readonly src: string;
  readonly transform?: SplatTransform;
  /**
   * If provided, the splat is auto-aligned to the ground by sampling its own
   * Y distribution. The Y component of `transform.position` is ignored — auto
   * fit owns Y. X/Z and scale/rotation still apply.
   */
  readonly groundFit?: SplatGroundFit;
  /**
   * User-supplied scene tuning override (from the in-page `<SceneTuner>`).
   * When provided, the override fully replaces the registry transform AND
   * bypasses auto-fit so the user can dial in absolute values.
   */
  readonly tuning?: Tuning;
};

export function SplatScene({ src, transform, groundFit, tuning }: SplatSceneProps) {
  const t = transform ?? {};
  const baseScale = t.scale ?? DEFAULT_TRANSFORM.scale;
  const baseRotation = t.rotation ?? DEFAULT_TRANSFORM.rotation;
  const baseManualPosition = t.position ?? DEFAULT_TRANSFORM.position;

  const tuned = tuning != null;
  const fitEnabled = !tuned && groundFit !== undefined;

  const fitGroundY = groundFit?.groundY ?? 0;
  const fitPercentile = groundFit?.percentile ?? 1;
  const fittedY = useFittedGroundY(fitEnabled ? src : null, fitGroundY, fitPercentile, baseScale);

  let position: [number, number, number];
  let rotation: [number, number, number];
  let scale: number;
  if (tuned) {
    position = [tuning.position[0], tuning.position[1], tuning.position[2]];
    rotation = [tuning.rotation[0], tuning.rotation[1], tuning.rotation[2]];
    scale = tuning.scale;
  } else {
    // Auto-fit owns Y when enabled. While the fit is in flight (`fittedY` is
    // null) we render at world ground; a brief sub-second pop is preferable
    // to showing the splat at a clearly-wrong hardcoded offset.
    const positionY = fitEnabled ? (fittedY ?? fitGroundY) : baseManualPosition[1];
    position = [baseManualPosition[0], positionY, baseManualPosition[2]];
    rotation = [baseRotation[0], baseRotation[1], baseRotation[2]];
    scale = baseScale;
  }

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Splat key={src} src={src} />
    </group>
  );
}

function useFittedGroundY(
  src: string | null,
  groundY: number,
  percentile: number,
  scale: number,
): number | null {
  const [offsetY, setOffsetY] = useState<number | null>(null);

  useEffect(() => {
    if (!src) {
      setOffsetY(null);
      return;
    }
    let cancelled = false;
    setOffsetY(null);
    fitGround(src, { groundY, percentile, scale })
      .then((fit) => {
        if (!cancelled) setOffsetY(fit.offsetY);
      })
      .catch((err: unknown) => {
        // Auto-fit is best-effort. Fall back to manual position on failure.
        console.warn('[SplatScene] ground auto-fit failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [src, groundY, percentile, scale]);

  return offsetY;
}
