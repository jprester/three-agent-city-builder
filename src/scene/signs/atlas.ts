import * as THREE from 'three';
import catalog from '../../../art/textures/signs/designs.json';
import atlasUrl from '../../../art/textures/signs/designs.png?url';

/**
 * Typeset sign designs: real trade words set in bundled fonts and baked offline into one
 * data atlas (tools/textures/build_sign_designs.py, source art/signs/designs.def.json).
 * Channels are data, colored per instance in the sign shader:
 *   R  ink / tube coverage
 *   G  part id (one per character, border or icon) for dead and flickering parts
 *   B  backlit face area (lightboxes; dimmer for quiet printed plates)
 * Glow comes from sampling R at a coarse mip, so every slot has an empty gutter.
 */
export interface SignDesign {
  kind: 'blade' | 'panel';
  boxed: boolean;
  /** UV rect: u0, v0, du, dv (v up, as three samples it). */
  rect: THREE.Vector4;
  /** Width / height of the design; the layout sizes the sign to it. */
  aspect: number;
  /** Brand wordmark / stacked logo of brand `brand` (tower logo families). */
  brand?: number;
  /** Per-instance emission multiplier; quiet printed plates sit below 1. */
  dim: number;
}

/** Number of invented brands; each has a vertical logo blade and a wordmark panel. */
export const BRANDS = catalog.brands.length;

/** Design facts in catalog order; layout signs refer to a design by this index. */
export const SIGN_DESIGNS: SignDesign[] = catalog.designs.map((d) => ({
  kind: d.kind as SignDesign['kind'],
  boxed: d.boxed,
  rect: new THREE.Vector4(...(d.rect as [number, number, number, number])),
  aspect: d.aspect,
  brand: (d as { brand?: number }).brand,
  dim: d.dim,
}));

export interface SignAtlas {
  texture: THREE.Texture;
  designs: SignDesign[];
}

/** Loaded before the city renders, like the artwork atlases. */
export async function loadSignAtlas(): Promise<SignAtlas> {
  const texture = await new THREE.TextureLoader().loadAsync(atlasUrl);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return { texture, designs: SIGN_DESIGNS };
}
