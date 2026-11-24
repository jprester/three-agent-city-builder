import catalog from '../../art/textures/signs/catalog.json';

/**
 * Video screens cycle through the brands' portrait campaigns in screens.webp
 * (tools/textures/build_signs.py): a grid of uniform 2:3 slots, addressed by index in the facade
 * shader. Screens are built at exactly 2:3 (art/generators/lib/building.py screen()).
 */
export const SCREEN_COLS = catalog.screens.cols;
export const SCREEN_ROWS = catalog.screens.rows;
export const SCREEN_COUNT = catalog.screens.count;
