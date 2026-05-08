import { Html } from '@react-three/drei';
import type { MonsterBible } from '../llm/bible.js';
import type { EmotionState } from './emotion.js';

interface EmotionBadgeProps {
  /**
   * Local-space Y offset above the parent (head bone or inner rig group).
   * §5 spec: ~10 cm clearance above the silhouette top in world space —
   * the caller in Npc.tsx converts that to the parent's local units so this
   * component never needs to know the rig scale.
   */
  offsetY: number;
  emotion: EmotionState;
  bible: MonsterBible;
}

/**
 * Floating emoji bubble anchored above the NPC's head. v0 stand-in for
 * blendshapes — the husky GLB has no morph targets, so the visible face
 * change required by [DWEA-34](/DWEA/issues/DWEA-34) lives in HTML/CSS.
 *
 * Mounts as a child of the rig (Npc.tsx) — either inside the `Head` bone
 * (best path, follows animation) or inside the inner scaled `<group>` as a
 * fallback. The position prop is therefore in PARENT-LOCAL space; world
 * placement is the parent's responsibility.
 *
 * §5 anchoring: the Mara art brief (DWEA-66 §5) specifies "follow-cam-rotation
 * Y-locked only". We keep drei's `<Html>` in screen-space mode (the default
 * — no `transform` prop) so the bubble's billboard rotation is locked by
 * construction. See bible §5.4 (DWEA-54#document-style-bible) for the
 * silhouette-legibility lens this enforces. Do NOT switch to `transform`
 * mode without re-deriving a Y-only billboard, or the lock silently breaks.
 */
export function EmotionBadge({ offsetY, emotion, bible }: EmotionBadgeProps) {
  const emoji = bible.emotionEmoji[emotion.expression] ?? bible.emotionEmoji.neutral ?? '🙂';
  const opacity = 0.55 + Math.min(1, Math.max(0, emotion.intensity)) * 0.45;

  return (
    <Html
      position={[0, offsetY, 0]}
      center
      distanceFactor={6}
      pointerEvents="none"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {/* TODO(DWEA-60-merge): drop the navy pill + cyan border + uppercase
          label once `palette/amber-halo` lands in the v1 token set. The
          brief §5 calls for emoji-only (or emoji + opacity-modulated halo);
          chrome here is a parked carve-out per DWEA-60's UX-chrome rule. */}
      <div
        aria-label={`Mood: ${emotion.expression}`}
        style={{
          background: 'rgba(12, 18, 28, 0.78)',
          border: '1px solid rgba(155, 231, 255, 0.32)',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 18,
          lineHeight: 1,
          color: '#e6f6ff',
          backdropFilter: 'blur(4px)',
          opacity,
          transition: 'opacity 220ms ease-out',
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden style={{ marginRight: 6 }}>
          {emoji}
        </span>
        <span style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {emotion.expression}
        </span>
      </div>
    </Html>
  );
}
