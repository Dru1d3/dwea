/**
 * Structured logger for the v1.1 envelope's `world_model` block.
 *
 * Two consumers, both downstream of the renderer:
 *   - the persona-drift QA harness (DWEA-41 v1.5, filed later) hooks the
 *     `WORLD_MODEL_LOG_EVENT` channel to spot-check coverage and plausibility
 *     across recorded transcripts.
 *   - humans tailing devtools console see a single grep-able line per turn
 *     (`[brain:world_model]`) plus a loud warning (`[brain:drift]`) the first
 *     time mood_drift crosses the threshold inside a session.
 *
 * No UI yet (per DWEA-45 scope). Keep this file UI-free so the planner /
 * Convai integration (DWEA-44) can import the logger without pulling React.
 */
import type { MonsterResponse, WorldModel } from './brain.js';

/**
 * mood_drift magnitude that flips a turn into "the character has wandered
 * far enough from baseline that QA should look at this transcript". Tuned
 * conservatively — the cognition note (DWEA-40 §2) suggests >0.5 is roughly
 * "noticeably off" not "off the rails".
 */
export const MOOD_DRIFT_WARN_THRESHOLD = 0.5;

export interface WorldModelLogEntry {
  ts: number;
  turnIndex: number;
  bibleId: string;
  /** Truncated to keep log lines small; the full envelope is logged at info. */
  utterancePreview: string;
  worldModel: WorldModel;
  /** True the first time |mood_drift| crosses MOOD_DRIFT_WARN_THRESHOLD. */
  driftWarning: boolean;
}

export type WorldModelLogSink = (entry: WorldModelLogEntry) => void;

interface ConsoleLike {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface WorldModelLoggerOptions {
  bibleId: string;
  /** Optional alternate sink — tests inject this to avoid touching console. */
  sink?: WorldModelLogSink;
  /** Override the console for tests; defaults to globalThis.console. */
  console?: ConsoleLike;
}

export interface WorldModelLogger {
  recordTurn(response: MonsterResponse): WorldModelLogEntry;
  /** Total turns observed (for tests / HUDs). */
  readonly turnCount: number;
}

function previewUtterance(s: string): string {
  if (s.length <= 80) return s;
  return `${s.slice(0, 77)}...`;
}

/**
 * Build a per-session logger. One per chat session — turn indexes reset on
 * each session so persona-drift QA can scope its analysis to a single
 * transcript.
 */
export function createWorldModelLogger(opts: WorldModelLoggerOptions): WorldModelLogger {
  const sink = opts.sink;
  const consoleRef = opts.console ?? globalThis.console;
  let turn = 0;
  let driftAlreadyFired = false;

  return {
    get turnCount(): number {
      return turn;
    },
    recordTurn(response: MonsterResponse): WorldModelLogEntry {
      turn += 1;
      const wm = response.world_model;
      const drift = Math.abs(wm.mood_drift);
      const crossed = drift > MOOD_DRIFT_WARN_THRESHOLD;
      const driftWarning = crossed && !driftAlreadyFired;
      if (crossed) driftAlreadyFired = true;

      const entry: WorldModelLogEntry = {
        ts: Date.now(),
        turnIndex: turn,
        bibleId: opts.bibleId,
        utterancePreview: previewUtterance(response.utterance),
        worldModel: wm,
        driftWarning,
      };

      // Always emit the structured log line. The QA harness (DWEA-41 v1.5)
      // can attach to this prefix without pulling state out of React.
      consoleRef.info('[brain:world_model]', entry);

      if (driftWarning) {
        consoleRef.warn(
          `[brain:drift] mood_drift=${wm.mood_drift.toFixed(2)} crossed ${MOOD_DRIFT_WARN_THRESHOLD} on turn ${turn} (${opts.bibleId}); goal="${wm.goal}"`,
        );
      }

      sink?.(entry);
      return entry;
    },
  };
}
