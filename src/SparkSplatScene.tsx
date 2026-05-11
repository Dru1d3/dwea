import { useFrame, useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SplatTransform } from './splats/registry.js';
import { DEFAULT_TRANSFORM } from './splats/registry.js';

export type SparkSplatSceneProps = {
  readonly src: string;
  readonly transform?: SplatTransform;
  /**
   * Reported once when SplatMesh fires `onLoad` and exposes its packed splat
   * count. The bench harness uses this to log "active splats" alongside fps.
   */
  readonly onLoaded?: (info: { numSplats: number; src: string }) => void;
  /**
   * Reported on the first frame the splat actually contributes pixels (i.e.
   * Spark's accumulator has at least one active splat). The bench harness
   * uses this to mark TTFA.
   */
  readonly onFirstSplatFrame?: () => void;
};

/**
 * Spark.js renderer mounted as a sibling of the existing drei `<Splat>` path,
 * gated by `?renderer=spark` (see App.tsx). One `SparkRenderer` per Canvas;
 * one `SplatMesh` per src.
 *
 * Spark's `SparkRenderer` extends THREE.Mesh and must live in the scene graph
 * — adding it via `<primitive>` lets r3f auto-dispose on unmount.
 */
export function SparkSplatScene({
  src,
  transform,
  onLoaded,
  onFirstSplatFrame,
}: SparkSplatSceneProps) {
  const gl = useThree((s) => s.gl);

  const sparkRenderer = useMemo(() => new SparkRenderer({ renderer: gl }), [gl]);

  const [splat, setSplat] = useState<SplatMesh | null>(null);
  const reportedFirstSplatFrame = useRef(false);

  // Recreate the SplatMesh whenever the URL changes. SplatMesh kicks off the
  // network fetch in its constructor.
  useEffect(() => {
    reportedFirstSplatFrame.current = false;
    const mesh = new SplatMesh({
      url: src,
      onLoad: (m) => {
        try {
          const num = m.packedSplats?.getNumSplats?.() ?? 0;
          onLoaded?.({ numSplats: num, src });
        } catch {
          onLoaded?.({ numSplats: 0, src });
        }
      },
    });
    setSplat(mesh);
    return () => {
      try {
        mesh.dispose?.();
      } catch {
        // Spark's dispose is best-effort; fall through.
      }
    };
  }, [src, onLoaded]);

  useFrame(() => {
    if (reportedFirstSplatFrame.current) return;
    if (sparkRenderer.activeSplats > 0) {
      reportedFirstSplatFrame.current = true;
      onFirstSplatFrame?.();
    }
  });

  const t = transform ?? {};
  const scale = t.scale ?? DEFAULT_TRANSFORM.scale;
  const position = t.position ?? DEFAULT_TRANSFORM.position;
  const rotation = t.rotation ?? DEFAULT_TRANSFORM.rotation;

  return (
    <>
      {/* SparkRenderer must be in the scene graph so r3f traverses + disposes it. */}
      <primitive object={sparkRenderer} />
      {splat ? (
        <group
          position={position as unknown as [number, number, number]}
          rotation={rotation as unknown as [number, number, number]}
          scale={scale}
        >
          <primitive object={splat} />
        </group>
      ) : null}
    </>
  );
}
