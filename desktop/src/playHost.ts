// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playHost.ts — the isolated play realm's host module.
 *        Unlike the Vite `play.ts` (which bundles its own
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
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime, getComponent, clearUserComponents } from 'esengine';
import type { App, ESEngineModule, SceneData, PhysicsPluginConfig } from 'esengine';

type LiveEntity = SceneData['entities'][number];

// — Live inspect sampling (cheap): the Outliner only needs component TYPES (the
// kind icon), so the tree is built by reflection without decoding any component
// data; only the selected entity's data is decoded (the Details payload). This
// avoids serializing every entity's component data on every sample.
const LIVE_STRUCTURAL = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

function inspectableTypes(world: App['world'], entity: number): string[] {
  return world.getComponentTypes(entity as never).filter((t) => {
    if (LIVE_STRUCTURAL.has(t)) return false;
    const def = getComponent(t);
    return !!def && !def.transient; // transient = per-frame state, never inspected
  });
}

function liveSnapshot(world: App['world'], selectedId: number | null): { tree: SceneData; selected: LiveEntity | null } {
  const nameDef = getComponent('Name');
  const parentDef = getComponent('Parent');
  const all = world.getAllEntities();

  const parentOf = new Map<number, number>();
  if (parentDef) {
    for (const e of all) {
      const p = world.tryGet(e, parentDef) as { entity?: number } | null;
      if (p && p.entity !== undefined) parentOf.set(e as never as number, p.entity);
    }
  }
  const childrenOf = new Map<number, number[]>();
  for (const [child, parent] of parentOf) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);

  const nameOf = (e: number): string =>
    (nameDef ? (world.tryGet(e as never, nameDef) as { value?: string } | null)?.value : undefined) ?? `Entity_${e}`;

  const tree = {
    version: '1.0',
    name: 'live',
    entities: all.map((e): LiveEntity => {
      const id = e as never as number;
      // Component TYPES only — no data decode (the Outliner reads kind from types).
      return { id, name: nameOf(id), parent: parentOf.get(id) ?? null, children: childrenOf.get(id) ?? [], components: inspectableTypes(world, id).map((type) => ({ type, data: {} })) } as LiveEntity;
    }),
  } as unknown as SceneData;

  let selected: LiveEntity | null = null;
  if (selectedId != null) {
    const components = inspectableTypes(world, selectedId)
      .map((type) => {
        const def = getComponent(type);
        const data = def ? world.tryGet(selectedId as never, def) : null;
        return data ? { type, data: data as Record<string, unknown> } : null;
      })
      .filter((c): c is { type: string; data: Record<string, unknown> } => !!c);
    selected = { id: selectedId, name: nameOf(selectedId), parent: parentOf.get(selectedId) ?? null, children: childrenOf.get(selectedId) ?? [], components } as unknown as LiveEntity;
  }
  return { tree, selected };
}

interface InitMessage {
  type: 'estella:play:init';
  sceneData: SceneData;
  assetManifest: Record<string, string>;
  physicsEnabled?: boolean;
  physicsConfig?: PhysicsPluginConfig;
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
let engineModule: ESEngineModule | null = null;
let glHandle = 0;
/** The init snapshot of the current play session, replayed on hot-reload: a code
 *  edit restarts the level from where Play began (CODE reloads; the scene is the
 *  play-start snapshot, not a fresh editor scene). */
let lastInit: InitMessage | null = null;
let booted = false;
let reloadSeq = 0;
const post = (m: Record<string, unknown>) => parent.postMessage(m, '*');

/** Create the wasm module + GL context ONCE; both persist across hot-reloads —
 *  re-instantiating wasm and re-creating GL is the expensive part a reload skips. */
async function ensureEngine(): Promise<void> {
  if (engineModule) return;
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
  glHandle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });
  engineModule = module;
}

/** Build a fresh App on the (preserved) module + GL and run `msg`'s scene. The
 *  caller imports the project bundle BEFORE this, so its components/systems are
 *  already in the registry initPlayRealmRuntime drains. createWebApp's
 *  initRendererWithContext early-returns once the renderer is live, so the GL +
 *  EstellaContext are reused, not rebuilt — only the App + a fresh ECS Registry
 *  are new. */
async function buildAppAndRun(msg: InitMessage): Promise<void> {
  const module = engineModule!;
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
    physicsConfig: msg.physicsConfig,
    enableStats: true, // editor profiler: per-phase / per-system frame timing
  });
}

async function boot(msg: InitMessage): Promise<void> {
  if (booted) return;
  booted = true;
  lastInit = msg;
  try {
    // Register the project's own components/systems FIRST (side-effect import; its
    // `import 'esengine'` resolves through the import map to the shared instance).
    // Absent (a project with no scripts) → builtin-only, which is fine.
    try {
      await import(/* @vite-ignore */ bundleUrl);
    } catch {
      /* no project bundle — builtin components/systems only */
    }
    await ensureEngine();
    await buildAppAndRun(msg);
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

/**
 * Hot-reload the project's code in place — no wasm re-instantiation, no GL rebuild.
 * Tears the App down keeping the renderer alive (`quit({keepRenderer})` — a full
 * quit destroys the WebGL context), frees the old C++ Registry (disconnect only
 * drops the JS ref), clears the per-context user components so a component-schema
 * edit re-registers fresh (builtins are global and untouched), re-imports the
 * rebuilt bundle (cache-busted), then rebuilds the App from the play-start
 * snapshot. ~100ms vs a full realm reboot.
 */
async function reload(): Promise<void> {
  if (!booted || !engineModule || !lastInit) return;
  try {
    if (app) {
      const oldRegistry = app.world.getCppRegistry();
      app.quit({ keepRenderer: true });
      // Free the wasm Registry so each reload doesn't leak one onto the heap.
      try { (oldRegistry as { delete?: () => void } | null)?.delete?.(); } catch { /* already freed */ }
      app = null;
    }
    clearUserComponents();
    try {
      await import(/* @vite-ignore */ `${bundleUrl}?v=${++reloadSeq}`);
    } catch {
      /* no project bundle — builtin-only */
    }
    await buildAppAndRun(lastInit);
    post({ type: 'estella:play:ready' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[play] reload failed', err);
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
    case 'estella:play:reload':
      void reload();
      break;
    case 'estella:play:query':
      // Live introspection for the editor's "Game" inspect mode (the Details panel).
      if (data.kind === 'snapshot') {
        const reply = app ? liveSnapshot(app.world, data.selectedId ?? null) : null;
        post({ type: 'estella:play:reply', reqId: data.reqId, data: reply });
      } else if (data.kind === 'stats') {
        // Per-phase + per-system frame timing for the editor profiler panel.
        const phases = app ? Object.fromEntries(app.getPhaseTimings() ?? []) : {};
        const systems = app ? Object.fromEntries(app.getSystemTimings() ?? []) : {};
        post({ type: 'estella:play:reply', reqId: data.reqId, data: { phases, systems } });
      } else if (data.kind === 'subsystems') {
        // The running game's module health (for the editor's Modules indicator).
        post({ type: 'estella:play:reply', reqId: data.reqId, data: app ? app.subsystems.getStatuses() : [] });
      }
      break;
    case 'estella:play:setField':
      if (data.entityId != null && data.comp && data.key) setField(data.entityId, data.comp, data.key, data.value);
      break;
  }
});

post({ type: 'estella:play:hello' });
