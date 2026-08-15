// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { context as esbuildContext, type BuildContext } from 'esbuild';
import { ESENGINE_EXTERNAL } from '../pipeline/src/bundle/esengineResolve';

/**
 * Realm hosts run in a browser realm outside Vite, loaded over their own import
 * maps. Bundled HERE, at editor build time, into dist-electron/hosts/ — never
 * from sources at runtime, since a packaged app ships none and esbuild (a native
 * subprocess) cannot read app.asar.
 */
function realmHosts(): Plugin {
  let ctx: BuildContext | null = null;
  const create = () =>
    esbuildContext({
      entryPoints: [
        { in: 'src/playHost.ts', out: 'playHost' },
        { in: '../pipeline/src/runtime/gameHost.ts', out: 'gameHost' },
        { in: '../pipeline/src/runtime/playableHost.ts', out: 'playableHost' },
      ],
      outdir: 'dist-electron/hosts',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      external: ESENGINE_EXTERNAL,
      sourcemap: false,
      logLevel: 'warning',
    });
  return {
    name: 'realm-hosts',
    async buildStart() {
      if (ctx) return; // serve mode owns the watching context
      const once = await create();
      await once.rebuild();
      await once.dispose();
    },
    async configureServer(server) {
      ctx = await create();
      await ctx.rebuild();
      await ctx.watch();
      server.httpServer?.once('close', () => void ctx?.dispose());
    },
  };
}

// Estella Editor — Electron + React + Vite.
// `public/` (wasm runtime, bundled SDK, example projects) is served at the web root,
// so the engine binary is reachable at /wasm/esengine.wasm once we wire the viewport.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bind IPv4 loopback explicitly. On Windows `localhost` resolves to ::1 first,
    // so a default bind leaves Vite on [::1] only — but Electron's loadURL hits
    // 127.0.0.1 and gets ERR_CONNECTION_REFUSED. Pinning 127.0.0.1 keeps the dev
    // renderer origin reachable from the Electron window.
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      // Renderer entries: the editor shell (index) + the headless render host
      // (headless, for automation/verification). The play realm is NOT a Vite
      // entry — it's esbuilt (esengine external) into the project's .esengine/play/
      // and served from estella:// (see electron/buildPlayRealm.ts).
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        headless: fileURLToPath(new URL('./headless.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    realmHosts(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // esbuild ships a native binary it locates via __dirname; bundling it into
        // the ESM main breaks that (`filename is not defined` when buildScripts /
        // exportGame run it). Keep it external → required from node_modules at
        // runtime where its binary resolution works. (Vite 8 = Rolldown, so the
        // option is `rolldownOptions`, not `rollupOptions`.)
        // typescript is external for the same shape of reason and one more: it is
        // CommonJS, and bundling it into the ESM main broke the app on boot
        // (`__filename is not defined in ES module scope`). It also ships as a
        // RUNTIME dependency — the editor's language service (scriptService.ts)
        // is a shipped feature, not a dev tool.
        // esbuild, the Basis KTX2 encoder, ffmpeg-static and the Draco decoder
        // all resolve sibling binaries at runtime (native exe / wasm via
        // import.meta.url / module __dirname), which bundling breaks.
        // electron-updater is external for a different reason: it resolves its own
        // package.json and requires its providers by path, and it must stay the
        // CommonJS package Node's interop knows how to load (see autoUpdate.ts).
        // The cast keeps `rolldownOptions` — vite-plugin-electron types its
        // `vite` option against a vite whose BuildOptions predates the rename,
        // and `rollupOptions` is the wrong option for the bundler that runs.
        vite: {
          build: {
            rolldownOptions: {
              external: ['esbuild', 'typescript', 'ffmpeg-static', 'draco3dgltf', 'electron-updater', /[\\/]build-tools[\\/]basis[\\/]/],
            },
          } as never,
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      // The renderer is a normal Vite app; no Node integration in the window.
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
});
