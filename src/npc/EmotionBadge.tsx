import { Html } from '@react-three/drei';
import type { MonsterBible } from '../llm/bible.js';
import { skyBright } from '../visual/palette.js';
import type { EmotionState } from './emotion.js';
import type { Vec2 } from './types.js';

interface EmotionBadgeProps {
  position: Vec2;
  groundY: number;
  emotion: EmotionState;
  bible: MonsterBible;
}

/**
 * Floating emoji bubble anchored above the NPC's head. v0 stand-in for
 * blendshapes — the husky GLB has no morph targets, so the visible face
 * change required by [DWEA-34](/DWEA/issues/DWEA-34) lives in HTML/CSS.
 *
 * Sized in CSS pixels via drei's `<Html distanceFactor>` so it scales with
 * camera distance instead of being a constant pixel size in screen space.
 */
export function EmotionBadge({ position, groundY, emotion, bible }: EmotionBadgeProps) {
  const emoji = bible.emotionEmoji[emotion.expression] ?? bible.emotionEmoji.neutral ?? '🙂';
  const opacity = 0.55 + Math.min(1, Math.max(0, emotion.intensity)) * 0.45;

  return (
    <Html
      position={[position.x, groundY + 1.6, position.z]}
      center
      distanceFactor={6}
      pointerEvents="none"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        aria-label={`Mood: ${emotion.expression}`}
        style={{
          // TODO: chrome palette pass with UX Designer (Wave 2) — translucent
          // navy background + cyan border are placeholder badge chrome and
          // not in §5.1; revisit alongside ChatPanel/Hud.
          background: 'rgba(12, 18, 28, 0.78)',
          border: '1px solid rgba(155, 231, 255, 0.32)',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 18,
          lineHeight: 1,
          color: skyBright,
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
