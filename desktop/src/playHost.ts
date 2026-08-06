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
import { createWebApp, setEditorMode, setPlayMode, initPlayRealmRuntime, getComponent, clearUserComponents, getUserComponentFingerprint, probeRegistrations, Net, MessagePortTransport, Assets, Ads, createMockAdProvider, Leaderboard, createLocalLeaderboard, registerPackagedSideModules, Input, inputEventCallbacks } from 'esengine';
import type { App, ESEngineModule, SceneData } from 'esengine';
import { PLAY_PROTOCOL_VERSION } from './engine/playProtocol';
import type { PlayOutbound, PlayInbound } from './engine/playProtocol';
import { translateAssetHandles, projectRelative } from './engine/liveAssetRefs';

type LiveEntity = SceneData['entities'][number];

// — Live inspect sampling (cheap): the Outliner only needs component TYPES (the
// kind icon), so the tree is built by reflection without decoding any component
// data; only the selected entity's data is decoded (the Details payload). This
// avoids serializing every entity's component data on every sample.
const LIVE_STRUCTURAL = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

/** Every component name this realm has an instance of — what `find` accepts, and what
 *  a mistyped one is answered with. */
function componentNamesOf(app_: App): string[] {
  return app_.world.getAllEntities()
    .flatMap((e) => app_.world.getComponentTypes(e as never))
    .filter((t, i, a) => a.indexOf(t) === i)
    .sort();
}

function inspectableTypes(world: App['world'], entity: number): string[] {
  return world.getComponentTypes(entity as never).filter((t) => {
    if (LIVE_STRUCTURAL.has(t)) return false;
    const def = getComponent(t);
    return !!def && !def.transient; // transient = per-frame state, never inspected
  });
}

function liveSnapshot(world: App['world'], selectedId: number | null, withTree: boolean): { tree: SceneData | null; selected: LiveEntity | null } {
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

  // The tree walk is O(entities) — a detail-only sample (withTree false) skips it
  // so the editor can poll the selected entity faster than the tree.
  const tree = withTree
    ? ({
        version: '1.0',
        name: 'live',
        entities: all.map((e): LiveEntity => {
          const id = e as never as number;
          // Component TYPES only — no data decode (the Outliner reads kind from types).
          return { id, name: nameOf(id), parent: parentOf.get(id) ?? null, children: childrenOf.get(id) ?? [], components: inspectableTypes(world, id).map((type) => ({ type, data: {} })) } as LiveEntity;
        }),
      } as unknown as SceneData)
    : null;

  let selected: LiveEntity | null = null;
  if (selectedId != null) {
    const raw = inspectableTypes(world, selectedId)
      .map((type) => {
        const def = getComponent(type);
        const data = def ? world.tryGet(selectedId as never, def) : null;
        return data ? { type, data: data as Record<string, unknown> } : null;
      })
      .filter((c): c is { type: string; data: Record<string, unknown> } => !!c);
    // The World stores HANDLES in asset slots; the inspector speaks REFS —
    // translate at this boundary via the realm's own Assets, so the Details
    // panel names the asset instead of flagging a live handle as "empty".
    // This realm's loads resolve to fetchable estella:// URLs; strip the
    // project origin so the editor registry can name the result.
    const assets = app?.getResource(Assets) ?? null;
    const components = translateAssetHandles(raw, (kind, handle) => {
      const p = assets?.pathForHandle(kind, handle) ?? null;
      return p === null ? null : projectRelative(p, projectBase);
    });
    selected = { id: selectedId, name: nameOf(selectedId), parent: parentOf.get(selectedId) ?? null, children: childrenOf.get(selectedId) ?? [], components } as unknown as LiveEntity;
  }
  return { tree, selected };
}

type InitMessage = Extract<PlayOutbound, { type: 'estella:play:init' }>;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const wasmBase = new URL('./wasm/', import.meta.url).href; // sibling of host.js
const bundleUrl = new URL('../cache/scripts.mjs', import.meta.url).href; // project bundle
const projectBase = new URL('../../', import.meta.url).href.replace(/\/$/, ''); // project root — assets live here

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
const post = (m: PlayInbound) => parent.postMessage(m, '*');

