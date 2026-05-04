import { useCallback, useEffect, useState } from 'react';
import {
  type Tuning,
  clearTuning,
  formatAsTransformLiteral,
  loadTuning,
  saveTuning,
} from '../splats/tuningStore.js';

export type SceneTunerProps = {
  /** Asset id (registry id, e.g. 'garden'). */
  readonly assetId: string;
  /** Current tuning to display. Null = registry/auto-fit defaults. */
  readonly value: Tuning | null;
  /** Default values to seed when the user enables tuning for this asset. */
  readonly defaults: Tuning;
  /** Called when tuning changes (preview live). */
  readonly onChange: (next: Tuning | null) => void;
};

/**
 * Compact dev tuning HUD. Six sliders + scale; live-previews on the splat;
 * persists to localStorage via tuningStore so the same browser keeps the
 * values across reloads. "Copy" emits a transform literal the user can paste
 * into a comment so an engineer can bake it into the registry.
 *
 * Gated by `?tune=1` in the URL (see App.tsx) so end users don't see this.
 */
export function SceneTuner({ assetId, value, defaults, onChange }: SceneTunerProps) {
  const active = value !== null;
  const v = value ?? defaults;

  const update = useCallback(
    (next: Tuning) => {
      saveTuning(assetId, next);
      onChange(next);
    },
    [assetId, onChange],
  );

  const enable = () => update(loadTuning(assetId) ?? defaults);
  const reset = () => {
    clearTuning(assetId);
    onChange(null);
  };

  const setPos = (i: 0 | 1 | 2, n: number) => {
    const next = [...v.position] as [number, number, number];
    next[i] = n;
    update({ ...v, position: next });
  };
  const setRot = (i: 0 | 1 | 2, n: number) => {
    const next = [...v.rotation] as [number, number, number];
    next[i] = n;
    update({ ...v, rotation: next });
  };
  const setScale = (n: number) => update({ ...v, scale: n });

  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copy = useCallback(async () => {
    const literal = formatAsTransformLiteral(v);
    try {
      await navigator.clipboard.writeText(literal);
      setCopyHint('copied');
    } catch {
      setCopyHint(literal);
    }
    window.setTimeout(() => setCopyHint(null), 1800);
  }, [v]);

  return (
    <aside aria-label={`Scene tuner: ${assetId}`} style={panelStyle}>
      <header style={headerStyle}>
        <strong style={{ fontSize: 12 }}>scene tuner</strong>
        <span style={{ opacity: 0.6, fontSize: 11 }}>· {assetId}</span>
        <span style={{ flex: 1 }} />
        {active ? (
          <button
            type="button"
            onClick={reset}
            style={btnStyle}
            title="Restore registry + auto-fit"
          >
            reset
          </button>
        ) : (
          <button
            type="button"
            onClick={enable}
            style={btnStyle}
            title="Override registry & auto-fit"
          >
            override
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          style={btnStyle}
          disabled={!active}
          title="Copy transform literal to clipboard"
        >
          {copyHint === 'copied' ? '✓' : 'copy'}
        </button>
      </header>

      <Row
        label="pos x"
        value={v.position[0]}
        step={0.05}
        min={-10}
        max={10}
        disabled={!active}
        onChange={(n) => setPos(0, n)}
      />
      <Row
        label="pos y"
        value={v.position[1]}
        step={0.05}
        min={-10}
        max={10}
        disabled={!active}
        onChange={(n) => setPos(1, n)}
      />
      <Row
        label="pos z"
        value={v.position[2]}
        step={0.05}
        min={-10}
        max={10}
        disabled={!active}
        onChange={(n) => setPos(2, n)}
      />
      <Row
        label="rot x"
        value={v.rotation[0]}
        step={0.005}
        min={-Math.PI}
        max={Math.PI}
        disabled={!active}
        onChange={(n) => setRot(0, n)}
      />
      <Row
        label="rot y"
        value={v.rotation[1]}
        step={0.005}
        min={-Math.PI}
        max={Math.PI}
        disabled={!active}
        onChange={(n) => setRot(1, n)}
      />
      <Row
        label="rot z"
        value={v.rotation[2]}
        step={0.005}
        min={-Math.PI}
        max={Math.PI}
        disabled={!active}
        onChange={(n) => setRot(2, n)}
      />
      <Row
        label="scale"
        value={v.scale}
        step={0.01}
        min={0.1}
        max={5}
        disabled={!active}
        onChange={setScale}
      />

      {copyHint && copyHint !== 'copied' ? <pre style={pasteStyle}>{copyHint}</pre> : null}
      {!active ? (
        <p style={hintStyle}>
          Click <em>override</em> to take control. Auto-fit is paused while tuning. <em>copy</em>{' '}
          emits a `transform` literal to paste into a comment.
        </p>
      ) : null}
    </aside>
  );
}

type RowProps = {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onChange: (n: number) => void;
};

function Row({ label, value, step, min, max, disabled, onChange }: RowProps) {
  const [text, setText] = useState(value.toFixed(3));

  // Keep numeric input in sync when value changes from outside (e.g. enable
  // pulls defaults). Only re-format when the parsed local value differs.
  useEffect(() => {
    setText(value.toFixed(3));
  }, [value]);

  return (
    <label style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={rangeStyle}
      />
      <input
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n)) onChange(n);
          else setText(value.toFixed(3));
        }}
        style={numStyle}
      />
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  width: 280,
  padding: 10,
  borderRadius: 8,
  background: 'rgba(10, 10, 14, 0.78)',
  backdropFilter: 'blur(8px)',
  color: '#e8e8f4',
  font: '12px/1.4 system-ui, -apple-system, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
  zIndex: 50,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingBottom: 4,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  marginBottom: 4,
};

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  padding: '2px 8px',
  font: 'inherit',
  cursor: 'pointer',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '40px 1fr 64px',
  gap: 6,
  alignItems: 'center',
};

const rowLabelStyle: React.CSSProperties = {
  opacity: 0.7,
  fontVariantNumeric: 'tabular-nums',
};

const rangeStyle: React.CSSProperties = {
  width: '100%',
};

const numStyle: React.CSSProperties = {
  width: 64,
  background: 'rgba(255,255,255,0.06)',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  padding: '2px 4px',
  font: 'inherit',
  textAlign: 'right',
};

const hintStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  opacity: 0.7,
  fontSize: 11,
  lineHeight: 1.35,
};

const pasteStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  padding: 6,
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre',
  overflowX: 'auto',
};
