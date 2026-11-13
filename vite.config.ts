import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Two pages: the app, and the WebGPU proof of concept (docs/WEBGPU_POC.md).
    rolldownOptions: { input: { main: 'index.html', poc: 'poc.html' } },
  },
});