// Forward the running game's console output to the editor's Output Log. The realm is
// a separate JS realm, so the editor's console patch never sees these — mirror each
// call to the parent (keeping the original for the realm's own devtools). wasm
// print/printErr and the SDK logger both route through console, so this captures the
// whole game stream.
const fmtArg = (a: unknown): string => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? a.message;
  try {
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  } catch {
    return String(a);
  }
};
(() => {
  const levels = { log: 'info', info: 'info', debug: 'info', warn: 'warn', error: 'error' } as const;
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    const orig = console[m].bind(console);
    console[m] = (...args: unknown[]) => {
      orig(...args);
      try {
        post({ type: 'estella:play:log', level: levels[m], line: args.map(fmtArg).join(' ') });
      } catch {
        // Parent unavailable (realm tearing down) — the original console still ran.
      }
    };
  }
})();

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
  module.engine_setCpuProfiling?.(true);
  engineModule = module;
}

function jsonMap(json: string | undefined): Record<string, number> {
  if (!json) return {};
  try { return JSON.parse(json) as Record<string, number>; } catch { return {}; }
}

/** Build a fresh App on the (preserved) module + GL and run `msg`'s scene. The
 *  caller imports the project bundle BEFORE this, so its components/systems are
 *  already in the registry initPlayRealmRuntime drains. createWebApp's
 *  initRendererWithContext early-returns once the renderer is live, so the GL +
 *  EstellaContext are reused, not rebuilt — only the App + a fresh ECS Registry
 *  are new. */
/**
 * Tell the editor how fast the realm is actually running.
 *
 * "Playing" is not the same as "running frames": this realm is an out-of-process
 * iframe, so Chromium throttles its rAF to about once a second whenever the window is
 * not focused — and a driver that cannot see that reads the frozen result as a broken
 * feature. The engine's own frame counter is read on a timer (timers survive that
 * throttling), so the cost is one message every half second and nothing per frame.
 */
function startFrameHeartbeat(): void {
    if (heartbeat != null) return;
    let lastFrames = 0;
    let lastAt = performance.now();
    heartbeat = setInterval(() => {
        const time = app?.getResourceByName('Time') as { frameCount?: number } | undefined;
        const frames = time?.frameCount ?? 0;
        const now = performance.now();
        const seconds = (now - lastAt) / 1000;
        post({
            type: 'estella:play:frames',
            frameCount: frames,
            fps: seconds > 0 ? Math.round(((frames - lastFrames) / seconds) * 10) / 10 : 0,
        });
        lastFrames = frames;
        lastAt = now;
    }, HEARTBEAT_MS) as unknown as number;
}

const HEARTBEAT_MS = 500;
let heartbeat: number | null = null;

