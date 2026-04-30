import { describe, expect, it } from 'vitest';
import type { IntentSurface } from './intent.js';
import { ActionQueue, type QueueEvent } from './queue.js';
import type {
  LookAtArgs,
  MoveToArgs,
  PlayAnimationArgs,
  PointAtArgs,
  SpeakArgs,
} from './schema.js';

/**
 * Test intent that records start/end and only resolves when the test
 * explicitly settles each call. Lets us assert FIFO ordering, interrupt
 * semantics, and per-resource lock release deterministically without sleeps.
 */

interface Pending {
  tool: string;
  args: unknown;
  resolve: () => void;
  reject: (err: unknown) => void;
  ended: boolean;
}

function createTestIntent(): {
  intent: IntentSurface;
  settle(tool: string): boolean;
  startedTools(): string[];
  endedTools(): string[];
  abortedTools(): string[];
} {
  const pending: Pending[] = [];

  const arm = <T>(tool: string, args: T, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const entry: Pending = {
        tool,
        args,
        ended: false,
        resolve: () => {
          entry.ended = true;
          resolve();
        },
        reject: (err) => {
          entry.ended = true;
          reject(err);
        },
      };
      pending.push(entry);
      if (signal.aborted) {
        entry.reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          if (!entry.ended) {
            entry.reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          }
        },
        { once: true },
      );
    });

  const intent: IntentSurface = {
    moveTo: (args: MoveToArgs, signal: AbortSignal) => arm('move_to', args, signal),
    lookAt: (args: LookAtArgs, signal: AbortSignal) => arm('look_at', args, signal),
    playAnimation: (args: PlayAnimationArgs, signal: AbortSignal) =>
      arm('play_animation', args, signal),
    pointAt: (args: PointAtArgs, signal: AbortSignal) => arm('point_at', args, signal),
    speak: (args: SpeakArgs, signal: AbortSignal) => arm('speak', args, signal),
  };

  return {
    intent,
    settle(tool: string): boolean {
      const target = pending.find((p) => p.tool === tool && !p.ended);
      if (!target) return false;
      target.resolve();
      return true;
    },
    startedTools: () => pending.map((p) => p.tool),
    endedTools: () => pending.filter((p) => p.ended).map((p) => p.tool),
    abortedTools: () => pending.filter((p) => p.ended).map((p) => p.tool),
  };
}

function recordEvents(queue: ActionQueue): { events: QueueEvent[]; off: () => void } {
  const events: QueueEvent[] = [];
  const off = queue.on((e) => events.push(e));
  return { events, off };
}

// Microtask flush — await an empty Promise a few times so any microtask
// chains inside the queue's then/catch settle before we assert.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

