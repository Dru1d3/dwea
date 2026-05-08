import { pearlNeutral } from './visual/palette.js';

export function Hud() {
  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        padding: '10px 12px',
        borderRadius: 8,
        // TODO: chrome palette pass with UX Designer (Wave 2) — translucent
        // dark backdrop is placeholder HUD chrome and not in §5.1.
        background: 'rgba(10, 10, 14, 0.55)',
        backdropFilter: 'blur(6px)',
        color: pearlNeutral,
        fontSize: 12,
        lineHeight: 1.45,
        letterSpacing: 0.2,
        pointerEvents: 'none',
        userSelect: 'none',
        maxWidth: 240,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Move around</strong>
      Drag to orbit · Scroll to zoom · Right-drag (or two fingers) to pan
      <div style={{ marginTop: 6, opacity: 0.85 }}>Hold Space (or 🎤) to talk to Mara.</div>
    </div>
  );
}
