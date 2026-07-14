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
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime, atlasCatalogFields } from 'esengine';
import type { CatalogData, CookedAtlasInfo, ESEngineModule, SceneData } from 'esengine';

interface GameConfig {
  entryScene: string;
  /** Every switchable scene (SceneManager name + cooked path); includes the entry. */
  scenes?: Array<{ name: string; path: string }>;
  /** Bitmask of render layers (0..31) that y-sort within the layer. */
  ySortLayers?: number;
  /** Project color space — 'linear' boots the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
}
interface CookedManifest {
  entries: { uuid: string; path: string; sourcePath?: string; type: string; atlas?: CookedAtlasInfo }[];
}

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

  const cfg = (await (await fetch('./game.config.json')).json()) as GameConfig;
  const manifest = (await (await fetch('./assets.manifest.json')).json()) as CookedManifest;
  const sceneData = (await (await fetch(`./${cfg.entryScene}`)).json()) as SceneData;
  const assetManifest: Record<string, string> = {};
  // Logical → staged resolution for PATH-style refs, twice over: `pathMap` for
  // Assets-level refs (resolved before extension sniffing, so a .png staged as
  // .ktx2 transcodes), `catalog` buildPaths for the loaders' inner text refs
  // (a material's shader). Both derive from the manifest's sourcePath — the
  // asset's logical identity that content-addressed staging preserves.
  const pathMap: Record<string, string> = {};
  const catalog: CatalogData = { version: 1, entries: {} };
  for (const e of manifest.entries) {
    assetManifest[e.uuid.toLowerCase()] = `./${e.path}`;
    const logical = e.sourcePath ?? e.path;
    // Atlas-packed frame: its `path` already points at the PAGE file (URL-level
    // redirect); the catalog additionally carries frame/uv so the scene loader
    // can aim each sprite's uvOffset/uvScale at its rect — keyed by every ref
    // spelling a scene can use, `@uuid:` included.
    const atlasFields = e.atlas ? atlasCatalogFields(e.atlas, `./${e.path}`) : null;
    if (atlasFields) {
      catalog.entries[`@uuid:${e.uuid.toLowerCase()}`] = { type: e.type, buildPath: `./${e.path}`, ...atlasFields };
    }
    pathMap[logical] = `./${e.path}`;
    catalog.entries[logical] = { type: e.type, buildPath: `./${e.path}`, ...(atlasFields ?? {}) };
    // The cook writes project-absolute refs as "/<logical>" when the logical
    // path lacks a passthrough prefix — register that spelling too.
    pathMap[`/${logical}`] = `./${e.path}`;
    catalog.entries[`/${logical}`] = { type: e.type, buildPath: `./${e.path}`, ...(atlasFields ?? {}) };
  }

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
    glContextHandle: glHandle,
    ySortLayers: cfg.ySortLayers,
    colorSpace: cfg.colorSpace,
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
    };
  }
  // physics.wasm sits next to esengine.wasm; the runtime loads it when the scene
  // uses physics. (Runtime-spawned bodies still need a build-time enable flag —
  // a follow-up that cooks features.physics into game.config.json.)
  // The entry scene boots eagerly (already fetched); every other shipped scene
  // registers lazily by path, so SceneManager.switchTo('name') fetches it on
  // first use — the same registration shape the WeChat runtime uses.
  const sceneList = cfg.scenes ?? [];
  const entryName = sceneList.find((s) => s.path === cfg.entryScene)?.name;
  await initPlayRealmRuntime({
    app,
    module,
    canvas,
    sceneData,
    entrySceneName: entryName,
    extraScenes: sceneList
      .filter((s) => s.path !== cfg.entryScene)
      .map((s) => ({ name: s.name, path: `./${s.path}` })),
    assetManifest,
    assetPathMap: pathMap,
    catalogData: catalog,
    wasmBaseUrl: wasmBase.replace(/\/$/, ''),
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[game] boot failed', err);
  // The game realm has no editor stylesheet — this literal mirrors --error.
  document.body.innerHTML = `<pre style="color:#d65a5a;padding:20px;font:13px monospace">${message}</pre>`;
});
