/**
 * Stub IntentSurface for standalone T3 development. Approximates each
 * action's wall-clock duration with `setTimeout` so the action queue can be
 * exercised end-to-end (FIFO ordering, interrupts, lock release) without T2.
 *
 * Replace with the real intent surface (driven by Ecctrl / three-ik /
 * AnimationMixer) when T2 (DWEA-17) lands.
 */
import type { IntentSurface } from './intent.js';
import type {
  LookAtArgs,
  MoveToArgs,
  PlayAnimationArgs,
  PointAtArgs,
  SpeakArgs,
} from './schema.js';

const WALK_SPEED = 1.5;
const ANIM_DEFAULT_MS = 1500;
const POINT_HOLD_MS = 1200;
const LOOK_FADE_MS = 350;
const SPEAK_PER_CHAR_MS = 35;

export type StubLogKind = 'start' | 'end' | 'abort';

export interface StubLogEntry {
  ts: number;
  kind: StubLogKind;
  tool: string;
  args: unknown;
}

export interface StubIntentSurface extends IntentSurface {
  position(): { x: number; y: number; z: number };
  log(): readonly StubLogEntry[];
}

function awaitable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      return;
    }
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(handle);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createStubIntentSurface(opts?: {
  initialPosition?: { x: number; y: number; z: number };
  walkSpeed?: number;
}): StubIntentSurface {
  let pos = { ...(opts?.initialPosition ?? { x: 0, y: 0, z: 0 }) };
  const speed = opts?.walkSpeed ?? WALK_SPEED;
  const log: StubLogEntry[] = [];

  const wrap = async <T>(tool: string, args: T, run: () => Promise<void>): Promise<void> => {
    log.push({ ts: performance.now(), kind: 'start', tool, args });
    try {
      await run();
      log.push({ ts: performance.now(), kind: 'end', tool, args });
    } catch (err) {
      log.push({ ts: performance.now(), kind: 'abort', tool, args });
      throw err;
    }
  };

  return {
    position() {
      return { ...pos };
    },
    log() {
      return log;
    },
    moveTo: (args: MoveToArgs, signal: AbortSignal) =>
      wrap('move_to', args, async () => {
        const dx = args.x - pos.x;
        const dy = args.y - pos.y;
        const dz = args.z - pos.z;
        const dist = Math.hypot(dx, dy, dz);
        const ms = Math.max(50, (dist / speed) * 1000);
        await awaitable(ms, signal);
        pos = { x: args.x, y: args.y, z: args.z };
      }),
    lookAt: (args: LookAtArgs, signal: AbortSignal) =>
      wrap('look_at', args, () => awaitable(LOOK_FADE_MS, signal)),
    playAnimation: (args: PlayAnimationArgs, signal: AbortSignal) =>
      wrap('play_animation', args, () => awaitable(ANIM_DEFAULT_MS, signal)),
    pointAt: (args: PointAtArgs, signal: AbortSignal) =>
      wrap('point_at', args, () => awaitable(POINT_HOLD_MS, signal)),
    speak: (args: SpeakArgs, signal: AbortSignal) =>
      wrap('speak', args, () => awaitable(args.text.length * SPEAK_PER_CHAR_MS, signal)),
  };
}
