import { Splat } from '@react-three/drei';
import { useEffect, useState } from 'react';
import { fitGround } from './splats/fitGround.js';
import type { SplatTransform } from './splats/registry.js';
import { DEFAULT_TRANSFORM } from './splats/registry.js';

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
};

export function SplatScene({ src, transform, groundFit }: SplatSceneProps) {
  const t = transform ?? {};
  const scale = t.scale ?? DEFAULT_TRANSFORM.scale;
  const rotation = t.rotation ?? DEFAULT_TRANSFORM.rotation;
  const manualPosition = t.position ?? DEFAULT_TRANSFORM.position;

  const fitGroundY = groundFit?.groundY ?? 0;
  const fitPercentile = groundFit?.percentile ?? 1;
  const fittedY = useFittedGroundY(groundFit ? src : null, fitGroundY, fitPercentile, scale);

  // Auto-fit owns Y when enabled. While the fit is in flight (`fittedY` is
  // null) we render at world ground; a brief sub-second pop is preferable to
  // showing the splat at a clearly-wrong hardcoded offset.
  const positionY = groundFit ? (fittedY ?? fitGroundY) : manualPosition[1];

  const position: [number, number, number] = [manualPosition[0], positionY, manualPosition[2]];

  return (
    <group position={position} rotation={rotation as [number, number, number]} scale={scale}>
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
