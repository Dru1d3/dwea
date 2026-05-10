/**
 * Per-session latency record submitted to the σ_log pipeline (DWEA-98).
 *
 * Field set follows the pre-condition document for DWEA-100 — the consumer
 * (`compute_sigma_log.py`) accepts `--ttfa-col` / `--ttf-face-col` flags so
 * column naming is flexible, but `ts` is canonical ISO-8601 UTC.
 *
 * All fields are required so the downstream CSV is rectangular; unknowns
 * fall back to short string sentinels (`'unknown'`) rather than null.
 */
export interface TelemetryRecord {
  /** Stable per-page-session id (UUID-shaped string). Repeats across turns. */
  sessionId: string;
  /** Per-turn id; unique even if the same session runs many turns. */
  turnId: string;
  /** ISO-8601 UTC at the moment the user finished speaking. */
  ts: string;
  /** ms from user-done-speaking to first audible TTS sample on the wire. */
  ttfa_ms: number;
  /**
   * ms from user-done-speaking to first viseme/blendshape applied to the
   * avatar. Until A2F-3D lands the proxy is "first emotion/expression
   * applied to the rig" — see docs/architecture/observability/telemetry.md.
   */
  ttf_face_ms: number;
  /** Bible / NPC identifier (e.g. `mara-arboreal`). */
  npcId: string;
  /**
   * `cold` for the first turn in a fresh page session (provider may need
   * to spin up); `warm` for any subsequent turn in the same session.
   */
  route: 'cold' | 'warm';
  /** LLM provider tag (model id incl. provider, e.g. `openrouter:meta/...`). */
  llmProvider: string;
  /** TTS provider tag (e.g. `web-speech`, `elevenlabs:rachel`). */
  ttsProvider: string;
  /**
   * Coarse client device tier — see [deviceTier](./session.ts). The σ_log
   * cohort floor cares whether laptops vs phones dominate the tail.
   */
  deviceTier: 'high' | 'mid' | 'low' | 'unknown';
  /** STT path used (`text`, `web-speech`, `groq`). */
  inputModality: 'text' | 'web-speech' | 'groq';
  /** Schema version — bump on breaking column changes. */
  schemaVersion: '1';
}

/**
 * Begin-of-turn snapshot. `userDoneSpeakingAt` is the `performance.now()`
 * timestamp at the *exact* moment we treat as "user finished speaking" —
 * mic-stop release for push-to-talk, form-submit for text. Everything
 * downstream is measured against this clock.
 */
export interface TurnContext {
  turnId: string;
  userDoneSpeakingAt: number;
  inputModality: TelemetryRecord['inputModality'];
}
