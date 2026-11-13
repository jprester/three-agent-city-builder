import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Performance report on the real GPU at a Retina laptop resolution (1440×900 @2x): GPU time per
 * frame (WebGL timer queries around each animation frame), CPU time per frame, JS heap, and on
 * macOS the GPU process's memory footprint. Fails only when the median GPU frame no longer fits
 * 60 fps. `npm run perf`; PERF_VIEWS=canyon,aerial picks viewpoints, PERF_DPR / PERF_QUALITY below.
 *
 * Comparing renderers (the WebGPU proof of concept is APP=poc): GPU time comes from different
 * instruments, a WebGL timer query around the whole frame and WebGPU timestamp queries around
 * each pass, so compare `syncMs` instead: wall time from the start of a frame until the GPU
 * has finished its work, CPU included. WebGPU reports it without disturbing anything; WebGL
 * needs PERF_SYNC=1, which blocks on a one-pixel read-back at the end of every frame.
 * `frameMs` is the interval between animation frames (16.7 under vsync).
 */
const VIEWS = process.env.PERF_VIEWS?.split(',') ?? ['canyon', 'storefront', 'aerial', 'harbor', 'fly-75'];
/** PERF_DPR: device pixel ratio (default 2, Retina); PERF_QUALITY: low | med | high. */
const DPR = Number(process.env.PERF_DPR ?? 2);
const QUALITY = process.env.PERF_QUALITY ?? 'high';
const FRAMES = 120;
/** APP=poc measures the WebGPU proof of concept (poc.html), which reports its own GPU timestamps into __gpu. */
const APP = process.env.APP === 'poc' ? '/poc.html' : '/';
/** PERF_BACKEND=webgl runs the proof of concept's node materials on three's WebGL 2 backend. */
const BACKEND = process.env.PERF_BACKEND ? `&backend=${process.env.PERF_BACKEND}` : '';
const report: Record<string, unknown> = {};

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });

test.beforeEach(async ({ page }) => {
  // Time every animation frame on the GPU, without hooks in the app.
  await page.addInitScript((sync) => {
    const w = window as unknown as { __gl?: WebGL2RenderingContext; __device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; __gpu: number[]; __cpu: number[]; __dt: number[]; __sync: number[] };
    w.__gpu = []; w.__cpu = []; w.__dt = []; w.__sync = [];
    // The WebGPU device, for the submit-to-done measurement below.
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(...a: unknown[]): Promise<{ requestDevice(...a: unknown[]): Promise<unknown> } | null> } }).gpu;
    if (gpu) {
      const requestAdapter = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (...a: unknown[]) => {
        const adapter = await requestAdapter(...a);
        if (adapter) {
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...b: unknown[]) => (w.__device = await requestDevice(...b) as typeof w.__device);
        }
        return adapter;
      };
    }
    let lastT = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (type === 'webgl2' && ctx && !w.__gl) w.__gl = ctx as WebGL2RenderingContext;
      return ctx;
    } as typeof getContext;
    const raf = window.requestAnimationFrame.bind(window);
    const pending: WebGLQuery[] = [];
    window.requestAnimationFrame = (cb) => raf((t) => {
      if (lastT) w.__dt.push(t - lastT);
      lastT = t;
      const gl = w.__gl, ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
      let q: WebGLQuery | null = null;
      if (gl && ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q!); }
      const t0 = performance.now();
      cb(t);
      w.__cpu.push(performance.now() - t0);
      // Submit-to-done: wall time until the GPU has finished this frame's work. WebGL blocks on a
      // one-pixel read-back (PERF_SYNC only: it changes the frame); WebGPU has a promise for it.
      if (sync && gl) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); w.__sync.push(performance.now() - t0); }
      else if (w.__device) void w.__device.queue.onSubmittedWorkDone().then(() => w.__sync.push(performance.now() - t0));
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
  }, !!process.env.PERF_SYNC);
});

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), at = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  return { p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), n: s.length };
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
    await page.goto(`${APP}?viewpoint=${view}&dynres=0&quality=${QUALITY}${BACKEND}`);
    await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 90_000 });
    // Warm up: a cold first page (shader compiles, uploads, the dev server's first transforms)
    // measured up to 4× slower than steady state.
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const w = window as unknown as { __gpu: number[]; __cpu: number[]; __dt: number[] }; w.__gpu.length = 0; w.__cpu.length = 0; w.__dt.length = 0; (w as unknown as { __sync: number[] }).__sync.length = 0; });
    await page.waitForFunction((n) => { const w = window as unknown as { __gpu: number[]; __sync: number[] }; return Math.max(w.__gpu.length, w.__sync.length) >= n; }, FRAMES, { timeout: 60_000 });
    const { gpu, cpu, dt, sync, heap } = await page.evaluate(() => {
      const w = window as unknown as { __gpu: number[]; __cpu: number[]; __dt: number[]; __sync: number[] };
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return { gpu: w.__gpu.slice(), cpu: w.__cpu.slice(), dt: w.__dt.slice(), sync: w.__sync.slice(), heap: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null };
    });
    const r = { gpuMs: gpu.length ? stats(gpu) : null, syncMs: sync.length ? stats(sync) : null, cpuMs: stats(cpu), frameMs: stats(dt), heapMB: heap, gpuProcessMB: gpuFootprint() };
    report[view] = r;
    console.log(`${view.padEnd(12)} GPU ${r.gpuMs?.p50 ?? '-'} ms (p95 ${r.gpuMs?.p95 ?? '-'})  submit-to-done ${r.syncMs?.p50 ?? '-'} ms (p95 ${r.syncMs?.p95 ?? '-'})  CPU ${r.cpuMs.p50} ms (p95 ${r.cpuMs.p95})  frame ${r.frameMs.p50} ms  heap ${heap} MB  GPU process ${r.gpuProcessMB ?? '?'} MB`);
    mkdirSync('build/perf', { recursive: true });
    writeFileSync(`build/perf/report${process.env.APP === 'poc' ? '-poc' : ''}${process.env.PERF_BACKEND ? `-${process.env.PERF_BACKEND}` : ''}${process.env.PERF_SYNC ? '-sync' : ''}.json`, JSON.stringify({ resolution: `1440x900@${DPR}x`, quality: QUALITY, app: process.env.APP ?? 'app', sync: !!process.env.PERF_SYNC, views: report }, null, 2) + '\n');
    expect(r.gpuMs?.p50 ?? r.syncMs?.p50 ?? 0, `${view}: median GPU frame over the 60 fps budget`).toBeLessThan(16.7);
  });
}
