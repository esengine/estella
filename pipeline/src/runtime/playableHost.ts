// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playableHost.ts — the exported playable ad's host (single-HTML build).
 *        esbuilt to an IIFE by exportPlayable with esengine + the project scripts
 *        INLINED. The engine is the shipped WEB glue, handed over as the inline
 *        `__ENGINE_GLUE__` global and evaluated as a blob module (it is ESM), with
 *        the wasm arriving in `__ENGINE_WASM__`; assets + scenes are inlined
 *        globals too. Both engine payloads are deflate+base64 — see PackedBytes in
 *        exportPlayable, and inflate.ts for why the decoder is ours rather than
 *        the platform's. Boots the SAME shipping runtime via initPlayableRuntime
 *        (play == ship). Nothing is fetched — the whole game is one self-contained
 *        .html (ad-network ready).
 */
import {
  createWebApp, setEditorMode, setPlayMode, initPlayableRuntime, createEmbeddedSideModuleHost,
  packagedAppOptions, packagedRuntimeInit, glContextAttributes,
} from 'esengine';
import type { SceneData, EmbeddedSideModuleRegistry, EmbeddedSideModuleEntry } from 'esengine';
import type { ESEngineModule as EngineModule } from 'esengine/wasm';
import type { PackagedRuntimeFields } from '../project/runtimeConfig';
import { inflateRaw } from './inflate';
import { attachSplash } from '../export/splash';

type EngineFactory = (opts?: Record<string, unknown>) => Promise<EngineModule>;
// Inlined by exportPlayable as <script> globals (kept out of the bundle so the
// large blobs aren't re-parsed as code). __SIDE_MODULES__ holds exactly the
// optional modules the scene uses, chosen by the runtime's own gating scan.
// Each payload is raw-deflated then base64 — see PackedBytes in exportPlayable.
interface PackedBytes { z: string; n: number }
declare const __ENGINE_GLUE__: PackedBytes;
declare const __ENGINE_WASM__: PackedBytes;
declare const __SIDE_MODULES__: Record<string, { glue: PackedBytes; wasm: PackedBytes }>;
declare const __GAME_ASSETS__: Record<string, string>;
declare const __GAME_PATHMAP__: Record<string, string>;
/** The texture import settings of what is inlined, in the manifest's own shape; absent from a page with none and from older exports. */
declare const __GAME_MANIFEST__: Parameters<typeof initPlayableRuntime>[0]['manifest'];
declare const __GAME_SCENES__: Array<{ name: string; data: SceneData }>;
declare const __GAME_FIRST__: string;
/** The project's settings, in the same shape game.config.json carries them —
 *  one global, so a setting the export starts sending arrives without the host
 *  learning a new name for it. Absent fields are their defaults. */
declare const __GAME_RUNTIME__: PackagedRuntimeFields;

/** A playable's share of the bar per stage: nothing is fetched, so the four a web page spends on the network are a sliver. */
const PLAYABLE_WEIGHTS = { config: 1, scripts: 1, manifest: 1, scene: 1, engine: 8, app: 6, assets: 80, ready: 2 } as const;
/** Of the scene's stage: reading and making its assets, then compiling its shaders; what is left is the world being prepared. */
const LOAD_SHARE = 0.3, COMPILE_SHARE = 0.25;
/** The time the uncounted loading stretch takes to cover about two thirds of its share. */
const LOAD_EASE_MS = 5000;

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** One inlined payload, back to the bytes the exporter packed. */
function unpack(p: PackedBytes): Uint8Array {
  return inflateRaw(decodeBase64(p.z), p.n);
}

const unpackText = (p: PackedBytes): string => new TextDecoder().decode(unpack(p));

/**
 * The inlined side-module registry, decoded on first use.
 *
 * Lazy because the scan that chose these asks what the CONTENT could reach, not
 * what a run does: a scene that CAN spawn a Spine skeleton carries the runtime
 * either way, and basis is 1MB before deflating.
 */
function unpackSideModules(): EmbeddedSideModuleRegistry {
  if (typeof __SIDE_MODULES__ === 'undefined') return {};
  const registry: Record<string, EmbeddedSideModuleEntry> = {};
  for (const [id, packed] of Object.entries(__SIDE_MODULES__)) {
    Object.defineProperty(registry, id, {
      enumerable: true,
      configurable: true,
      get(): EmbeddedSideModuleEntry {
        const entry = { glue: unpackText(packed.glue), wasm: unpack(packed.wasm) };
        // Overwrite the getter, so acquiring a module twice inflates it once.
        Object.defineProperty(registry, id, { value: entry, enumerable: true, configurable: true });
        return entry;
      },
    });
  }
  return registry as EmbeddedSideModuleRegistry;
}

