import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Viewpoint } from '../../src/debug/viewpoints';
import type { SceneStats } from '../../src/main';

// Read as a file: Playwright's ESM loader rejects JSON imports without an import attribute.
const VIEWPOINTS: Viewpoint[] = JSON.parse(readFileSync('src/debug/viewpoints.json', 'utf8'));
const SCENE_BUDGET: { maxDrawCalls: number; maxTriangles: number; maxPrograms: number } =
  JSON.parse(readFileSync('pipeline.config.json', 'utf8')).scene;

const LAYOUT = process.env.LAYOUT ?? 'district_a';
/** Every shot freezes the shared clock here so animated scenes are reproducible. */
const FROZEN_TIME = 12;
const OUT_DIR = `build/shots/${LAYOUT}`;
const INFO_FILE = `${OUT_DIR}/info.json`;

/**
 * Merges one viewpoint's stats into info.json. Written per test rather than in
 * afterAll because Playwright restarts the worker (losing module state) after a
 * failed test, and baseline diffs fail tests by design.
 */
function recordStats(name: string, stats: SceneStats) {
  mkdirSync(OUT_DIR, { recursive: true });
  const prev = existsSync(INFO_FILE) ? JSON.parse(readFileSync(INFO_FILE, 'utf8')) : {};
  const viewpoints: Record<string, SceneStats> = {};
  // Keep only current viewpoints, in viewpoints.json order.
  for (const vp of VIEWPOINTS) {
    const s = vp.name === name ? stats : prev.viewpoints?.[vp.name];
    if (s) viewpoints[vp.name] = s;
  }
  writeFileSync(INFO_FILE, JSON.stringify({ layout: LAYOUT, t: FROZEN_TIME, budget: SCENE_BUDGET, viewpoints }, null, 2) + '\n');
}

function budgetViolations(stats: SceneStats): string[] {
  const out: string[] = [];
  if (stats.calls > SCENE_BUDGET.maxDrawCalls) out.push(`draw calls ${stats.calls} > ${SCENE_BUDGET.maxDrawCalls}`);
  if (stats.triangles > SCENE_BUDGET.maxTriangles) out.push(`triangles ${stats.triangles} > ${SCENE_BUDGET.maxTriangles}`);
  if (stats.programs > SCENE_BUDGET.maxPrograms) out.push(`shader programs ${stats.programs} > ${SCENE_BUDGET.maxPrograms}`);
  return out;
}

// For every viewpoint: always save the current render and its renderer stats to
// build/shots/ (for review), check the scene budget, then compare against the
// approved baseline in tests/visual/baselines/.
for (const vp of VIEWPOINTS) {
  test(`${LAYOUT} @ ${vp.name}`, async ({ page }) => {
    await page.goto(`/?layout=${LAYOUT}&viewpoint=${vp.name}&t=${FROZEN_TIME}`);
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 45_000 });
    await page.screenshot({ path: `${OUT_DIR}/${vp.name}.png` });

    const stats = await page.evaluate(() => window.__STATS);
    expect(stats, `${vp.name}: window.__STATS missing; the app failed before its ready frame`).toBeDefined();
    recordStats(vp.name, stats!);
    expect.soft(budgetViolations(stats!), `Scene budget exceeded at viewpoint "${vp.name}" (pipeline.config.json → scene)`).toEqual([]);

    // Array form keeps the layout folder; a string name would be flattened to "district-a-canyon.png".
    await expect(page).toHaveScreenshot([LAYOUT, `${vp.name}.png`]);
  });
}
