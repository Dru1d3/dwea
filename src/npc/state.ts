import { useCallback, useEffect, useRef, useState } from 'react';
import { randomWanderTarget } from './movement.js';
import type { NpcMode, Vec2 } from './types.js';

const INITIAL_POSITION: Vec2 = { x: -1.2, z: 1.2 };

const WANDER_INTERVAL_MS_MIN = 8000;
const WANDER_INTERVAL_MS_MAX = 14000;

export interface NpcState {
  position: Vec2;
  target: Vec2 | null;
  lastClickTarget: Vec2 | null;
  mode: NpcMode;
  setPosition: (next: Vec2) => void;
  setTarget: (next: Vec2 | null, opts?: { fromUserClick?: boolean }) => void;
  clearTarget: () => void;
}

/**
 * Owns Mara's world-state. Renders triggered by position / target changes;
 * the periodic wander timer is held in a ref so it doesn't churn React state.
 *
 * The model gets `position` and `lastClickTarget` injected each turn; we keep
 * `lastClickTarget` separate from `target` so the LLM can reference where the
 * USER pointed even after Mara has reached it.
 */
export function useNpcState(): NpcState {
  const [position, setPositionState] = useState<Vec2>(INITIAL_POSITION);
  const [target, setTargetState] = useState<Vec2 | null>(null);
  const [lastClickTarget, setLastClickTarget] = useState<Vec2 | null>(null);

  const lastUserActivityRef = useRef(performance.now());

  const setPosition = useCallback((next: Vec2) => {
    setPositionState(next);
  }, []);

  const setTarget = useCallback((next: Vec2 | null, opts?: { fromUserClick?: boolean }) => {
    setTargetState(next);
    if (next && opts?.fromUserClick) {
      setLastClickTarget(next);
      lastUserActivityRef.current = performance.now();
    }
  }, []);

  const clearTarget = useCallback(() => {
    setTargetState(null);
  }, []);

  // Periodic wander when idle. Fires only if no target is active and the user
  // hasn't directed Mara recently.
  useEffect(() => {
    let cancelled = false;

    const schedule = () => {
      const delay =
        WANDER_INTERVAL_MS_MIN + Math.random() * (WANDER_INTERVAL_MS_MAX - WANDER_INTERVAL_MS_MIN);
      const id = window.setTimeout(() => {
        if (cancelled) return;
        const sinceLastUser = performance.now() - lastUserActivityRef.current;
        // Only wander if user hasn't clicked recently and Mara isn't already going somewhere.
        if (sinceLastUser > WANDER_INTERVAL_MS_MIN) {
          setTargetState((current) => {
            if (current) return current;
            // anchor the wander at Mara's current position via callback semantics
            return randomWanderTarget({ x: 0, z: 0 }, 1.5);
          });
        }
        schedule();
      }, delay);
      return id;
    };

    const handle = schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  const mode: NpcMode = target ? 'walking' : 'idle';

  return {
    position,
    target,
    lastClickTarget,
    mode,
    setPosition,
    setTarget,
    clearTarget,
  };
}
