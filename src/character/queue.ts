/**
 * Action queue for the LLM motor (DWEA-18 / T3).
 *
 * Semantics (from the plan + DWEA-18 acceptance):
 * - Strict FIFO: at most one action runs at a time, in enqueue order. Even
 *   when a queued action could acquire its resources (e.g. point_at while
 *   move_to runs), it waits — the acceptance explicitly wants
 *   "character walks, THEN points."
 * - mode "interrupt" (carried by play_animation) clears the queue and aborts
 *   any in-flight action, then dispatches the new one immediately.
 * - Same-tool hand-off for the IK tools: enqueueing a new `look_at` or
 *   `point_at` aborts any in-flight or pending action of the same name. This
 *   is the "Conflicting tools release the held resource on hand-off" rule
 *   from the plan — IK trackers are continuous, not queued.
 * - Per-resource locks (head, arms, legs, voice) are tracked on each action
 *   so the renderer can read the held set; the queue exposes them via
 *   `inFlight()`.
 *
 * The queue is renderer-agnostic: it accepts an IntentSurface and dispatches
 * by tool name, so T2's real intent surface plugs in without code changes.
 */

import type { IntentSurface } from './intent.js';
import { type Resource, TOOL_RESOURCES, type ToolCall, type ToolName } from './schema.js';

export type Mode = 'queue' | 'interrupt';

export interface QueuedAction {
  readonly id: string;
  readonly call: ToolCall;
  readonly resources: ReadonlySet<Resource>;
  readonly mode: Mode;
}

export type AbortReason = 'interrupt' | 'cleared' | 'replaced' | 'error';

export type QueueEvent =
  | { type: 'enqueued'; action: QueuedAction }
  | { type: 'started'; action: QueuedAction }
  | { type: 'completed'; action: QueuedAction }
  | { type: 'aborted'; action: QueuedAction; reason: AbortReason; error?: Error }
  | { type: 'idle' };

export type QueueListener = (event: QueueEvent) => void;

export interface ActionQueueOptions {
  intent: IntentSurface;
}

interface RunningAction {
  action: QueuedAction;
  controller: AbortController;
  reaped: boolean;
}

let nextId = 0;
function genId(name: ToolName): string {
  nextId += 1;
  return `${name}-${nextId.toString(36)}`;
}

function resourcesFor(call: ToolCall, override?: ReadonlyArray<Resource>): Set<Resource> {
  return new Set(override ?? TOOL_RESOURCES[call.name]);
}

function modeFor(call: ToolCall): Mode {
  if (call.name === 'play_animation') return call.input.mode;
  return 'queue';
}

export class ActionQueue {
  private readonly intent: IntentSurface;
  private readonly pending: QueuedAction[] = [];
  private readonly running = new Map<string, RunningAction>();
  private readonly listeners = new Set<QueueListener>();

  constructor(opts: ActionQueueOptions) {
    this.intent = opts.intent;
  }

  on(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  pendingSize(): number {
    return this.pending.length;
  }

  inFlight(): readonly QueuedAction[] {
    return Array.from(this.running.values(), (r) => r.action);
  }

  pendingActions(): readonly QueuedAction[] {
    return this.pending.slice();
  }

  /** Build but do not enqueue. Useful for dry-run / inspection. */
  buildAction(
    call: ToolCall,
    opts?: { resources?: ReadonlyArray<Resource>; mode?: Mode },
  ): QueuedAction {
    return {
      id: genId(call.name),
      call,
      resources: resourcesFor(call, opts?.resources),
      mode: opts?.mode ?? modeFor(call),
    };
  }

  enqueue(
    call: ToolCall,
    opts?: { resources?: ReadonlyArray<Resource>; mode?: Mode },
  ): QueuedAction {
    const action = this.buildAction(call, opts);
    if (action.mode === 'interrupt') {
      this.clear('interrupt');
    } else if (call.name === 'look_at' || call.name === 'point_at') {
      // Continuous IK trackers — the latest one wins. New look_at("rock")
      // preempts in-flight look_at("camera"); same for point_at.
      this.preemptByName(call.name, 'replaced');
    }
    this.pending.push(action);
    this.emit({ type: 'enqueued', action });
    this.step();
    return action;
  }

  private preemptByName(name: ToolName, reason: AbortReason): void {
    // Drop any pending action of the same name so it doesn't fire later.
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const p = this.pending[i];
      if (p?.call.name === name) {
        this.pending.splice(i, 1);
        this.emit({ type: 'aborted', action: p, reason });
      }
    }
    // Abort in-flight of the same name; reap synchronously so the new action
    // doesn't see a stale lock when step() runs next microtask.
    for (const r of Array.from(this.running.values())) {
      if (r.action.call.name === name) {
        r.reaped = true;
        this.running.delete(r.action.id);
        r.controller.abort(new DOMException(reason, 'AbortError'));
        this.emit({ type: 'aborted', action: r.action, reason });
      }
    }
  }