async function buildAppAndRun(msg: InitMessage): Promise<void> {
  const module = engineModule!;
  app = createWebApp(module, {
    renderSurface: { kind: 'gl-context', handle: glHandle },
    ySortLayers: msg.ySortLayers,
    depthLayers: msg.depthLayers,
    colorSpace: msg.colorSpace,
    screenFit: msg.screenFit,
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    wasmBaseUrl: wasmBase.replace(/\/$/, ''), // SDK appends "/<file>" — no trailing slash
  });
  setEditorMode(false);
  setPlayMode(true);

  // The editor's play realm has no ad host, but "watch an ad to revive" is a
  // flow a game has to be able to REHEARSE here — the mock keeps the real
  // pause/audio ceremony and just skips the video.
  app.getResource(Ads)?.setProvider(createMockAdProvider());

  // Same reason, harder problem: a friends leaderboard is drawn by a second JS
  // runtime that exists only on a mini-game host, so without this there is
  // nowhere to look at one until the game is on a phone. The local board runs
  // the ENGINE'S OWN renderer — the one that ships inside that runtime —
  // against an offscreen canvas and obviously-invented friends, so what you see
  // here is what will be drawn there. What it cannot stand in for is the part
  // that is genuinely the host's: real friends.
  app.getResource(Leaderboard)?.setProvider(createLocalLeaderboard());

  // Role first, runtime second: initPlayRealmRuntime ends in app.run(), and by
  // then the Net role must already be decided (see beginNet).
  const netReady = beginNet(msg);

  await initPlayRealmRuntime({
    app,
    module,
    canvas,
    sceneData: msg.sceneData,
    assetManifest: msg.assetManifest,
    // Addressable manifest → Assets.loadGroup works in the realm (remote / lazy
    // groups) just like a shipped build. Remote assets resolve same-origin
    // estella:// via assetBaseUrl, so no remoteRoot is set here.
    manifest: msg.manifest,
    // Play == ship: the entry keeps its export name and every sibling scene
    // registers lazily by path, so runtime switchTo works like a shipped build.
    entrySceneName: msg.entrySceneName,
    extraScenes: msg.extraScenes,
    // playSFX/playBGM take project-relative paths — resolve them against the project root.
    assetBaseUrl: projectBase,
    // physics.wasm is served next to esengine.wasm; load it on demand.
    wasmBaseUrl: wasmBase.replace(/\/$/, ''),
    physicsEnabled: msg.physicsEnabled,
    physicsConfig: msg.physicsConfig,
    audioConfig: msg.audioConfig,
    uiTheme: msg.uiTheme,
    uiThemeOverrides: msg.uiThemeOverrides,
    enableStats: true, // editor profiler: per-phase / per-system frame timing
  });
  // Realm-local debug handle for automation/diagnostics (mirrors the headless
  // host's __estellaHeadless): the editor can't reach into this OOPIF except by
  // main-process frame eval, and the eval needs SOMETHING to query. getComponent
  // lets a probe read component data by name (world.get needs the def).
  // `input` delivers a pointer/key event through the SAME callbacks the platform
  // binding hands raw events to, so an injected click is routed past the UI and
  // recorded exactly like a real one. Without it a driver can build input
  // handling and never test it: the realm is an out-of-process frame that
  // sendInputEvent does not reach, a synthetic MouseEvent carries no usable
  // offsetX, and poking mouseX / mouseButtonsPressed by hand skips the router.
  // What that costs is not hypothetical — a chess game was "verified" by calling
  // its own click handler directly, which is how a screen-to-world bug reached
  // the player: the one path nobody could exercise was the one that was wrong.
  const injected = inputEventCallbacks(app.getResource(Input));
  (window as unknown as { __estellaPlay?: unknown }).__estellaPlay = {
    app,
    getComponent,
    /**
     * Every entity carrying `name`, with that component's data — "what does my
     * game think is going on right now", which is the question a probe has.
     *
     * `world.get(entity, def)` needs an entity id, and there was no way to
     * obtain one: an agent verifying the game it had just built tried
     * `world.getComponentDef`, `world.entities`, then went digging in the wasm
     * module's exports, and got a wrong answer from each. Worse, `get` on an
     * entity WITHOUT the component returns a zeroed object rather than nothing,
     * so counting up from 0 does not merely fail — it lies. `tryGet` is the one
     * that answers honestly, and this is it, aimed at the whole world.
     */
    find: (name: string, limit = 200) => {
      const world = app!.world;
      const def = getComponent(name);
      // THROWN, not returned as `{ error }`: a caller that does not check reads an
      // error object as "no entities have it", which is the same shape a typo in the
      // NAME produces and the opposite of the truth.
      if (!def) {
        throw new Error(
          `no component named "${name}" is registered in this realm `
          + `(componentNames() lists them: ${componentNamesOf(app!).slice(0, 40).join(', ')})`,
        );
      }
      // An ARRAY of { entity, data }, with `total` / `truncatedAt` hung off it.
      // Every driver so far has written `find('Ball').length` and `[0]` first — the
      // reading a list invites — and spent three or four calls discovering a wrapper
      // object instead. Both readings now work: `.length`, `[0]`, `for..of` and
      // `.map` on the list itself, `.total` when what you want is the count.
      const out = [] as Array<{ entity: number; data: unknown }> & { total?: number; truncatedAt?: number };
      for (const e of world.getAllEntities()) {
        const data = world.tryGet(e, def);
        if (data === null || data === undefined) continue;
        if (out.length >= limit) { out.truncatedAt = limit; break; }
        out.push({ entity: e as never as number, data });
      }
      out.total = out.length;
      return out;
    },
    /**
     * ONE entity's component data, honestly — null when it does not have it.
     *
     * `getComponent(name)` then `world.tryGet(entity, def)` is the two-step every
     * probe was opening with, re-typed each time; a Breakout dogfood spent
     * seventy-five probes and most of them carried that preamble. It is the same
     * pair of calls, named once.
     */
    get: (entity: number, name: string) => {
      const def = getComponent(name);
      if (!def) throw new Error(`no component named "${name}" is registered in this realm`);
      // null = this entity does not have it. A mistyped NAME throws above, so the two
      // are never the same answer.
      return app!.world.tryGet(entity as never, def) ?? null;
    },
    /**
     * Write fields of one entity's component — for SETTING UP the situation you want
     * to observe (put the ball above the paddle, then step).
     *
     * Through `insert`, because the object `get` hands back is a COPY for several
     * component kinds: assigning to it changes what you are holding and nothing else,
     * which is a probe that reports success and moves nothing.
     */
    set: (entity: number, name: string, patch: Record<string, unknown>) => {
      const def = getComponent(name);
      if (!def) throw new Error(`no component named "${name}" is registered in this realm`);
      const current = app!.world.tryGet(entity as never, def);
      if (current === null || current === undefined) {
        throw new Error(`entity ${entity} has no ${name}`);
      }
      app!.world.insert(entity as never, def, { ...(current as object), ...patch } as never);
      return app!.world.tryGet(entity as never, def) ?? null;
    },
    /**
     * Advance the game exactly `frames` frames of `dt` seconds and answer with the
     * clock afterwards — the loop is wall-clock and the editor window is usually not
     * the focused one, which throttles it to about a frame a second. Two probes taken
     * a second apart therefore read identical, and a game that is running fine looks
     * frozen.
     */
    step: async (frames = 1, dt = 1 / 60) => {
      await app!.stepFrames(Math.max(1, Math.min(600, Math.floor(frames))), dt);
      const time = app!.getResourceByName('Time') as { frameCount?: number; elapsed?: number } | undefined;
      return { frames, dt, frameCount: time?.frameCount ?? 0, elapsed: time?.elapsed ?? 0 };
    },
    /** What `find` can be asked about: the component names this realm knows. */
    componentNames: () => componentNamesOf(app!),
    /**
     * A resource's live value by name — the other half of "what does the game
     * think is going on", for state that belongs to no entity (a score, a life
     * count, a phase).
     *
     * `app.getResource` takes the DEF, which a probe has no way to name, so the
     * next move was reading `app.resources_.resources_` — a private map, reached
     * by two different agents on two different days, which is how a probe surface
     * turns into a dependency on internals.
     */
    resource: (name: string) => {
      // Keyed by the def's symbol, whose description carries the name as
      // `Resource_<n>_<Name>` — the only place the name survives at runtime.
      const entries = [...(app as unknown as {
        resources_: { resources_: Map<symbol, unknown> };
      }).resources_.resources_];
      const nameOf = (k: symbol): string => (/^Resource_\d+_(.+)$/.exec(k.description ?? '')?.[1] ?? k.description ?? '');
      const hit = entries.find(([k]) => nameOf(k) === name);
      if (!hit) {
        return { error: `no resource named "${name}"`, available: entries.map(([k]) => nameOf(k)).filter(Boolean).sort() };
      }
      return hit[1];
    },
    input: {
      move: (x: number, y: number) => injected.onPointerMove?.(x, y),
      down: (x: number, y: number, button = 0) => injected.onPointerDown?.(button, x, y),
      up: (button = 0) => injected.onPointerUp?.(button),
      wheel: (dx: number, dy: number) => injected.onWheel?.(dx, dy),
      keyDown: (code: string) => injected.onKeyDown?.(code),
      keyUp: (code: string) => injected.onKeyUp?.(code),
      touchStart: (id: number, x: number, y: number) => injected.onTouchStart?.(id, x, y),
      touchMove: (id: number, x: number, y: number) => injected.onTouchMove?.(id, x, y),
      touchEnd: (id: number) => injected.onTouchEnd?.(id),
    },
  };
  startFrameHeartbeat();

  // Surface a failed handshake as a boot error rather than a silent
  // half-session (the app keeps running; the role reverted to offline).
  await netReady;
}

