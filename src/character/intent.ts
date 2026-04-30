/**
 * Typed intent surface for the character runtime.
 *
 * T3 (this branch) defines the contract; T2 (DWEA-17) provides the real
 * implementation that drives Ecctrl + three-ik + AnimationMixer. Until then,
 * `createStubIntentSurface` (intent.stub.ts) gives the LLM motor a runnable
 * end-to-end target.
 *
 * Each method returns a Promise that resolves when the action completes.
 * Implementations MUST honour the AbortSignal — a queue interrupt aborts the
 * controller so the in-flight motion has to release the held resource.
 */

import type {
  LookAtArgs,
  MoveToArgs,
  PlayAnimationArgs,
  PointAtArgs,
  SpeakArgs,
} from './schema.js';

export interface IntentSurface {
  moveTo(args: MoveToArgs, signal: AbortSignal): Promise<void>;
  lookAt(args: LookAtArgs, signal: AbortSignal): Promise<void>;
  playAnimation(args: PlayAnimationArgs, signal: AbortSignal): Promise<void>;
  pointAt(args: PointAtArgs, signal: AbortSignal): Promise<void>;
  speak(args: SpeakArgs, signal: AbortSignal): Promise<void>;
}
