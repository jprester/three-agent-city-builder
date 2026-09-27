import * as THREE from 'three';
import neonMeta from '../../../art/external/textures/signs/neon.json';
import posterMeta from '../../../art/external/textures/signs/posters.json';
import neonV from '../../../art/external/textures/signs/neon_v.webp?url';
import neonH from '../../../art/external/textures/signs/neon_h.webp?url';
import posterP from '../../../art/external/textures/signs/posters_p.webp?url';
import posterL from '../../../art/external/textures/signs/posters_l.webp?url';

/** One image sign / ad in an atlas (tools/textures/import_ads.py). */
export interface ArtEntry { id: string; tag: string; rect: number[]; aspect: number; color: number[]; hue: number; sat: number }

/** Atlas source codes, shared with the sign shader (aParams.x). 0/1 = stroke atlas. */
export const SRC = { neonV: 2, neonH: 3, posterP: 4, posterL: 5 } as const;

export interface SignArt {
  textures: Record<keyof typeof SRC, THREE.Texture>;
  entries: Record<keyof typeof SRC, ArtEntry[]>;
}

/** The human-provided neon signs and ads, packed at import. Loaded before the city renders. */
export async function loadSignArt(anisotropy: number): Promise<SignArt> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  const [v, h, p, l] = await Promise.all([neonV, neonH, posterP, posterL].map(load));
  return {
    textures: { neonV: v, neonH: h, posterP: p, posterL: l },
    entries: { neonV: neonMeta.vertical, neonH: neonMeta.horizontal, posterP: posterMeta.portrait, posterL: posterMeta.landscape },
  };
}

/** Warm (red/amber) art is favored 3:1 over cyan/magenta, per the style bible. */
export const artWeight = (e: ArtEntry) => (e.hue <= 60 || e.hue >= 330 ? 3 : e.sat < 0.25 ? 1.5 : 1);

/** UV rect of `e` cropped to fill a sign of aspect `boxAspect` (cover fit, centered). */
export function coverRect(e: ArtEntry, boxAspect: number): THREE.Vector4 {
  const [u, v, w, h] = e.rect;
  if (boxAspect > e.aspect) {
    const h2 = h * (e.aspect / boxAspect);
    return new THREE.Vector4(u, v + (h - h2) / 2, w, h2);
  }
  const w2 = w * (boxAspect / e.aspect);
  return new THREE.Vector4(u + (w - w2) / 2, v, w2, h);
}
