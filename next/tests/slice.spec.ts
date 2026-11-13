import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * The slice's one gate: every viewpoint renders without browser errors, inside the budgets of
 * next/budgets.json, and a screenshot of each lands in build/shots/next/ for looking at.
 * Frozen clock for the screenshots, then a running clock for the frame time, so the compute
 * passes (traffic, rain) are measured too. `npm run next:shots`.
 */
const VIEWS = ['corner', 'under', 'platform', 'deck', 'above', 'skyline'];
const BUDGET = JSON.parse(readFileSync('next/budgets.json', 'utf8')) as { maxDrawCalls: number; maxTriangles: number; maxFrameMs: number; maxGpuProcessMB: number };
const OUT = 'build/shots/next';
const report: Record<string, unknown> = {};

type Slice = { calls: number; triangles: number; cars: number; boxes: number; signs: number; buildings: number };

test.beforeEach(async ({ page }) => {
  // Submit-to-done per frame: wall time until the GPU has finished the frame's work.
  await page.addInitScript(() => {
    const w = window as unknown as { __device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; __sync: number[] };
    w.__sync = [];
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(...a: unknown[]): Promise<{ requestDevice(...a: unknown[]): Promise<unknown> } | null> } }).gpu;
    if (!gpu) return;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async (...a: unknown[]) => {
      const adapter = await requestAdapter(...a);
      if (adapter) {
        const requestDevice = adapter.requestDevice.bind(adapter);
        adapter.requestDevice = async (...b: unknown[]) => (w.__device = await requestDevice(...b) as typeof w.__device);
      }
      return adapter;
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const t0 = performance.now();
      cb(t);
      if (w.__device) void w.__device.queue.onSubmittedWorkDone().then(() => w.__sync.push(performance.now() - t0));
    });
  });
});

/** GPU process memory footprint (macOS `footprint`), MB; null elsewhere. */
function gpuFootprint(): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    const ps = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
    const pids = ps.split('\n').filter((l) => l.includes('--type=gpu-process') && l.includes('ms-playwright')).map((l) => l.trim().split(/\s+/)[0]);
    let total = 0;
    for (const pid of pids) {
      const m = execSync(`footprint -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).match(/phys_footprint:\s*([\d.]+)\s*([KMG])B/);
      if (m) total += parseFloat(m[1]) * { K: 1 / 1024, M: 1, G: 1024 }[m[2] as 'K' | 'M' | 'G'];
    }
    return pids.length ? Math.round(total) : null;
  } catch { return null; }
}

for (const view of VIEWS) {
  test(`slice @ ${view}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`/?view=${view}&t=20`);
    await page.waitForFunction(() => (window as unknown as { __READY?: boolean }).__READY === true, undefined, { timeout: 90_000 });
    await page.waitForTimeout(500);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${view}.png` });
    const s = await page.evaluate(() => (window as unknown as { __SLICE?: Slice }).__SLICE);
    expect(s, 'the page never reached its ready frame').toBeTruthy();

    // Running clock: warm up, then the median of two seconds of frames.
    await page.goto(`/?view=${view}`);
    await page.waitForFunction(() => (window as unknown as { __READY?: boolean }).__READY === true, undefined, { timeout: 90_000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => { (window as unknown as { __sync: number[] }).__sync.length = 0; });
    await page.waitForFunction(() => (window as unknown as { __sync: number[] }).__sync.length >= 120, undefined, { timeout: 60_000 });
    const sync = (await page.evaluate(() => (window as unknown as { __sync: number[] }).__sync.slice())).sort((a, b) => a - b);
    const frameMs = { p50: +sync[Math.floor(sync.length / 2)].toFixed(1), p95: +sync[Math.floor(sync.length * 0.95)].toFixed(1) };
    const gpuProcessMB = gpuFootprint();
    await page.screenshot({ path: `${OUT}/${view}-live.png` });

    report[view] = { ...s, frameMs, gpuProcessMB };
    writeFileSync(`${OUT}/info.json`, JSON.stringify({ resolution: '1440x900@2x', budget: BUDGET, views: report }, null, 2) + '\n');
    console.log(`${view.padEnd(9)} ${s!.calls} calls, ${s!.triangles} tris, frame ${frameMs.p50} ms (p95 ${frameMs.p95}), GPU process ${gpuProcessMB ?? '?'} MB`);

    expect.soft(errors, `${view}: browser errors`).toEqual([]);
    expect.soft(s!.calls, `${view}: draw calls`).toBeLessThanOrEqual(BUDGET.maxDrawCalls);
    expect.soft(s!.triangles, `${view}: triangles`).toBeLessThanOrEqual(BUDGET.maxTriangles);
    expect.soft(frameMs.p50, `${view}: median frame over the 60 fps budget`).toBeLessThan(BUDGET.maxFrameMs);
    if (gpuProcessMB !== null) expect.soft(gpuProcessMB, `${view}: GPU process memory`).toBeLessThanOrEqual(BUDGET.maxGpuProcessMB);
  });
}
