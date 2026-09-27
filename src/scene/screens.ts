import catalog from '../../art/external/textures/signs/catalog.json';

/**
 * Video screens cycle through the portrait ads in screens.webp (tools/textures/import_ads.py):
 * a grid of uniform 2:3 slots (images letterboxed inside), addressed by index in the facade
 * shader. Screens are built at exactly 2:3 (art/generators/lib/building.py screen()).
 */
export const SCREEN_COLS = catalog.screens.cols;
export const SCREEN_ROWS = catalog.screens.rows;
export const SCREEN_COUNT = catalog.screens.count;
