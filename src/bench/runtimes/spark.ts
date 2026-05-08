/**
 * Spark adapter for the splat-runtime bench.
 *
 * Drops a `SparkRenderer` + `SplatMesh` into a vanilla Three.js scene. We
 * deliberately reuse a hand-rolled Three.js setup (no R3F, no rapier, no
 * character) so the only confounders against the gsplat.js path are
 *  - the runtime's own sort/render
 *  - the Three.js object3d/scene-graph overhead, which is the v1 baseline.
 */

import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { RuntimeMountArgs, RuntimeMountResult, SplatRuntime } from './types.js';

export const sparkRuntime: SplatRuntime = {
  id: 'spark',
  label: 'Spark @sparkjsdev/spark',
  async mount(args: RuntimeMountArgs): Promise<RuntimeMountResult> {
    const { container, splatBytes, onCameraTarget } = args;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(args.pixelRatio);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x07090c, 1);
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, width / height, 0.05, 200);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const mesh = new SplatMesh({ fileBytes: splatBytes, fileName: 'bench.splat' });
    scene.add(mesh);

    const ready = mesh.initialized.then(() => undefined);

    const tmpTarget = new Vector3();
    const onResize = (): void => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener('resize', onResize);

    function render(pose: {
      position: [number, number, number];
      target: [number, number, number];
    }): void {
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      tmpTarget.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.lookAt(tmpTarget);
      onCameraTarget?.(camera, tmpTarget);
      renderer.render(scene, camera);
    }

    function dispose(): void {
      window.removeEventListener('resize', onResize);
      mesh.dispose?.();
      spark.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
    }

    return {
      ready,
      render,
      dispose,
      contextLabel: `WebGL2 (Three.js r${import.meta.env.VITE_THREE_VERSION ?? '170+'})`,
    };
  },
};
