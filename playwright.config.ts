import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
const NEXT_PORT = 5183;
/** Real GPU by default (fast, and frame times mean something); SWIFTSHADER=1 for machines without one. */
const GPU = process.env.SWIFTSHADER
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  // One heavy scene at a time: parallel loads skew frame times and pressure GPU memory.
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      testMatch: '**/visual/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        launchOptions: { args: GPU },
      },
    },
    {
      // `npm run smoke`: every viewpoint, no screenshots (tests/smoke/smoke.spec.ts).
      name: 'smoke',
      testMatch: '**/smoke/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        launchOptions: { args: GPU },
      },
    },
    {
      // `npm run next:shots`: the fresh slice (next/tests/slice.spec.ts), at laptop resolution.
      name: 'next',
      testDir: 'next/tests',
      testMatch: '**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${NEXT_PORT}`, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, launchOptions: { args: GPU } },
    },
    {
      // `npm run perf`: real-GPU timings at laptop resolution (tests/perf/perf.spec.ts).
      name: 'perf',
      testMatch: '**/perf/*.spec.ts',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: [...GPU, '--enable-precise-memory-info'] } },
    },
  ],
  // The fresh slice (next/) is its own page on its own port; only its project needs that server.
  webServer: process.env.NEXT
    ? { command: `npx vite --config next/vite.config.ts --port ${NEXT_PORT} --strictPort`, url: `http://localhost:${NEXT_PORT}`, reuseExistingServer: !process.env.CI }
    : { command: `node tools/build-ktx2.mjs && npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI },
});
