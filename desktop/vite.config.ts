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
      // Renderer entries: the editor shell (index), the headless render host
      // (headless, for automation/verification), and the isolated play realm
      // host (play, REARCH_EDITOR_REALM Phase R).
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        headless: fileURLToPath(new URL('./headless.html', import.meta.url)),
        play: fileURLToPath(new URL('./play.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // esbuild ships a native binary it locates via __dirname; bundling it into
        // the ESM main breaks that (`filename is not defined` when buildScripts /
        // exportGame run it). Keep it external → required from node_modules at
        // runtime where its binary resolution works. (Vite 8 = Rolldown, so the
        // option is `rolldownOptions`, not `rollupOptions`.)
        vite: { build: { rolldownOptions: { external: ['esbuild'] } } },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      // The renderer is a normal Vite app; no Node integration in the window.
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
});
