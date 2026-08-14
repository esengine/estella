// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playableHost.ts — the exported playable ad's host (single-HTML build).
 *        esbuilt to an IIFE by exportPlayable with esengine + the project scripts
 *        INLINED. The engine is the shipped WEB glue, handed over as the inline
 *        `__ENGINE_GLUE__` global and evaluated as a blob module (it is ESM), with
 *        the wasm arriving base64 in `__ENGINE_WASM__`; assets + scenes are inlined
 *        globals too. Boots the SAME shipping runtime via initPlayableRuntime
 *        (play == ship). Nothing is fetched — the whole game is one self-contained
 *        .html (ad-network ready).
 */
import {
  createWebApp, setEditorMode, setPlayMode, initPlayableRuntime, createEmbeddedSideModuleHost,
  packagedAppOptions, packagedRuntimeInit,
} from 'esengine';
import type { SceneData, EmbeddedSideModuleRegistry } from 'esengine';
import type { ESEngineModule as EngineModule } from 'esengine/wasm';
import type { PackagedRuntimeFields } from '../../pipeline/src/project/runtimeConfig';

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
/** The project's settings, in the same shape game.config.json carries them —
 *  one global, so a setting the export starts sending arrives without the host
 *  learning a new name for it. Absent fields are their defaults. */
declare const __GAME_RUNTIME__: PackagedRuntimeFields;

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function boot(): Promise<void> {
  // An export built before this global simply has no settings to apply.
  const runtimeConfig: PackagedRuntimeFields =
    typeof __GAME_RUNTIME__ !== 'undefined' ? __GAME_RUNTIME__ : {};
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

  // ?headless=1 is the render-verification harness (see the capture hook below).
  // readPixels after a composite reads an UNDEFINED drawing buffer unless it is
  // preserved, so a working playable captures as pure black — which reads as
  // "renders nothing" and is the failure this flag exists to stop faking.
  const headless = new URLSearchParams(location.search).has('headless');
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
    // Older exports predate the color-space global; treat it as optional.
    // Everything the config says an App must be BUILT with (see packagedAppOptions).
    ...packagedAppOptions(runtimeConfig),
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    // Physics + spine resolve from the inlined base64 registry (no fetch).
    sideModules: createEmbeddedSideModuleHost(typeof __SIDE_MODULES__ !== 'undefined' ? __SIDE_MODULES__ : {}),
  });
  setEditorMode(false);
  setPlayMode(true);

  // Same capture hook the cooked web host exposes, and for the same reason: a
  // playable is a single inlined file, so the only way to tell one that renders
  // from one that boots and draws nothing is to read its framebuffer.
  if (headless) {
    (window as unknown as { __estellaPlayable?: unknown }).__estellaPlayable = {
      capture(): { width: number; height: number; rgba: Uint8Array } {
        const w = canvas.width, h = canvas.height;
        const rgba = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return { width: w, height: h, rgba };
      },
    };
  }

  await initPlayableRuntime({
    app,
    module,
    canvas,
    assets: __GAME_ASSETS__,
    // Older exports predate the path map; the runtime treats it as optional.
    assetPathMap: typeof __GAME_PATHMAP__ !== 'undefined' ? __GAME_PATHMAP__ : undefined,
    scenes: __GAME_SCENES__,
    firstScene: __GAME_FIRST__,
    // Everything the config APPLIES to a live app: physics, the mixer, the theme.
    ...packagedRuntimeInit(runtimeConfig),
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[playable] boot failed', err);
});
