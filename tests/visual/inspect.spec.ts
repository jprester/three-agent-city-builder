import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Contact sheet of one asset (src/debug/inspect.ts): `npm run inspect -- <asset id>` or
 *   INSPECT=buildings/tower_c FACADES=all VIEWS=all LIGHT=day OVERLAY=1 TILE=360x240
 * writes build/inspect/<asset>[-night][-overlay].png. Skipped unless INSPECT is set, so the
 * shots run (same Playwright project) does not pick it up.
 */
const ASSET = process.env.INSPECT ?? '';
const LIGHT = process.env.LIGHT ?? 'day';
const OVERLAY = process.env.OVERLAY === '1';

test(`inspect ${ASSET}`, async ({ page }) => {
  test.skip(!ASSET, 'set INSPECT=<asset id>');
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const q = new URLSearchParams({
    inspect: ASSET, sheet: '1', light: LIGHT, facades: process.env.FACADES ?? 'all',
    views: process.env.VIEWS ?? 'all', tile: process.env.TILE ?? '360x240', overlay: OVERLAY ? '1' : '0',
    scale: process.env.SCALE ?? '1,1,1',
  });
  await page.goto(`/?${q}`);
  await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 240_000 });
  if (errors.length) throw new Error(errors.join('\n'));
  mkdirSync('build/inspect', { recursive: true });
  const name = ASSET.replace(/\//g, '_') + (LIGHT === 'day' ? '' : `-${LIGHT}`) + (OVERLAY ? '-overlay' : '');
  // The sheet is larger than the window: grow the window to it, then capture the canvas.
  const size = await page.evaluate(() => { const c = document.getElementById('inspect-sheet') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
  await page.setViewportSize(size);
  await page.locator('#inspect-sheet').screenshot({ path: `build/inspect/${name}.png` });
});
