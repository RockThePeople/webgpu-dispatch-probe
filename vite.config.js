import { defineConfig } from 'vite';

// base must match the GitHub Pages repository name so that asset URLs resolve
// at https://<user>.github.io/webgpu-dispatch-probe/
export default defineConfig({
  base: '/webgpu-dispatch-probe/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
});
