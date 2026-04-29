export interface Vec2 {
  x: number;
  z: number;
}

export type NpcMode = 'idle' | 'walking';

export interface NpcSnapshot {
  position: Vec2;
  target: Vec2 | null;
  mode: NpcMode;
}
