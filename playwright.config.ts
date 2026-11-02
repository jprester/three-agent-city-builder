import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
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
      // `npm run perf`: real-GPU timings at laptop resolution (tests/perf/perf.spec.ts).
      name: 'perf',
      testMatch: '**/perf/*.spec.ts',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: [...GPU, '--enable-precise-memory-info'] } },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
