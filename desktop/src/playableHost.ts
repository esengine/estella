// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { createWebApp, setEditorMode, setPlayMode, initPlayableRuntime } from 'esengine';
import type { ESEngineModule as EngineModule, SceneData } from 'esengine';

// The SINGLE_FILE glue exposes this global (MODULARIZE + EXPORT_ES6=0 → IIFE),
// wasm embedded, so no locateFile / instantiateWasm wiring is needed here.
declare const ESEngineModule: (opts?: Record<string, unknown>) => Promise<EngineModule>;
// Inlined by exportPlayable as <script> globals (kept out of the bundle so the
// large base64 asset blob isn't re-parsed as code).
declare const __GAME_ASSETS__: Record<string, string>;
declare const __GAME_SCENES__: Array<{ name: string; data: SceneData }>;
declare const __GAME_FIRST__: string;

async function boot(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  const module = await ESEngineModule({ canvas });

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
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
  });
  setEditorMode(false);
  setPlayMode(true);

  await initPlayableRuntime({
    app,
    module,
    canvas,
    assets: __GAME_ASSETS__,
    scenes: __GAME_SCENES__,
    firstScene: __GAME_FIRST__,
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[playable] boot failed', err);
});
