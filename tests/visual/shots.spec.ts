import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Viewpoint } from '../../src/debug/viewpoints';

// Read as a file: Playwright's ESM loader rejects JSON imports without an import attribute.
const VIEWPOINTS: Viewpoint[] = JSON.parse(readFileSync('src/debug/viewpoints.json', 'utf8'));

const LAYOUT = process.env.LAYOUT ?? 'district_a';

// For every viewpoint: always save the current render to build/shots/ (for review),
// then compare against the approved baseline in tests/visual/baselines/.
for (const vp of VIEWPOINTS) {
  test(`${LAYOUT} @ ${vp.name}`, async ({ page }) => {
    await page.goto(`/?layout=${LAYOUT}&viewpoint=${vp.name}`);
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 45_000 });
    await page.screenshot({ path: `build/shots/${LAYOUT}/${vp.name}.png` });
    await expect(page).toHaveScreenshot(`${LAYOUT}/${vp.name}.png`);
  });
}
