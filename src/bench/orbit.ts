/**
 * Deterministic orbit-camera path used by both runtime adapters.
 *
 * Driven by elapsed seconds since the start of the measurement window so that
 * the same camera trajectory is replayed across runs. We intentionally do NOT
 * use real wall-clock time as input — `t` is the seconds-since-start handed in
 * by the harness, which means a paused run resumes from the same orbit phase.
 */

export type OrbitConfig = {
  readonly center: [number, number, number];
  /** Radius of the horizontal orbit (m). */
  readonly radius: number;
  /** Vertical eye offset above center (m). */
  readonly height: number;
  /** Orbit period in seconds (full revolution). */
  readonly periodSec: number;
  /** Vertical bob amplitude (m). 0 = no bob. */
  readonly bob: number;
};

export const DEFAULT_ORBIT: OrbitConfig = {
  center: [0, 0.6, 0],
  radius: 2.4,
  height: 1.4,
  periodSec: 12,
  bob: 0.25,
};

export type CameraPose = {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
};

/** Compute the camera pose for a given elapsed time. */
export function poseAt(t: number, cfg: OrbitConfig = DEFAULT_ORBIT): CameraPose {
  const angle = (2 * Math.PI * t) / cfg.periodSec;
  const x = cfg.center[0] + cfg.radius * Math.cos(angle);
  const z = cfg.center[2] + cfg.radius * Math.sin(angle);
  // Bob slightly faster than orbit to avoid a 1:1 camera path.
  const bobAngle = (2 * Math.PI * t) / (cfg.periodSec * 0.5);
  const y = cfg.center[1] + cfg.height + cfg.bob * Math.sin(bobAngle);
  return {
    position: [x, y, z],
    target: cfg.center,
  };
}