  /**
   * Abort all in-flight actions and drop pending. Used by the "interrupt"
   * mode and by external "stop everything" callers.
   *
   * Marks running entries as `reaped` and removes them synchronously so a
   * subsequent enqueue's resource check sees the locks freed immediately,
   * even though the underlying Promise rejection lands a microtask later.
   */
  clear(reason: Exclude<AbortReason, 'error' | 'replaced'> = 'cleared'): void {
    const dropped = this.pending.splice(0, this.pending.length);
    for (const action of dropped) {
      this.emit({ type: 'aborted', action, reason });
    }
    const inFlight = Array.from(this.running.values());
    for (const r of inFlight) {
      r.reaped = true;
      this.running.delete(r.action.id);
      r.controller.abort(new DOMException(reason, 'AbortError'));
      this.emit({ type: 'aborted', action: r.action, reason });
    }
  }

  /**
   * Public "stop everything" entry. clear() doesn't emit `idle` because it
   * is also used internally by interrupt-mode enqueue (where idle would be
   * spurious right before the new action starts). stop() always settles to
   * idle.
   */
  stop(): void {
    this.clear('cleared');
    this.maybeEmitIdle();
  }

  /** Resolves once the queue is fully drained (no pending, no in-flight). */
  drain(): Promise<void> {
    if (this.pending.length === 0 && this.running.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const off = this.on((event) => {
        if (event.type === 'idle') {
          off();
          resolve();
        }
      });
    });
  }

  private step(): void {
    // Strict serial dispatch: at most one action in flight at a time. The
    // per-resource lock vocabulary (head/arms/legs/voice) is tracked on each
    // QueuedAction for renderer consumption, but does not enable concurrent
    // dispatch in v1 — the acceptance wants "walks THEN points."
    while (this.running.size === 0 && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) this.start(next);
    }
    this.maybeEmitIdle();
  }

  private start(action: QueuedAction): void {
    const controller = new AbortController();
    const entry: RunningAction = { action, controller, reaped: false };
    this.running.set(action.id, entry);
    this.emit({ type: 'started', action });
    void this.dispatch(action, controller.signal).then(
      () => {
        if (entry.reaped) return;
        this.running.delete(action.id);
        this.emit({ type: 'completed', action });
        this.step();
      },
      (err: unknown) => {
        if (entry.reaped) return;
        this.running.delete(action.id);
        if (controller.signal.aborted) {
          // Externally cleared but not via clear() — shouldn't happen, but
          // treat as "cleared" rather than swallowing.
          this.emit({ type: 'aborted', action, reason: 'cleared' });
        } else {
          this.emit({
            type: 'aborted',
            action,
            reason: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
        this.step();
      },
    );
  }

  private dispatch(action: QueuedAction, signal: AbortSignal): Promise<void> {
    const { call } = action;
    switch (call.name) {
      case 'move_to':
        return this.intent.moveTo(call.input, signal);
      case 'look_at':
        return this.intent.lookAt(call.input, signal);
      case 'play_animation':
        return this.intent.playAnimation(call.input, signal);
      case 'point_at':
        return this.intent.pointAt(call.input, signal);
      case 'speak':
        return this.intent.speak(call.input, signal);
    }
  }

  private maybeEmitIdle(): void {
    if (this.pending.length === 0 && this.running.size === 0) {
      this.emit({ type: 'idle' });
    }
  }

  private emit(event: QueueEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A throwing listener must not break the queue or other listeners.
      }
    }
  }
}