describe('ActionQueue', () => {
  it('runs FIFO and serializes — point_at waits for move_to even though resources do not overlap', async () => {
    // This is the "walk to the rock and point at it" acceptance: character
    // walks, THEN points. Strict FIFO, not concurrent dispatch.
    const { intent, settle, startedTools } = createTestIntent();
    const queue = new ActionQueue({ intent });
    const { events } = recordEvents(queue);

    queue.enqueue({ name: 'move_to', input: { x: 1, y: 0, z: 1 } });
    queue.enqueue({ name: 'point_at', input: { target_id: 'rock' } });

    await flush();
    expect(startedTools()).toEqual(['move_to']);
    expect(queue.pendingSize()).toBe(1);

    expect(settle('move_to')).toBe(true);
    await flush();

    // move_to completed → its resources released → point_at dispatches.
    expect(startedTools()).toEqual(['move_to', 'point_at']);
    expect(queue.pendingSize()).toBe(0);

    expect(settle('point_at')).toBe(true);
    await flush();

    const order = events
      .filter(
        (e): e is Extract<QueueEvent, { type: 'started' } | { type: 'completed' }> =>
          e.type === 'started' || e.type === 'completed',
      )
      .map((e) => `${e.type}:${e.action.call.name}`);
    expect(order).toEqual([
      'started:move_to',
      'completed:move_to',
      'started:point_at',
      'completed:point_at',
    ]);
  });

  it('interrupt-mode play_animation aborts in-flight, drops pending, and runs immediately', async () => {
    // The "stop" acceptance: user types stop → play_animation('idle','interrupt')
    // → walking and any queued actions are wiped, idle starts now.
    const { intent, settle, startedTools, endedTools } = createTestIntent();
    const queue = new ActionQueue({ intent });
    const { events } = recordEvents(queue);

    queue.enqueue({ name: 'move_to', input: { x: 5, y: 0, z: 0 } });
    queue.enqueue({ name: 'point_at', input: { target_id: 'rock' } });
    queue.enqueue({ name: 'speak', input: { text: 'on my way' } });

    await flush();
    expect(startedTools()).toEqual(['move_to']);
    expect(queue.pendingSize()).toBe(2);

    queue.enqueue({
      name: 'play_animation',
      input: { clip_id: 'idle', mode: 'interrupt' },
    });
    await flush();

    expect(endedTools()).toEqual(['move_to']);
    expect(startedTools()).toEqual(['move_to', 'play_animation']);
    expect(queue.pendingSize()).toBe(0);

    const aborted = events
      .filter((e): e is Extract<QueueEvent, { type: 'aborted' }> => e.type === 'aborted')
      .map((e) => `${e.action.call.name}:${e.reason}`);
    // pending dropped first (point_at, speak), then in-flight move_to aborted.
    expect(aborted).toEqual(['point_at:interrupt', 'speak:interrupt', 'move_to:interrupt']);

    expect(settle('play_animation')).toBe(true);
    await flush();
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('per-resource lock release on hand-off: new look_at preempts in-flight look_at', async () => {
    // "Conflicting tools release the held resource on hand-off" — IK
    // trackers (look_at, point_at) are continuous; the latest one wins.
    const { intent, settle, startedTools, endedTools } = createTestIntent();
    const queue = new ActionQueue({ intent });
    const { events } = recordEvents(queue);

    queue.enqueue({ name: 'look_at', input: { target_id: 'camera' } });
    await flush();
    expect(startedTools()).toEqual(['look_at']);

    // New look_at arrives — old one releases the head, new one takes over.
    queue.enqueue({ name: 'look_at', input: { target_id: 'rock' } });
    await flush();

    expect(endedTools()).toEqual(['look_at']); // first look_at aborted
    expect(startedTools()).toEqual(['look_at', 'look_at']);
    expect(queue.inFlight().map((a) => a.call.input)).toEqual([{ target_id: 'rock' }]);

    const replaced = events.find(
      (e): e is Extract<QueueEvent, { type: 'aborted' }> =>
        e.type === 'aborted' && e.reason === 'replaced',
    );
    expect(replaced?.action.call.name).toBe('look_at');

    expect(settle('look_at')).toBe(true);
    await flush();
    expect(queue.inFlight()).toEqual([]);
  });

  it('per-resource lock release on completion: completed move_to releases legs so the next pending action can run', async () => {
    // Validates that completing an action emits 'completed' AND advances the
    // FIFO; the play_animation that follows would otherwise sit forever.
    const { intent, settle, startedTools } = createTestIntent();
    const queue = new ActionQueue({ intent });

    queue.enqueue({ name: 'move_to', input: { x: 2, y: 0, z: 0 } });
    queue.enqueue({
      name: 'play_animation',
      input: { clip_id: 'wave', mode: 'queue' },
    });

    await flush();
    expect(startedTools()).toEqual(['move_to']);
    expect(queue.pendingSize()).toBe(1);

    settle('move_to');
    await flush();
    expect(startedTools()).toEqual(['move_to', 'play_animation']);

    settle('play_animation');
    await flush();
    expect(queue.inFlight()).toEqual([]);
    expect(queue.pendingSize()).toBe(0);
  });

  it('stop() clears pending and aborts in-flight, settling to idle', async () => {
    const { intent, startedTools, endedTools } = createTestIntent();
    const queue = new ActionQueue({ intent });
    const { events } = recordEvents(queue);

    queue.enqueue({ name: 'move_to', input: { x: 1, y: 0, z: 1 } });
    queue.enqueue({ name: 'point_at', input: { target_id: 'rock' } });
    await flush();

    queue.stop();
    await flush();

    expect(endedTools()).toEqual(['move_to']);
    expect(startedTools()).toEqual(['move_to']);
    expect(queue.pendingSize()).toBe(0);
    expect(queue.inFlight()).toEqual([]);
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('drain() resolves once everything completes', async () => {
    const { intent, settle } = createTestIntent();
    const queue = new ActionQueue({ intent });

    queue.enqueue({ name: 'move_to', input: { x: 1, y: 0, z: 0 } });
    queue.enqueue({ name: 'speak', input: { text: 'hi' } });

    let drained = false;
    void queue.drain().then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false);

    settle('move_to');
    await flush();
    expect(drained).toBe(false); // speak still in-flight

    settle('speak');
    await flush();
    expect(drained).toBe(true);
  });

  it('emits enqueued/started/completed events in order for each action', async () => {
    const { intent, settle } = createTestIntent();
    const queue = new ActionQueue({ intent });
    const { events } = recordEvents(queue);

    queue.enqueue({ name: 'speak', input: { text: 'hello' } });
    await flush();
    settle('speak');
    await flush();

    const lifecycle = events.map((e) =>
      e.type === 'enqueued' || e.type === 'started' || e.type === 'completed'
        ? `${e.type}:${e.action.call.name}`
        : e.type,
    );
    expect(lifecycle).toEqual(['enqueued:speak', 'started:speak', 'completed:speak', 'idle']);
  });
});