async function boot(): Promise<void> {
  // An export built before this global simply has no settings to apply.
  const runtimeConfig: PackagedRuntimeFields =
    typeof __GAME_RUNTIME__ !== 'undefined' ? __GAME_RUNTIME__ : {};
  // The page's start screen (an export from before it had one has none, and this then only announces the boot). Nothing is fetched,
  // so the stages a web build spends on the network are behind it already.
  // The bar is weighed for this page, not a web one: the engine is here already (a quarter of a second to inflate and compile on a
  // desktop), and nearly all of the wait is the scene's: its assets read and made, its shaders compiled, its world prepared.
  const splash = attachSplash(document, PLAYABLE_WEIGHTS);
  for (const stage of ['config', 'scripts', 'manifest', 'scene'] as const) splash.reach(stage);
  // The page has to paint the screen before the engine is inflated and compiled, which holds this thread.
  await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  if (!__ENGINE_GLUE__?.n || !__ENGINE_WASM__?.n) throw new Error('Engine runtime not inlined — re-export the playable.');
  // The esengine.js glue is ESM, so run it via a blob module (own scope); feed the
  // embedded wasm through instantiateWasm so nothing is fetched (single-file).
  const blobUrl = URL.createObjectURL(new Blob([unpackText(__ENGINE_GLUE__)], { type: 'text/javascript' }));
  const { default: createEngine } = (await import(/* @vite-ignore */ blobUrl)) as { default: EngineFactory };
  const wasmBytes = unpack(__ENGINE_WASM__);
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

  splash.reach('engine');

  // ?headless=1 is the render-verification harness (see the capture hook below).
  // readPixels after a composite reads an UNDEFINED drawing buffer unless it is
  // preserved, so a working playable captures as pure black — which reads as
  // "renders nothing" and is the failure this flag exists to stop faking.
  const headless = new URLSearchParams(location.search).has('headless');
  const gl = canvas.getContext('webgl2', glContextAttributes(headless)) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 is not available.');
  const glHandle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });

  const app = createWebApp(module, {
    renderSurface: { kind: 'gl-context', handle: glHandle },
    // Older exports predate the color-space global; treat it as optional.
    // Everything the config says an App must be BUILT with (see packagedAppOptions).
    ...packagedAppOptions(runtimeConfig),
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    // Physics + spine resolve from the inlined registry (no fetch). Unpacked
    // here rather than in the SDK: the transport is this page's business.
    sideModules: createEmbeddedSideModuleHost(unpackSideModules()),
  });
  setEditorMode(false);
  setPlayMode(true);
  splash.reach('app');
  splash.busy();

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

  // The scene's stage in three stretches. Loading has no count to follow (the runtime reads and makes what the scene names in one
  // call), so the bar eases toward the end of its share by the clock and never reaches it. The other two are counted: shaders
  // against the most seen compiling at once, and the world against the most its makers said was left.
  const loadStarted = performance.now();
  const loading = setInterval(() => {
    splash.within('assets', LOAD_SHARE * (1 - Math.exp(-(performance.now() - loadStarted) / LOAD_EASE_MS)));
  }, 200);
  let mostCompiling = 0, mostMaking = 0;
  const warming = (pending: number, making: number): void => {
    clearInterval(loading);
    mostCompiling = Math.max(mostCompiling, pending);
    mostMaking = Math.max(mostMaking, making);
    const compiled = mostCompiling > 0 ? 1 - pending / mostCompiling : 1;
    const made = mostMaking > 0 ? 1 - making / mostMaking : 1;
    splash.within('assets', LOAD_SHARE + COMPILE_SHARE * compiled + (1 - LOAD_SHARE - COMPILE_SHARE) * made);
    // With none left compiling the warm-up is waiting on what is still being made (a ground's pages, a field's cells).
    splash.busy(pending > 0 ? 'Compiling shaders' : 'Preparing the scene');
  };
  await initPlayableRuntime({
    app,
    module,
    canvas,
    assets: __GAME_ASSETS__,
    // Older exports predate the path map; the runtime treats it as optional.
    assetPathMap: typeof __GAME_PATHMAP__ !== 'undefined' ? __GAME_PATHMAP__ : undefined,
    manifest: typeof __GAME_MANIFEST__ !== 'undefined' ? __GAME_MANIFEST__ : undefined,
    scenes: __GAME_SCENES__,
    firstScene: __GAME_FIRST__,
    // The same condition the web host warms on: shaders compiled in the background, and the project asked to open on a complete picture.
    ...(runtimeConfig.quality?.asyncShaderCompile && runtimeConfig.quality.prewarmShaders
      ? { prewarmShaders: { timeoutMs: runtimeConfig.quality.prewarmTimeoutMs, onProgress: warming } } : {}),
    onBeforeRun: () => { clearInterval(loading); splash.reach('assets'); splash.reach('ready'); splash.done(); },
    // Everything the config APPLIES to a live app: physics, the mixer, the theme.
    ...packagedRuntimeInit(runtimeConfig),
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[playable] boot failed', err);
  // A start screen left over a boot that failed would say it is still loading.
  document.getElementById('es-splash')?.remove();
});
