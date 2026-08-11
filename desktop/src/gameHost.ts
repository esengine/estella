// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gameHost.ts — the exported game's runtime host.
 *        Bundled by exportGame (esbuild, esengine inlined) into a
 *        self-contained game.js. Boots the SAME shipping runtime the editor's
 *        play realm uses (createWebApp → initPlayRealmRuntime), but loads the
 *        scene + asset manifest from the COOKED files next to index.html — so the
 *        shipped game is what the editor played (play == ship).
 *
 *        Builtin scenes run as-is; project custom-script bundles are a follow-up
 *        (shared with the play realm's import-map work).
 */
import {
  createWebApp, setEditorMode, setPlayMode, Assets,
  indexPackagedManifest, createPackagedAssetSource, applyAssetRefResolvers, initRuntime,
  HttpBackend, fetchDecodePixels, registerPackagedSideModules,
  packagedAppOptions, packagedRuntimeInit, Transform, SceneManager, Nav,
} from 'esengine';
import type { SceneData, AddressableManifest, PackagedGameConfig } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
async function boot(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  // Render-verification hook: with ?headless the cooked build keeps its drawing
  // buffer + exposes a framebuffer readback, so a driver can prove the SHIPPED
  // runtime actually rendered the cooked scene (the editor host can't — it uses a
  // different asset path).
  const headless = new URLSearchParams(location.search).has('headless');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  // Register the project's own components/systems first (side-effect import; its
  // `import 'esengine'` resolves through the page import map to the shared SDK).
  try {
    await import(/* @vite-ignore */ new URL('./scripts.mjs', import.meta.url).href);
  } catch {
    /* no project bundle — builtin-only */
  }

  const cfg = (await (await fetch('./game.config.json')).json()) as PackagedGameConfig;
  // Before anything acquires: the project's own modules were staged into wasm/
  // beside the engine's, and this is what makes their ids resolvable.
  registerPackagedSideModules(cfg);
  // The addressable manifest is the asset index — the same one the WeChat and
  // native runtimes read. It resolves every ref spelling to its staged path and
  // carries the atlas metadata the catalog needs, so there is one asset model
  // across every packaged realm rather than a flat map here and a manifest there.
  const index = indexPackagedManifest(
    (await (await fetch('./asset-manifest.json')).json()) as AddressableManifest,
  );
  const sceneData = (await (await fetch(`./${cfg.entryScene}`)).json()) as SceneData;

  const wasmBase = new URL('./wasm/', import.meta.url).href; // relative → mount-path agnostic
  const { default: createModule } = (await import(/* @vite-ignore */ `${wasmBase}esengine.js`)) as {
    default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
  };
  const module = await createModule({
    canvas,
    locateFile: (p: string) => `${wasmBase}${p}`,
    print: (t: string) => console.log(t),
    printErr: (t: string) => console.error(t),
  });

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: headless,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 is not available.');
  const glHandle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });

  const app = createWebApp(module, {
    renderSurface: { kind: 'gl-context', handle: glHandle },
    // Everything the config says an App must be BUILT with (see packagedAppOptions).
    ...packagedAppOptions(cfg),
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    wasmBaseUrl: wasmBase.replace(/\/$/, ''), // SDK appends "/<file>" — no trailing slash
  });
  setEditorMode(false);
  setPlayMode(true);
  if (headless) {
    (window as unknown as { __estellaCooked?: unknown }).__estellaCooked = {
      capture(): { width: number; height: number; rgba: Uint8Array } {
        const w = canvas.width, h = canvas.height;
        const rgba = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return { width: w, height: h, rgba };
      },
      /**
       * Where things are, for a driver that has to play rather than just look.
       * Capture answers "did it draw"; walking a route needs "am I there yet",
       * and guessing that from frame counts breaks on the first enemy in the
       * way. Named entities only, and only the names asked for.
       */
      probe(names: string[] = []): {
        scene: string | null;
        transitioning: boolean;
        at: Record<string, { x: number; y: number }>;
      } {
        const at: Record<string, { x: number; y: number }> = {};
        for (const name of names) {
          const entity = app.world.findEntityByName(name);
          if (entity === null || !app.world.has(entity, Transform)) continue;
          // World, not local: a driver asks where something IS, and for anything
          // parented (every UI node) the local offset answers a different question.
          const t = app.world.get(entity, Transform);
          const p = t.worldPosition ?? t.position;
          at[name] = { x: p.x, y: p.y };
        }
        const scenes = app.hasResource(SceneManager) ? app.getResource(SceneManager) : null;
        // A scene arrives entity by entity, and a driver polling from outside
        // the frame loop can land in the middle of that. Half a world reads as
        // "the thing I was walking to is gone", which is a lie with a cost.
        return { scene: scenes?.getActive() ?? null, transitioning: scenes?.isTransitioning() ?? false, at };
      },
      /**
       * A way from one named entity to another, over the same navigation grid
       * the game's own enemies walk. A driver that steers straight at its goal
       * is a driver that walks into the first wall between them; asking the
       * game means the route stays right when the level is re-authored.
       */
      pathBetween(fromName: string, toName: string): Array<{ x: number; y: number }> | null {
        if (!app.hasResource(Nav)) return null;
        const ends = [fromName, toName].map((name) => {
          const entity = app.world.findEntityByName(name);
          if (entity === null || !app.world.has(entity, Transform)) return null;
          const p = app.world.get(entity, Transform).position;
          return { x: p.x, y: p.y };
        });
        if (!ends[0] || !ends[1]) return null;
        return app.getResource(Nav).findWorldPath(ends[0], ends[1]);
      },
      /** Drive a hot update against a served (CDN) manifest: fetch + diff + apply.
       *  Rebinding the visuals is the game's job (via Assets.onInvalidate); a
       *  driver settles frames after this before re-capturing. */
      async applyRemoteUpdate(manifestUrl: string, remoteRoot?: string): Promise<{ changed: number; applied: boolean; failed: number }> {
        const assets = app.getResource(Assets);
        const plan = await assets.checkForUpdate({ manifestUrl, remoteRoot });
        const result = await assets.applyUpdate();
        return { changed: plan.changedAssets.length, applied: result.ok, failed: result.failed.length };
      },
    };
  }
  // physics.wasm sits next to esengine.wasm; the runtime loads it when a scene
  // uses physics, or when the project declared physics on for bodies it spawns
  // from script (packagedRuntimeInit carries that flag).
  // The entry scene boots eagerly (already fetched); every other shipped scene
  // registers lazily by path, so SceneManager.switchTo('name') fetches it on
  // first use — the same registration shape the WeChat runtime uses.
  const sceneList = cfg.scenes ?? [];
  const entryName = sceneList.find((s) => s.path === cfg.entryScene)?.name ?? '__play';
  // Cross-origin images taint a canvas, so a cooked build decodes through
  // fetch+blob rather than the platform's Image path.
  const source = createPackagedAssetSource(index, {
    backend: new HttpBackend({ baseUrl: '' }),
    decodePixels: (path) => fetchDecodePixels(path),
  });
  applyAssetRefResolvers(app, index.resolvePath);
  await initRuntime({
    app,
    module,
    source,
    manifest: index.manifest,
    catalog: index.catalog,
    remoteRoot: cfg.hotUpdate?.remoteRoot,
    persistUpdateKey: cfg.hotUpdate?.persistUpdateKey,
    scenes: [
      { name: entryName, data: sceneData },
      ...sceneList.filter((s) => s.path !== cfg.entryScene).map((s) => ({ name: s.name, path: s.path })),
    ],
    firstScene: entryName,
    aspectRatio: canvas.width / canvas.height,
    // Everything the config APPLIES to a live app: physics, the mixer, the theme.
    ...packagedRuntimeInit(cfg),
  });
  app.run();
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[game] boot failed', err);
  // The game realm has no editor stylesheet — this literal mirrors --error.
  document.body.innerHTML = `<pre style="color:#d65a5a;padding:20px;font:13px monospace">${message}</pre>`;
});
