/**
 * Shared interface for splat-runtime adapters used by the bench.
 */

import type { CameraPose } from '../orbit.js';

export type RuntimeMountArgs = {
  readonly container: HTMLElement;
  readonly splatBytes: Uint8Array;
  /** devicePixelRatio to render at; capped by harness to keep mobile honest. */
  readonly pixelRatio: number;
  /** Optional notifier when a runtime aims its camera (debug only). */
  readonly onCameraTarget?: (camera: unknown, target: unknown) => void;
};

export type RuntimeMountResult = {
  /** Resolves when the splat scene is ready to render the first real frame. */
  readonly ready: Promise<void>;
  /** Render one frame at the supplied camera pose. */
  readonly render: (pose: CameraPose) => void;
  /** Tear down GPU + DOM resources. */
  readonly dispose: () => void;
  /** Free-form label for the rendering context (WebGL2 / WebGPU / version). */
  readonly contextLabel: string;
};

export type SplatRuntime = {
  readonly id: 'spark' | 'gsplatjs';
  readonly label: string;
  mount(args: RuntimeMountArgs): Promise<RuntimeMountResult>;
};
