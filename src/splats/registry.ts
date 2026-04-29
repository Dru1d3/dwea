export type SplatAsset = {
  readonly id: string;
  readonly label: string;
  readonly source: SplatSource;
  readonly credit?: string;
};

export type SplatSource =
  | { readonly kind: 'public'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string };

export const splatRegistry: readonly SplatAsset[] = [
  {
    id: 'nike',
    label: 'Nike (drei sample)',
    source: {
      kind: 'remote',
      url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat',
    },
    credit: 'cakewalk/splat-data on Hugging Face — drei <Splat> canonical demo asset.',
  },
  {
    id: 'plush',
    label: 'Plush toy',
    source: { kind: 'public', path: 'splats/plush.splat' },
    credit:
      'cakewalk/splat-data on Hugging Face — derived from the 3D Gaussian Splatting paper test scenes. Research/demo use; replace before commercial deployment.',
  },
] as const;

export const defaultSplatId: SplatAsset['id'] = 'nike';

export function findSplat(id: string): SplatAsset | undefined {
  return splatRegistry.find((s) => s.id === id);
}

export function resolveSplatUrl(asset: SplatAsset, baseUrl: string): string {
  if (asset.source.kind === 'remote') {
    return asset.source.url;
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${asset.source.path}`;
}
