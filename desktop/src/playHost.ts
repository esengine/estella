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
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime, serializeScene, getComponent } from 'esengine';
import type { App, ESEngineModule, SceneData } from 'esengine';

interface InitMessage {
  type: 'estella:play:init';
  sceneData: SceneData;
  assetManifest: Record<string, string>;
  physicsEnabled?: boolean;
  physicsGravity?: { x: number; y: number };
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
      // physics.wasm is served next to esengine.wasm; load it on demand.
      wasmBaseUrl: wasmBase.replace(/\/$/, ''),
      physicsEnabled: msg.physicsEnabled,
      physicsGravity: msg.physicsGravity,
      enableStats: true, // editor profiler: per-phase / per-system frame timing
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

/** Apply a (possibly dotted, e.g. "position.x") key to a cloned component data. */
function applyKey(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let obj = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    obj[k] = { ...(obj[k] as Record<string, unknown>) };
    obj = obj[k] as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
}

/** Live-edit one field of one entity's component in the running World (debug). */
function setField(entityId: number, comp: string, key: string, value: unknown): void {
  const world = app?.world;
  if (!world) return;
  const def = getComponent(comp);
  if (!def || !world.has(entityId, def)) return;
  const data = { ...(world.get(entityId, def) as Record<string, unknown>) };
  applyKey(data, key, value);
  world.set(entityId, def, data as never);
}

window.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string; paused?: boolean; reqId?: number; kind?: string; entityId?: number; comp?: string; key?: string; value?: unknown; selectedId?: number } | null;
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'estella:play:init':
      void boot(e.data as InitMessage);
      break;
    case 'estella:play:setPaused':
      app?.setPaused(!!data.paused);
      break;
    case 'estella:play:query':
      // Live introspection for the editor's "Game" inspect mode (UE5 PIE Details).
      if (data.kind === 'snapshot') {
        // Live inspect: send a SHALLOW tree (the Outliner only needs component
        // TYPES + name + each component's `enabled` flag — see modelKindOf/NameOf/
        // IsVisible), not every component's data for thousands of entities. The
        // selected entity's FULL data is sent alongside for the Details panel.
        const full = app ? serializeScene(app.world) : null;
        let reply: unknown = null;
        if (full) {
          const selId = data.selectedId;
          const selected = selId != null ? (full.entities.find((en) => en.id === selId) ?? null) : null;
          const tree = {
            ...full,
            entities: full.entities.map((en) => ({
              ...en,
              components: en.components.map((c) => {
                const d = c.data as Record<string, unknown> | undefined;
                return { type: c.type, data: d && 'enabled' in d ? { enabled: d.enabled } : {} };
              }),
            })),
          };
          reply = { tree, selected };
        }
        post({ type: 'estella:play:reply', reqId: data.reqId, data: reply });
      } else if (data.kind === 'stats') {
        // Per-phase + per-system frame timing for the editor profiler panel.
        const phases = app ? Object.fromEntries(app.getPhaseTimings() ?? []) : {};
        const systems = app ? Object.fromEntries(app.getSystemTimings() ?? []) : {};
        post({ type: 'estella:play:reply', reqId: data.reqId, data: { phases, systems } });
      }
      break;
    case 'estella:play:setField':
      if (data.entityId != null && data.comp && data.key) setField(data.entityId, data.comp, data.key, data.value);
      break;
  }
});

post({ type: 'estella:play:hello' });