/**
 * Commit this realm's replication role. MUST run before the app loop starts:
 * the role gates authority systems from the very first tick (a client realm
 * that ticked as 'offline' while the handshake was in flight ran authority
 * gameplay locally and left orphan state beside the replicated ghosts). The
 * ports arrived transferred with `init`; a MessagePort queues until both ends
 * attach, so the server and client realms may boot in any order. Returns the
 * handshake completion for the caller to await before reporting ready.
 */
function beginNet(msg: InitMessage): Promise<void> {
  if (!msg.net || !app) return Promise.resolve();
  const session = app.getResource(Net);
  const ports = msg.netPorts ?? [];
  const player = msg.net.player;
  if (msg.net.role === 'server') {
    const server = session.startServer();
    for (const port of ports) server.attachConnection(new MessagePortTransport(port));
    console.log(`[play] listen server up (player ${player}, ${ports.length} client port(s))`);
    return Promise.resolve();
  }
  if (!ports[0]) return Promise.resolve();
  // connect() commits the 'client' role synchronously; the await is only the
  // handshake completing once the server realm comes up.
  return session.connect(new MessagePortTransport(ports[0])).then(() => {
    console.log(`[play] connected as player ${player}`);
  });
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Rebuild the World for a NEW scene on the ALREADY-LIVE wasm + GL — the warm
 * re-Play path (the editor keeps the realm iframe persistent across Stop, so a
 * second Play reuses this engine instead of cold-booting a fresh iframe). Same
 * teardown as {@link reload}'s full restart, but with the new payload. Reports
 * bundle/engine as 0 in the profile — only the scene+asset load is paid.
 */
async function warmRebuild(msg: InitMessage): Promise<void> {
  try {
    if (app) {
      const oldRegistry = app.world.getCppRegistry();
      app.quit({ keepRenderer: true }); // keep wasm + GL; a full quit destroys the context
      try { (oldRegistry as { delete?: () => void } | null)?.delete?.(); } catch { /* already freed */ }
      app = null;
    }
    clearUserComponents();
    try {
      await import(/* @vite-ignore */ `${bundleUrl}?v=${++reloadSeq}`); // cache-bust: pick up edited code
    } catch {
      /* no project bundle — builtin-only */
    }
    const t = performance.now();
    await buildAppAndRun(msg);
    post({ type: 'estella:play:ready', phases: { bundleImport: 0, engineInstantiate: 0, sceneAndAssets: r1(performance.now() - t) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[play] warm rebuild failed', err);
    post({ type: 'estella:play:error', message });
  }
}

/** Bring up wasm + GL WITHOUT a scene or the project bundle (idle prewarm). A
 *  later `init` then pays only the bundle and the scene — the first Play is warm
 *  too. ensureEngine is idempotent, so a later boot()/warmRebuild no-ops here. */
async function warm(): Promise<void> {
  try {
    // Deliberately NOT the project bundle — only wasm + GL, which is the part
    // worth minutes. Importing the bundle here evaluated the project's
    // registrations against a URL `boot()` must not reuse (it would then be
    // running whatever the code was when the project opened), and importing it
    // under a fresh URL there registered every system a SECOND time: eight live
    // systems against four incoming, which the hot-reload structure check reads
    // as "the structure changed" and answers with a full restart. Parsing the
    // bundle is milliseconds; instantiating wasm is not.
    await ensureEngine();
    post({ type: 'estella:play:warmed' });
  } catch (err) {
    // Prewarm is best-effort: a failure just means the first Play cold-boots.
    console.warn('[play] prewarm failed', err);
  }
}

async function boot(msg: InitMessage): Promise<void> {
  lastInit = msg;
  // The project's own native modules, staged into this realm's wasm/ alongside
  // the engine's. Registered before the App exists so a plugin acquiring during
  // build finds them — the Play-side equivalent of what the packaged game host
  // does with game.config.json.
  registerPackagedSideModules({ sideModules: msg.sideModules });
  // Warm re-Play: wasm + GL are already alive from a prior Play, so rebuild the
  // World on them — no second instantiate, no bundle re-parse. (A multiplayer
  // realm can't hot-rebuild — its net ports were consumed — so it cold-boots.)
  if (booted && engineModule && !msg.net) {
    await warmRebuild(msg);
    return;
  }
  if (booted) return;
  booted = true;
  try {
    // Sub-phase timing reported back to the editor on `ready` — the realm runs in
    // its own JS realm, so it can't write the editor's boot profiler directly.
    const tBundle = performance.now();
    // Register the project's own components/systems FIRST (side-effect import; its
    // `import 'esengine'` resolves through the import map to the shared instance).
    // Absent (a project with no scripts) → builtin-only, which is fine.
    //
    // Cache-busted like the rebuild path, and for the same reason: the prewarm
    // (`warm()`) imported this URL when the project opened, and an ES module is
    // evaluated ONCE per URL. Everything written between that moment and the
    // first Play — which, in a project being built, is all of it — was already in
    // the bundle on disk and still absent from the realm. The scene then loaded
    // referencing components nothing had registered, and the loader dropped them
    // with a per-entity warning: a board of bricks that draws perfectly and has no
    // Brick on it, every system idle, nothing failed.
    clearUserComponents();
    try {
      await import(/* @vite-ignore */ `${bundleUrl}?v=${++reloadSeq}`);
    } catch {
      /* no project bundle — builtin components/systems only */
    }
    const tEngine = performance.now();
    await ensureEngine();
    const tRuntime = performance.now();
    await buildAppAndRun(msg);
    const tEnd = performance.now();
    post({
      type: 'estella:play:ready',
      phases: {
        bundleImport: r1(tEngine - tBundle),
        engineInstantiate: r1(tRuntime - tEngine),
        sceneAndAssets: r1(tEnd - tRuntime),
      },
    });
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
/**
 * State-preserving fast path for {@link reload}. Re-imports the rebuilt bundle into a
 * throwaway context (so the live registry is untouched) and, only if the user component
 * schemas are unchanged, hot-swaps the live App's user system bodies in place — keeping
 * the running World/entities. Returns true when the World was kept; false (or on any
 * throw, caught here) means the caller must do the full restart. Component identity is
 * interned by name, so the re-imported systems' queries resolve to the live storage.
 */
async function tryHotSwapReload(): Promise<boolean> {
  if (!app) return false;
  // Each outcome says why: "the editor kept my state" vs "it restarted" is
  // invisible from the outside, and a swap that silently falls back reads as a
  // hot reload that lost the World.
  try {
    const liveFingerprint = getUserComponentFingerprint();
    const { fingerprint, pending } = await probeRegistrations(() =>
      import(/* @vite-ignore */ `${bundleUrl}?v=${++reloadSeq}`).then(() => undefined),
    );
    if (fingerprint !== liveFingerprint) {
      console.info('[play] reload: full restart — a component schema changed');
      return false;
    }
    if (!app.hotSwapSystems(pending as Parameters<App['hotSwapSystems']>[0])) {
      console.info('[play] reload: full restart — the system structure changed');
      return false;
    }
    console.info('[play] reload: hot-swapped system bodies in place (World kept)');
    return true;
  } catch (e) {
    console.info(`[play] reload: full restart — probe failed: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

async function reload(): Promise<void> {
  if (!booted || !engineModule || !lastInit) return;
  // A multiplayer session can't hot-rebuild one realm: its MessageChannel ports
  // were consumed by the live NetSession. The editor restarts the whole session
  // instead; this guard is defense against a stray reload message.
  if (lastInit.net) {
    console.warn('[play] code reload in a multiplayer session needs a session restart');
    return;
  }
  try {
    // Fast path (RC10 P3): if only system logic changed (component schemas unchanged),
    // hot-swap the function bodies and keep the live World — runtime state survives. Any
    // structural change, a component-field edit, or a probe failure falls through to the
    // full restart below (which replays the play-start snapshot, always correct).
    if (app && (await tryHotSwapReload())) {
      post({ type: 'estella:play:ready' });
      return;
    }
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
  const data = e.data as PlayOutbound | null;
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'estella:play:init':
      void boot(e.data as InitMessage);
      break;
    case 'estella:play:warm':
      void warm();
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
        const reply = app ? liveSnapshot(app.world, data.selectedId ?? null, data.withTree !== false) : null;
        post({ type: 'estella:play:reply', reqId: data.reqId, data: reply });
      } else if (data.kind === 'stats') {
        // Per-phase + per-system timing + render counters — the running game's
        // engine segment for the editor profiler (PerfMonitor, realm 'play').
        const phases = app ? Object.fromEntries(app.getPhaseTimings() ?? []) : {};
        const systems = app ? Object.fromEntries(app.getSystemTimings() ?? []) : {};
        const jsScopes = app ? Object.fromEntries(app.getFrameScopes() ?? []) : {};
        const m = engineModule;
        post({
          type: 'estella:play:reply',
          reqId: data.reqId,
          data: {
            phases,
            systems,
            drawCalls: m?.renderer_getDrawCalls?.() ?? 0,
            triangles: m?.renderer_getTriangles?.() ?? 0,
            sprites: m?.renderer_getSprites?.() ?? 0,
            entities: app?.world.getAllEntities().length ?? 0,
            gpuMs: m?.renderer_getGpuTimeMs?.() ?? -1,
            cppScopes: jsonMap(m?.engine_getCpuScopes?.()),
            cppCounters: jsonMap(m?.engine_getCounters?.()),
            gpuScopes: jsonMap(m?.engine_getGpuScopes?.()),
            jsScopes,
            wasmBytes: m?.HEAPU8?.byteLength ?? 0,
            vramBytes: m?.renderer_getTextureBytes?.() ?? 0,
          },
        });
      } else if (data.kind === 'subsystems') {
        // The running game's module health (for the editor's Modules indicator).
        post({ type: 'estella:play:reply', reqId: data.reqId, data: app ? app.subsystems.getStatuses() : [] });
      } else if (data.kind === 'step') {
        // Deterministic advance — see __estellaPlay.step. The reply carries the clock
        // so a caller can tell the frames actually ran from a request that no-oped.
        const { reqId } = data;
        void (async () => {
          if (!app) {
            post({ type: 'estella:play:reply', reqId, data: null });
            return;
          }
          const frames = Math.max(1, Math.min(600, Math.floor(data.frames ?? 1)));
          const dt = data.dt ?? 1 / 60;
          await app.stepFrames(frames, dt);
          const time = app.getResourceByName('Time') as { frameCount?: number; elapsed?: number } | undefined;
          post({
            type: 'estella:play:reply',
            reqId,
            data: { frames, dt, frameCount: time?.frameCount ?? 0, elapsed: time?.elapsed ?? 0 },
          });
        })();
      }
      break;
    case 'estella:play:setField':
      if (data.entityId != null && data.comp && data.key) setField(data.entityId, data.comp, data.key, data.value);
      break;
  }
});

post({ type: 'estella:play:hello', protocolVersion: PLAY_PROTOCOL_VERSION });
