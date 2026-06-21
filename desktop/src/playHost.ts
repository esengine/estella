/**
 * @file  playHost.ts — the isolated play realm's host module (REARCH_EDITOR_REALM
 *        import-map phase). Unlike the R1 Vite `play.ts` (which bundles its own
 *        esengine), this is esbuilt with **esengine EXTERNAL** and runs from the
 *        project's `estella://` origin under `.esengine/play/host.js`. A
 *        `<script type=importmap>` in play.html maps `esengine` → `./sdk/index.js`,
 *        so THIS host AND the project bundle (`../cache/scripts.mjs`, also external
 *        esengine) resolve to the SAME esengine instance — the bundle's
 *        defineComponent/defineSystem register into the registry createWebApp uses,
 *        so custom components + systems actually run (play == ship).
 *
 *        Everything is same-origin estella:// (host, sdk, bundle, wasm, assets),
 *        sidestepping the custom-scheme cross-fetch ban.
 */
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime } from 'esengine';
import type { App, ESEngineModule, SceneData } from 'esengine';

interface InitMessage {
  type: 'estella:play:init';
  sceneData: SceneData;
  assetManifest: Record<string, string>;
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const wasmBase = new URL('./wasm/', import.meta.url).href; // sibling of host.js
const bundleUrl = new URL('../cache/scripts.mjs', import.meta.url).href; // project bundle

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
}
window.addEventListener('resize', resize);
resize();

let app: App | null = null;
let booted = false;
const post = (m: Record<string, unknown>) => parent.postMessage(m, '*');

async function boot(msg: InitMessage): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    // Register the project's own components/systems FIRST (side-effect import; its
    // `import 'esengine'` resolves through the import map to the shared instance).
    // Absent (a project with no scripts) → builtin-only, which is fine.
    try {
      await import(/* @vite-ignore */ bundleUrl);
    } catch {
      /* no project bundle — builtin components/systems only */
    }

    const { default: createModule } = (await import(/* @vite-ignore */ `${wasmBase}esengine.js`)) as {
      default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
    };
    const module = await createModule({
      canvas,
      locateFile: (p: string) => `${wasmBase}${p}`,
      print: (t: string) => console.log('[wasm]', t),
      printErr: (t: string) => console.warn('[wasm]', t),
    });

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this realm.');
    const glHandle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });

    app = createWebApp(module, {
      glContextHandle: glHandle,
      getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
      wasmBaseUrl: wasmBase.replace(/\/$/, ''), // SDK appends "/<file>" — no trailing slash
    });
    setEditorMode(false);
    setPlayMode(true);

    await initPlayRealmRuntime({
      app,
      module,
      canvas,
      sceneData: msg.sceneData,
      assetManifest: msg.assetManifest,
    });
    post({ type: 'estella:play:ready' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err === 'unwind' || message.includes('unwind')) {
      post({ type: 'estella:play:ready' });
      return;
    }
    console.error('[play] boot failed', err);
    post({ type: 'estella:play:error', message });
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string; paused?: boolean } | null;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'estella:play:init') void boot(e.data as InitMessage);
  else if (data.type === 'estella:play:setPaused') app?.setPaused(!!data.paused);
});

post({ type: 'estella:play:hello' });
