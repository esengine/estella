// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playableHost.ts — the exported playable ad's host (single-HTML build).
 *        esbuilt to an IIFE by exportPlayable with esengine + the project scripts
 *        INLINED. The engine runs from the SINGLE_FILE glue (esengine.single.js —
 *        a global `ESEngineModule` factory with the wasm embedded as base64), which
 *        is a sibling inline <script>; assets + scenes are inlined globals. Boots
 *        the SAME shipping runtime via initPlayableRuntime (play == ship). Nothing
 *        is fetched — the whole game is one self-contained .html (ad-network ready).
 */
import { createWebApp, setEditorMode, setPlayMode, initPlayableRuntime, createEmbeddedSideModuleHost } from 'esengine';
import type { ESEngineModule as EngineModule, SceneData, EmbeddedSideModuleRegistry } from 'esengine';

type EngineFactory = (opts?: Record<string, unknown>) => Promise<EngineModule>;
// Inlined by exportPlayable as <script> globals (kept out of the bundle so the
// large base64 blobs aren't re-parsed as code). The glue is the WEB esengine.js
// (ESM) text; the wasm is base64-encoded esengine.wasm. __SIDE_MODULES__ holds
// the base64 glue+wasm for exactly the optional modules (physics/spine) the scene
// uses — the exporter ran the runtime's gating scan to pick them.
declare const __ENGINE_GLUE__: string;
declare const __ENGINE_WASM__: string;
declare const __SIDE_MODULES__: EmbeddedSideModuleRegistry;
declare const __GAME_ASSETS__: Record<string, string>;
declare const __GAME_PATHMAP__: Record<string, string>;
declare const __GAME_SCENES__: Array<{ name: string; data: SceneData }>;
declare const __GAME_FIRST__: string;
declare const __GAME_YSORT__: number;
declare const __GAME_COLORSPACE__: 'gamma' | 'linear';

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  if (!__ENGINE_GLUE__ || !__ENGINE_WASM__) throw new Error('Engine runtime not inlined — re-export the playable.');
  // The esengine.js glue is ESM, so run it via a blob module (own scope); feed the
  // embedded wasm through instantiateWasm so nothing is fetched (single-file).
  const blobUrl = URL.createObjectURL(new Blob([__ENGINE_GLUE__], { type: 'text/javascript' }));
  const { default: createEngine } = (await import(/* @vite-ignore */ blobUrl)) as { default: EngineFactory };
  const wasmBytes = decodeBase64(__ENGINE_WASM__);
  const module = await createEngine({
    canvas,
    instantiateWasm(imports: WebAssembly.Imports, cb: (inst: WebAssembly.Instance, mod?: WebAssembly.Module) => void) {
      WebAssembly.instantiate(wasmBytes.buffer as ArrayBuffer, imports).then(
        (r) => cb(r.instance, r.module),
        (err) => console.error('[playable] wasm instantiate failed', err),
      );
      return {};
    },
  });

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: true,
    premultipliedAlpha: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 is not available.');
  const glHandle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });

  const app = createWebApp(module, {
    glContextHandle: glHandle,
    // Older exports predate the color-space global; treat it as optional.
    colorSpace: typeof __GAME_COLORSPACE__ !== 'undefined' ? __GAME_COLORSPACE__ : undefined,
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    // Physics + spine resolve from the inlined base64 registry (no fetch).
    sideModules: createEmbeddedSideModuleHost(typeof __SIDE_MODULES__ !== 'undefined' ? __SIDE_MODULES__ : {}),
  });
  setEditorMode(false);
  setPlayMode(true);

  await initPlayableRuntime({
    app,
    module,
    canvas,
    assets: __GAME_ASSETS__,
    // Older exports predate the path map; the runtime treats it as optional.
    assetPathMap: typeof __GAME_PATHMAP__ !== 'undefined' ? __GAME_PATHMAP__ : undefined,
    scenes: __GAME_SCENES__,
    firstScene: __GAME_FIRST__,
    // Older exports predate y-sort; treat the global as optional.
    ySortLayers: typeof __GAME_YSORT__ !== 'undefined' ? __GAME_YSORT__ : undefined,
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[playable] boot failed', err);
});
