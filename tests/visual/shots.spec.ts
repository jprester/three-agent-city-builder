import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Viewpoint } from '../../src/debug/viewpoints';
import type { SceneStats } from '../../src/main';

/**
 * Smoke test: loads a few viewpoints and fails only on real breakage — browser errors, a blank
 * frame, the scene budget, or a frame time far beyond the 60 fps goal. No pixel baselines:
 * the screenshots in build/shots/ are for looking at, not for diffing.
 *   SHOTS=all          every viewpoint in src/debug/viewpoints.json (default: SMOKE below)
 *   SHOTS=canyon,glass  just these
 */
const ALL: Viewpoint[] = JSON.parse(readFileSync('src/debug/viewpoints.json', 'utf8'));
const SMOKE = ['canyon', 'aerial', 'skyline-hero'];
const pick = process.env.SHOTS === 'all' ? ALL.map((v) => v.name) : process.env.SHOTS?.split(',') ?? SMOKE;
const VIEWPOINTS = ALL.filter((v) => pick.includes(v.name));
const BUDGET: { maxDrawCalls: number; maxTriangles: number; maxPrograms: number; maxFrameMs: number } =
  JSON.parse(readFileSync('pipeline.config.json', 'utf8')).scene;

const LAYOUT = process.env.LAYOUT ?? 'city';
/** Shots freeze the shared clock here, so animated scenes are comparable between runs. */
const FROZEN_TIME = 12;
const OUT_DIR = `build/shots/${LAYOUT}`;
const INFO_FILE = `${OUT_DIR}/info.json`;

type Shot = SceneStats & { frameMs: { avg: number; p95: number } };

/** Merges one viewpoint's numbers into info.json (per test: workers restart after failures). */
function record(name: string, shot: Shot) {
  mkdirSync(OUT_DIR, { recursive: true });
  const prev = existsSync(INFO_FILE) ? JSON.parse(readFileSync(INFO_FILE, 'utf8')) : {};
  const viewpoints: Record<string, Shot> = {};
  for (const vp of ALL) {
    const s = vp.name === name ? shot : prev.viewpoints?.[vp.name];
    if (s) viewpoints[vp.name] = s;
  }
  writeFileSync(INFO_FILE, JSON.stringify({ layout: LAYOUT, t: FROZEN_TIME, budget: BUDGET, viewpoints }, null, 2) + '\n');
}

function violations(s: Shot): string[] {
  const out: string[] = [];
  if (s.calls > BUDGET.maxDrawCalls) out.push(`draw calls ${s.calls} > ${BUDGET.maxDrawCalls}`);
  if (s.triangles > BUDGET.maxTriangles) out.push(`triangles ${s.triangles} > ${BUDGET.maxTriangles}`);
  if (s.programs > BUDGET.maxPrograms) out.push(`shader programs ${s.programs} > ${BUDGET.maxPrograms}`);
  if (s.frameMs.avg > BUDGET.maxFrameMs) out.push(`frame time ${s.frameMs.avg} ms > ${BUDGET.maxFrameMs} ms`);
  return out;
}

for (const vp of VIEWPOINTS) {
  test(`${LAYOUT} @ ${vp.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/?layout=${LAYOUT}&viewpoint=${vp.name}&t=${FROZEN_TIME}&dynres=0`);
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 90_000 });

    // Frame time over ~1.5 s of the running loop (a rough GPU-load signal, vsync-capped).
    const frameMs = await page.evaluate(() => new Promise<{ avg: number; p95: number }>((resolve) => {
      const dts: number[] = [];
      let last = performance.now();
      const step = (now: number) => {
        dts.push(now - last); last = now;
        if (dts.length < 90) requestAnimationFrame(step);
        else {
          const d = dts.slice(10).sort((a, b) => a - b);
          const r = (x: number) => Math.round(x * 10) / 10;
          resolve({ avg: r(d.reduce((s, x) => s + x, 0) / d.length), p95: r(d[Math.floor(d.length * 0.95)]) });
        }
      };
      requestAnimationFrame(step);
    }));
    await page.evaluate(() => window.__PAUSE_RENDER?.());
    const screenshot = await page.screenshot({ path: `${OUT_DIR}/${vp.name}.png` });

    // Draw counts cannot detect NaNs spreading through HDR bloom to a black frame.
    const visibleFraction = await page.evaluate(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 18;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 32, 18);
      const pixels = ctx.getImageData(0, 0, 32, 18).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 2) visible++;
      return visible / (32 * 18);
    }, screenshot.toString('base64'));

    const stats = await page.evaluate(() => window.__STATS);
    expect(stats, `${vp.name}: window.__STATS missing; the app failed before its ready frame`).toBeDefined();
    const shot = { ...stats!, frameMs };
    record(vp.name, shot);
    console.log(`${vp.name}: ${shot.calls} calls, ${shot.triangles} tris, ${shot.programs} programs, ${frameMs.avg} ms/frame (p95 ${frameMs.p95})`);
    expect.soft(visibleFraction, `${vp.name}: render is blank`).toBeGreaterThan(0.05);
    expect.soft(violations(shot), `Scene budget exceeded at "${vp.name}" (pipeline.config.json → scene)`).toEqual([]);
    expect.soft(errors, `${vp.name}: browser errors`).toEqual([]);
  });
}
