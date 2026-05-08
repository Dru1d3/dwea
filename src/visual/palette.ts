// v1 Visual Style Bible §5.1 master palette tokens.
//
// Bible: /DWEA/issues/DWEA-54#document-style-bible §5.1
//
// Every character and lighting accent the runtime renders must trace to a
// named token below. New tokens require a Visual Designer + CEO call —
// reviewers cite a token by slug when rejecting a non-compliant colour.
//
// Out of palette by design (per §5.1): pure white #FFFFFF, pure black
// #000000, any saturated red below ember-dim's wavelength, neon green of
// any kind.

/** Mara warm core. */
export const amberCore = '#F4D58A';
/** Mara warm halo. */
export const amberHalo = '#FFE9B0';
/** Mara markings. */
export const siennaDeep = '#5C3A1E';
/** Otto grounded core. */
export const mossDeep = '#3A4A3F';
/** Otto belly / dust. */
export const dustOchre = '#A38563';
/** Otto speaking ember (only emits when Otto speaks). */
export const emberDim = '#7A2A1A';
/** Pip cool core. */
export const iceCool = '#8FE3F2';
/** Pip tip — the only hot accent in the cast. */
export const magentaHot = '#F25C8A';
// TODO(visual-designer): provisional pending Echo's character pipeline call
// (DWEA-54 §3.4). Echo is held until DWEA-52 confirms ≥3 simultaneous
// characters; if Echo is dropped for v1 the pearl-neutral slot may be
// retired or re-owned. Source slug stays stable for now.
/** Echo (candidate). */
export const pearlNeutral = '#C8C8D0';
/** Clearing scene only — sky-bright accent. */
export const skyBright = '#E6F2FB';

export type PaletteSlug =
  | 'amber-core'
  | 'amber-halo'
  | 'sienna-deep'
  | 'moss-deep'
  | 'dust-ochre'
  | 'ember-dim'
  | 'ice-cool'
  | 'magenta-hot'
  | 'pearl-neutral'
  | 'sky-bright';

export const palette: Record<PaletteSlug, string> = {
  'amber-core': amberCore,
  'amber-halo': amberHalo,
  'sienna-deep': siennaDeep,
  'moss-deep': mossDeep,
  'dust-ochre': dustOchre,
  'ember-dim': emberDim,
  'ice-cool': iceCool,
  'magenta-hot': magentaHot,
  'pearl-neutral': pearlNeutral,
  'sky-bright': skyBright,
};

/** Token slugs in declaration order. Useful for rendering swatches / docs. */
export const PALETTE_SLUGS: readonly PaletteSlug[] = [
  'amber-core',
  'amber-halo',
  'sienna-deep',
  'moss-deep',
  'dust-ochre',
  'ember-dim',
  'ice-cool',
  'magenta-hot',
  'pearl-neutral',
  'sky-bright',
];

/** CSS custom-property name for a token, e.g. `--palette-amber-core`. */
export function cssVarName(slug: PaletteSlug): string {
  return `--palette-${slug}`;
}

/** CSS `var(--palette-<slug>)` reference, suitable for inline styles. */
export function cssVar(slug: PaletteSlug): string {
  return `var(${cssVarName(slug)})`;
}
