import type { SessionContext } from './session.js';
import { safeRandomUuid } from './session.js';
import type { TelemetryBackend } from './store.js';
/**
 * Per-turn TTFA / TTF-Face capture state machine.
 *
 * Why a state machine: a turn has up to three latching events (first audio,
 * first face) and two terminal conditions (success: both events fired; lost:
 * the turn errored before either fired). The naive "two callbacks + one
 * complete()" shape allowed double-emits when set_face fired before TTS, and
 * dropped records when the brain errored mid-turn. Centralising the rules
 * here means [useChat](../ui/useChat.ts) stays a thin wirer.
 *
 * Fields not measurable on the client (peer NPC, server route, vendor
 * provider tags) are filled from the [BeginTurnArgs](./emitter.ts) snapshot
 * at the start of the turn — keeping the per-record envelope flat for
 * `compute_sigma_log.py`.
 */
import type { SendTelemetry } from './transport.js';
import type { TelemetryRecord } from './types.js';

export interface BeginTurnArgs {
  /**
   * `performance.now()` clock at the moment we treat the user as "done
   * speaking". Mic-stop release for push-to-talk; form-submit for text.
   */
  userDoneSpeakingAt: number;
  npcId: string;
  llmProvider: string;
  ttsProvider: string;
  inputModality: TelemetryRecord['inputModality'];
}

export interface TelemetryEmitter {
  /**
   * Open a new turn. Returns a turn handle the chat path uses to mark
   * first-audio / first-face. Calling beginTurn again before the previous
   * turn was completed silently drops the previous turn — this matches the
   * UX (mid-turn cancel) without leaking partial records.
   */
  beginTurn(args: BeginTurnArgs): TurnHandle;
  /** Sync view of the most recent record, for in-page debug HUDs. */
  lastRecord(): TelemetryRecord | null;
}

export interface TurnHandle {
  /** Latch the TTFA. Subsequent calls are no-ops. */
  markFirstAudio(at?: number): void;
  /**
   * Latch the TTF-Face. Subsequent calls are no-ops. Pass the timestamp at
   * which the first viseme/blendshape was applied — until A2F-3D lands the
   * caller passes the moment the rig's emotion was first updated.
   */
  markFirstFace(at?: number): void;
  /**
   * Abort the turn. Records are emitted only when *both* TTFA and TTF-Face
   * fired before abort; an abort with neither produces no record (we can't
   * measure what didn't happen) but a dropped turn is logged so dogfood
   * coverage gaps are visible.
   */
  abort(reason: string): void;
}

export interface CreateTelemetryArgs {
  session: SessionContext;
  backend: TelemetryBackend;
  send?: SendTelemetry;
  /**
   * Wall-clock supplier — Date.now in production, mocked in tests. Always
   * UTC ISO-8601 in the record.
   */
  now?: () => Date;
  /**
   * Monotonic clock supplier for elapsed-ms math — performance.now in
   * production, mocked in tests so the elapsed numbers are deterministic.
   */
  perfNow?: () => number;
}

export function createTelemetry(args: CreateTelemetryArgs): TelemetryEmitter {
  const { session, backend } = args;
  const send = args.send ?? (() => {});
  const now = args.now ?? (() => new Date());
  const perfNow = args.perfNow ?? (() => performance.now());

  let lastRecord: TelemetryRecord | null = null;
  let openTurn: InternalTurn | null = null;

  function complete(turn: InternalTurn): void {
    if (turn.completed) return;
    turn.completed = true;
    if (turn.firstAudioAt === null || turn.firstFaceAt === null) return;
    const record: TelemetryRecord = {
      sessionId: session.sessionId,
      turnId: turn.id,
      ts: turn.startedAtIso,
      ttfa_ms: Math.max(0, Math.round(turn.firstAudioAt - turn.userDoneSpeakingAt)),
      ttf_face_ms: Math.max(0, Math.round(turn.firstFaceAt - turn.userDoneSpeakingAt)),
      npcId: turn.npcId,
      route: session.isCold ? 'cold' : 'warm',
      llmProvider: turn.llmProvider,
      ttsProvider: turn.ttsProvider,
      deviceTier: session.deviceTier,
      inputModality: turn.inputModality,
      schemaVersion: '1',
    };
    lastRecord = record;
    session.isCold = false;
    void backend.append(record).catch(() => {
      // Persistence is local, but lifecycles can throw under storage quota
      // exhaustion; swallowing here keeps the chat path running.
    });
    try {
      send(record);
    } catch {
      // see transport.ts — telemetry never throws into the chat loop.
    }
  }

  return {
    beginTurn(args) {
      // If a previous turn never completed, drop it silently — the chat
      // surface treats a new submit as cancellation.
      openTurn = null;
      const turn: InternalTurn = {
        id: safeRandomUuid(),
        startedAtIso: now().toISOString(),
        userDoneSpeakingAt: args.userDoneSpeakingAt,
        firstAudioAt: null,
        firstFaceAt: null,
        completed: false,
        npcId: args.npcId,
        llmProvider: args.llmProvider,
        ttsProvider: args.ttsProvider,
        inputModality: args.inputModality,
      };
      openTurn = turn;
      return {
        markFirstAudio(at) {
          if (turn.completed || turn !== openTurn) return;
          if (turn.firstAudioAt !== null) return;
          turn.firstAudioAt = at ?? perfNow();
          if (turn.firstFaceAt !== null) complete(turn);
        },
        markFirstFace(at) {
          if (turn.completed || turn !== openTurn) return;
          if (turn.firstFaceAt !== null) return;
          turn.firstFaceAt = at ?? perfNow();
          if (turn.firstAudioAt !== null) complete(turn);
        },
        abort(_reason) {
          if (turn.completed || turn !== openTurn) return;
          turn.completed = true;
          openTurn = null;
        },
      };
    },
    lastRecord() {
      return lastRecord;
    },
  };
}

interface InternalTurn {
  id: string;
  startedAtIso: string;
  userDoneSpeakingAt: number;
  firstAudioAt: number | null;
  firstFaceAt: number | null;
  completed: boolean;
  npcId: string;
  llmProvider: string;
  ttsProvider: string;
  inputModality: TelemetryRecord['inputModality'];
}
