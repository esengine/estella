/**
 * @file  play.ts — the isolated play-realm host page (REARCH_EDITOR_REALM Phase R).
 *
 * Runs inside the editor's "Game" iframe as a SEPARATE realm (its own wasm + GL +
 * World). It boots the SHIPPING runtime (createWebApp → initPlayRealmRuntime) and
 * runs the scene SNAPSHOT the editor posts in — so what you play is what you ship.
 * Control + handshake go over postMessage; the realm never touches `window.estella`.
 *
 * Builtin components/systems run as-is. Project-defined components/systems (a
 * bundle with esengine external + an import map) are a layered follow-up.
 */
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime } from 'esengine';
import type { App, ESEngineModule, SceneData } from 'esengine';

interface InitMessage {
  type: 'estella:play:init';
  sceneData: SceneData;
  assetManifest: Record<string, string>;
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
}
window.addEventListener('resize', resize);
resize();

let app: App | null = null;
let booted = false;

function post(message: Record<string, unknown>): void {
  parent.postMessage(message, '*');
}

async function boot(msg: InitMessage): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    // Glue + binary load from this realm's origin (dev http / packaged app://).
    const glueUrl = `${location.origin}/wasm/esengine.js`;
    const { default: createModule } = (await import(/* @vite-ignore */ glueUrl)) as {
      default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
    };
    const module = await createModule({
      canvas,
      locateFile: (p: string) => `/wasm/${p}`,
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
    const glHandle = module.GL.registerContext(gl, {
      majorVersion: 2,
      minorVersion: 0,
      enableExtensionsByDefault: true,
    });

    app = createWebApp(module, {
      glContextHandle: glHandle,
      getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
      wasmBaseUrl: '/wasm',
    });

    // Real shipping mode — NOT editor mode. Gameplay systems run.
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
    // Emscripten throws 'unwind' when its main loop takes over — that's success.
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
  switch (data.type) {
    case 'estella:play:init':
      void boot(e.data as InitMessage);
      break;
    case 'estella:play:setPaused':
      app?.setPaused(!!data.paused);
      break;
    // 'dispose' = the editor removes the iframe; the whole realm is torn down.
  }
});

// Tell the editor the realm is mounted and ready to receive the scene snapshot.
post({ type: 'estella:play:hello' });
