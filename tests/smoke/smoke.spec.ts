import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import type { Viewpoint } from '../../src/debug/viewpoints';
import type { SceneStats } from '../../src/main';

/**
 * Smoke: does the city still render everywhere? ~30 s for all viewpoints, real GPU.
 * No screenshots and no frame timing — just load, ready, stats, console errors.
 * A failing viewpoint saves one screenshot to build/smoke/<name>.png so you can look.
 *   npm run smoke            every viewpoint
 *   SMOKE=canyon,glass       just these
 */
const ALL: Viewpoint[] = JSON.parse(readFileSync('src/debug/viewpoints.json', 'utf8'));
const BUDGET = JSON.parse(readFileSync('pipeline.config.json', 'utf8')).scene;
const pick = process.env.SMOKE?.split(',');
/** APP=poc runs the WebGPU proof of concept (poc.html) instead of the app. */
const POC = process.env.APP === 'poc';
const APP = POC ? '/poc.html' : '/';
const VIEWPOINTS = pick ? ALL.filter((v) => pick.includes(v.name)) : ALL;

test('every viewpoint renders', async ({ page }) => {
  test.setTimeout(180_000);
  let errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const failures: string[] = [];
  for (const vp of VIEWPOINTS) {
    const bad: string[] = [];
    errors = [];
    try {
      await page.goto(`${APP}?layout=city&viewpoint=${vp.name}&t=12&dynres=0`);
      await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 30_000 });
      const s = await page.evaluate(() => window.__STATS) as SceneStats | undefined;
      if (!s) throw new Error('no __STATS — the app never reached its ready frame');
      if (s.calls === 0) bad.push('nothing drew (0 draw calls)');
      if (s.calls > BUDGET.maxDrawCalls) bad.push(`draw calls ${s.calls} > ${BUDGET.maxDrawCalls}`);
      if (s.triangles > BUDGET.maxTriangles) bad.push(`triangles ${s.triangles} > ${BUDGET.maxTriangles}`);
      // The program budget is a WebGL limit (linked programs); WebGPU counts shader modules.
      if (!POC && s.programs > BUDGET.maxPrograms) bad.push(`shader programs ${s.programs} > ${BUDGET.maxPrograms}`);
    } catch (e) {
      bad.push((e as Error).message.split('\n')[0]);
    }
    if (errors.length) bad.push(errors.join(' | '));
    if (bad.length) {
      failures.push(...bad.map((b) => `${vp.name}: ${b}`));
      mkdirSync('build/smoke', { recursive: true });
      await page.screenshot({ path: `build/smoke/${vp.name}.png` });
    }
  }

  console.log(`smoke: ${VIEWPOINTS.length - failures.length}/${VIEWPOINTS.length} viewpoints clean`);
  expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
});
