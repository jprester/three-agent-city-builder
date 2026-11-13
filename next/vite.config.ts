import { defineConfig } from 'vite';

// The slice is its own page with its own root; it reads the palette, the sign atlas and the
// seeded random helper from the parent repository (art/), hence the wider file-system allowance.
export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5183, fs: { allow: ['..'] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
