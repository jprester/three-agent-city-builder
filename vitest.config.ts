import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit tests only; tests/visual is Playwright (`npm run shots`).
  test: { include: ['tests/unit/**/*.test.ts'] },
});
