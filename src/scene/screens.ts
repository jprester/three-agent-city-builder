import posterMeta from '../../art/external/textures/signs/posters.json';

/**
 * Video screens cycle through the portrait posters/ads atlas (src/scene/signs/art.ts,
 * tools/textures/import_ads.py): a uniform grid of 384 × 576 px slots, addressed by index
 * in the facade shader.
 */
export const SCREEN_COLS = posterMeta.portraitSize[0] / 384;
export const SCREEN_ROWS = posterMeta.portraitSize[1] / 576;
