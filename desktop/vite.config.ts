import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Estella Editor — Electron + React + Vite.
// `public/` (wasm runtime, bundled SDK, example projects) is served at the web root,
// so the engine binary is reachable at /wasm/esengine.wasm once we wire the viewport.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // Two renderer entries: the editor shell (index) and the headless render
      // host (headless) used for automation/verification — see headless.html.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        headless: fileURLToPath(new URL('./headless.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      // The renderer is a normal Vite app; no Node integration in the window.
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
});
