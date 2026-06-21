/**
 * @file  gameHost.ts — the exported game's runtime host (REARCH_EDITOR_REALM
 *        Phase S). Bundled by exportGame (esbuild, esengine inlined) into a
 *        self-contained game.js. Boots the SAME shipping runtime the editor's
 *        play realm uses (createWebApp → initPlayRealmRuntime), but loads the
 *        scene + asset manifest from the COOKED files next to index.html — so the
 *        shipped game is what the editor played (play == ship).
 *
 *        Builtin scenes run as-is; project custom-script bundles are a follow-up
 *        (shared with the play realm's import-map work).
 */
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime } from 'esengine';
import type { ESEngineModule, SceneData } from 'esengine';

interface GameConfig {
  entryScene: string;
}
interface CookedManifest {
  entries: { uuid: string; path: string; type: string }[];
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  const cfg = (await (await fetch('./game.config.json')).json()) as GameConfig;
  const manifest = (await (await fetch('./assets.manifest.json')).json()) as CookedManifest;
  const sceneData = (await (await fetch(`./${cfg.entryScene}`)).json()) as SceneData;
  const assetManifest: Record<string, string> = {};
  for (const e of manifest.entries) assetManifest[e.uuid.toLowerCase()] = `./${e.path}`;

  const wasmBase = `${location.origin}/wasm`;
  const { default: createModule } = (await import(/* @vite-ignore */ `${wasmBase}/esengine.js`)) as {
    default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
  };
  const module = await createModule({
    canvas,
    locateFile: (p: string) => `${wasmBase}/${p}`,
    print: (t: string) => console.log(t),
    printErr: (t: string) => console.error(t),
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
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    wasmBaseUrl: wasmBase,
  });
  setEditorMode(false);
  setPlayMode(true);
  await initPlayRealmRuntime({ app, module, canvas, sceneData, assetManifest });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[game] boot failed', err);
  document.body.innerHTML = `<pre style="color:#f87171;padding:20px;font:13px monospace">${message}</pre>`;
});
