import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Performance report on the real GPU at a Retina laptop resolution (1440×900 @2x): GPU time per
 * frame (WebGL timer queries around each animation frame), CPU time per frame, late frames, JS
 * heap, and on macOS the GPU process's memory footprint.
 *
 * Reading the GPU time: the query measures elapsed time, and the GPU slows its clock when a
 * frame leaves slack, so the same frame reads as its true cost on some frames and as almost a
 * whole display interval on others (aerial: 10 ms or 17 ms). `fast` (10th percentile) is the
 * cost at full clock; p50 and p95 mostly show the clock stretching. Whether frames arrive on
 * time is the `late` figure: the share of frame intervals over 1.5 display intervals.
 *
 * Fails when the GPU at full clock no longer fits 60 fps, when more than 5 % of frames are
 * late, or (macOS, default resolution and quality only) when the GPU process exceeds
 * `scene.maxGpuProcessMB` in pipeline.config.json. `npm run perf`; PERF_VIEWS=canyon,aerial
 * picks viewpoints, PERF_DPR / PERF_QUALITY below.
 */
const VIEWS = process.env.PERF_VIEWS?.split(',') ?? ['canyon', 'storefront', 'aerial', 'harbor', 'fly-75'];
/** PERF_DPR: device pixel ratio (default 2, Retina); PERF_QUALITY: low | med | high. */
const DPR = Number(process.env.PERF_DPR ?? 2);
const QUALITY = process.env.PERF_QUALITY ?? 'high';
const FRAMES = 120;
/** HAZE=full: the original full-resolution haze march (?haze=full), into build/perf/report-hazefull.json. */
const HAZE = process.env.HAZE ?? '';
/** The memory budget is set for the default measurement (2x, high); other settings only report. */
const MAX_GPU_PROCESS_MB: number | undefined = DPR === 2 && QUALITY === 'high'
  ? JSON.parse(readFileSync('pipeline.config.json', 'utf8')).scene.maxGpuProcessMB
  : undefined;
const report: Record<string, unknown> = {};

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });

test.beforeEach(async ({ page }) => {
  // Time every animation frame on the GPU, without hooks in the app.
  await page.addInitScript(() => {
    const w = window as unknown as { __gl?: WebGL2RenderingContext; __gpu: number[]; __cpu: number[]; __dt: number[] };
    w.__gpu = []; w.__cpu = []; w.__dt = [];
    let last = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (type === 'webgl2' && ctx && !w.__gl) w.__gl = ctx as WebGL2RenderingContext;
      return ctx;
    } as typeof getContext;
    const raf = window.requestAnimationFrame.bind(window);
    const pending: WebGLQuery[] = [];
    window.requestAnimationFrame = (cb) => raf((t) => {
      const gl = w.__gl, ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
      let q: WebGLQuery | null = null;
      if (gl && ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q!); }
      if (last) w.__dt.push(t - last);
      last = t;
      const t0 = performance.now();
      cb(t);
      w.__cpu.push(performance.now() - t0);
      if (gl && ext && q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
        while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const done = pending.shift()!;
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) w.__gpu.push(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(done);
        }
      }
    });
  });
});

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), at = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  return { fast: +at(0.1).toFixed(2), p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), n: s.length };
};

/** GPU process memory footprint (macOS `footprint`), MB; null elsewhere. */
function gpuFootprint(): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    const ps = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
    const pids = ps.split('\n').filter((l) => l.includes('--type=gpu-process') && l.includes('ms-playwright')).map((l) => l.trim().split(/\s+/)[0]);
    let total = 0;
    for (const pid of pids) {
      const out = execSync(`footprint -p ${pid} 2>/dev/null`, { encoding: 'utf8' });
      const m = out.match(/phys_footprint:\s*([\d.]+)\s*([KMG])B/);
      if (m) total += parseFloat(m[1]) * { K: 1 / 1024, M: 1, G: 1024 }[m[2] as 'K' | 'M' | 'G'];
    }
    return pids.length ? Math.round(total) : null;
  } catch { return null; }
}

for (const view of VIEWS) {
  test(`perf @ ${view}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/?viewpoint=${view}&dynres=0&quality=${QUALITY}${HAZE ? `&haze=${HAZE}` : ''}`);
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 90_000 });
    // Warm up: a cold first page (shader compiles, uploads, the dev server's first transforms)
    // measured up to 4× slower than steady state.
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const w = window as unknown as { __gpu: number[]; __cpu: number[]; __dt: number[] }; w.__gpu.length = 0; w.__cpu.length = 0; w.__dt.length = 0; });
    // Poll on a timer: Playwright's default polls in animation frames, and each poll would be
    // counted here as a frame with no GPU work.
    await page.waitForFunction((n) => (window as unknown as { __gpu: number[] }).__gpu.length >= n, FRAMES, { timeout: 60_000, polling: 200 });
    const { gpu, cpu, dt, heap } = await page.evaluate(() => {
      const w = window as unknown as { __gpu: number[]; __cpu: number[]; __dt: number[] };
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return { gpu: w.__gpu.slice(), cpu: w.__cpu.slice(), dt: w.__dt.slice(), heap: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null };
    });
    const interval = stats(dt).p50;
    const latePct = +(100 * dt.filter((d) => d > interval * 1.5).length / dt.length).toFixed(1);
    const r = { gpuMs: stats(gpu), cpuMs: stats(cpu), latePct, heapMB: heap, gpuProcessMB: gpuFootprint() };
    report[view] = r;
    console.log(`${view.padEnd(12)} GPU ${r.gpuMs.fast} ms fast (p50 ${r.gpuMs.p50}, p95 ${r.gpuMs.p95})  late ${latePct} %  CPU ${r.cpuMs.p50} ms (p95 ${r.cpuMs.p95})  heap ${heap} MB  GPU process ${r.gpuProcessMB ?? '?'} MB`);
    mkdirSync('build/perf', { recursive: true });
    writeFileSync(`build/perf/report${HAZE ? `-haze${HAZE}` : ''}.json`, JSON.stringify({ resolution: `1440x900@${DPR}x`, quality: QUALITY, haze: HAZE || 'half', views: report }, null, 2) + '\n');
    expect.soft(r.gpuMs.fast, `${view}: GPU frame at full clock over the 60 fps budget`).toBeLessThan(16.7);
    expect.soft(latePct, `${view}: more than 5 % of frames arrived late`).toBeLessThanOrEqual(5);
    if (MAX_GPU_PROCESS_MB !== undefined && r.gpuProcessMB !== null) {
      expect.soft(r.gpuProcessMB, `${view}: GPU process memory over scene.maxGpuProcessMB`).toBeLessThanOrEqual(MAX_GPU_PROCESS_MB);
    }
  });
}
