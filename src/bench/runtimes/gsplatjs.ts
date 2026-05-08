/**
 * gsplat.js adapter for the splat-runtime bench.
 *
 * gsplat.js ships its own scene graph + WebGL renderer; this adapter wires it
 * up directly without Three.js. The harness records frame timings via rAF
 * deltas the same way it does for the Spark adapter, so the numbers are
 * comparable across the two stacks.
 */

import * as SPLAT from 'gsplat';
import type { RuntimeMountArgs, RuntimeMountResult, SplatRuntime } from './types.js';

export const gsplatjsRuntime: SplatRuntime = {
  id: 'gsplatjs',
  label: 'gsplat.js (HuggingFace)',
  async mount(args: RuntimeMountArgs): Promise<RuntimeMountResult> {
    const { container, splatBytes } = args;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const renderer = new SPLAT.WebGLRenderer(canvas);
    renderer.setSize(Math.floor(width * args.pixelRatio), Math.floor(height * args.pixelRatio));

    const scene = new SPLAT.Scene();
    const camera = new SPLAT.Camera();

    // gsplat.js' Loader.LoadAsync only takes a URL. To keep the harness fair
    // (same in-memory bytes for both runtimes, no double-fetch from the network)
    // we materialise the duplicated bytes as a blob: URL.
    // Slice into a fresh ArrayBuffer — TS' lib.dom typings widened `Uint8Array`
    // to `Uint8Array<ArrayBufferLike>` and the Blob constructor only accepts
    // the narrower `Uint8Array<ArrayBuffer>`.
    const ab = splatBytes.buffer.slice(
      splatBytes.byteOffset,
      splatBytes.byteOffset + splatBytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const ready = SPLAT.Loader.LoadAsync(url, scene, () => undefined)
      .then(() => undefined)
      .finally(() => URL.revokeObjectURL(url));

    const onResize = (): void => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setSize(Math.floor(w * args.pixelRatio), Math.floor(h * args.pixelRatio));
    };
    window.addEventListener('resize', onResize);

    function render(pose: {
      position: [number, number, number];
      target: [number, number, number];
    }): void {
      camera.position = new SPLAT.Vector3(pose.position[0], pose.position[1], pose.position[2]);
      const forward = new SPLAT.Vector3(
        pose.target[0] - pose.position[0],
        pose.target[1] - pose.position[1],
        pose.target[2] - pose.position[2],
      ).normalize();
      camera.rotation = SPLAT.Quaternion.LookRotation(forward);
      renderer.render(scene, camera);
    }

    function dispose(): void {
      window.removeEventListener('resize', onResize);
      try {
        renderer.dispose();
      } catch {
        // dispose is sometimes unsafe if the GL context already crashed.
      }
      canvas.remove();
    }

    return {
      ready,
      render,
      dispose,
      contextLabel: 'WebGL2 (gsplat.js standalone)',
    };
  },
};
