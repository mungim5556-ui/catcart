import { defineConfig } from 'vite';

// base './' so the build also works from a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 }, // three.js alone is ~700 kB
});
