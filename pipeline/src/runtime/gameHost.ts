// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gameHost.ts — the exported game's runtime host.
 *        Bundled by exportGame (esbuild, esengine inlined) into a
 *        self-contained game.js. Boots the SAME shipping runtime the editor's
 *        play realm uses (createWebApp → initPlayRealmRuntime), but loads the
 *        scene + asset manifest from the COOKED files next to index.html — so the
 *        shipped game is what the editor played (play == ship).
 *
 *        Builtin scenes run as-is; project custom-script bundles are a follow-up
 *        (shared with the play realm's import-map work).
 */
import {
  createWebApp, setEditorMode, setPlayMode, Assets,
  indexPackagedManifest, createPackagedAssetSource, applyAssetRefResolvers, initRuntime,
  HttpBackend, fetchDecodePixels, registerPackagedSideModules,
  packagedAppOptions, packagedRuntimeInit, Transform, SceneManager, Nav, UINode,
  acquireWebGPUDevice, ThirdPersonCamera, CharacterController3D, AnimatorController,
  Animator, TPC_SPEED, TPC_GROUNDED,
} from 'esengine';
import type { SceneData, AddressableManifest, PackagedGameConfig, RenderSurfaceSource } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
async function boot(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  // Render-verification hook: with ?headless the cooked build keeps its drawing
  // buffer + exposes a framebuffer readback, so a driver can prove the SHIPPED
  // runtime actually rendered the cooked scene (the editor host can't — it uses a
  // different asset path).
  const headless = new URLSearchParams(location.search).has('headless');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  window.addEventListener('resize', resize);
  resize();

  const cfg = (await (await fetch('./game.config.json')).json()) as PackagedGameConfig;

  // The project's own components and systems. The config SAYS whether this build
  // has any, so a load failure is a failure rather than a build that turned out
  // not to have scripts — catching the difference boots an empty world.
  if (cfg.scripts) {
    const url = new URL(`./${cfg.scripts}`, import.meta.url).href;
    try {
      await import(/* @vite-ignore */ url);
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      // Logged as well as thrown: a rejected boot is observable to automation
      // through either, and only one of them survives a host that awaits this.
      console.error(`[estella] project scripts failed to load (${url})`, cause);
      throw new Error(
        `[estella] startup failed: project scripts "${cfg.scripts}" did not load — ${cause.message}`,
        { cause },
      );
    }
  }
  // Before anything acquires: the project's own modules were staged into wasm/
  // beside the engine's, and this is what makes their ids resolvable.
  registerPackagedSideModules(cfg);
  // The addressable manifest is the asset index — the same one the WeChat and
  // native runtimes read. It resolves every ref spelling to its staged path and
  // carries the atlas metadata the catalog needs, so there is one asset model
  // across every packaged realm rather than a flat map here and a manifest there.
  const index = indexPackagedManifest(
    (await (await fetch('./asset-manifest.json')).json()) as AddressableManifest,
  );
  // A named scene from the query boots instead of the entry, so a conformance
  // harness can drive a fixture scene in the real package rather than needing a
  // project of its own. Unknown names are refused rather than silently ignored.
  const wanted = new URLSearchParams(location.search).get('scene');
  const chosen = wanted
    ? (cfg.scenes ?? []).find((s) => s.name === wanted)?.path
    : cfg.entryScene;
  if (!chosen) throw new Error(`[estella] no scene named "${wanted}" in this package`);
  const sceneData = (await (await fetch(`./${chosen}`)).json()) as SceneData;

  const wasmBase = new URL('./wasm/', import.meta.url).href; // relative → mount-path agnostic
  const { default: createModule } = (await import(/* @vite-ignore */ `${wasmBase}esengine.js`)) as {
    default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
  };
  // The device has to exist before the module reads it, and the fallback IS the
  // contract. `?headless` pins WebGL2: a driver reads the frame back through the
  // GL context, which is what the capture hook below has.
  const wantsWebGPU = cfg.renderBackend === 'webgpu' && !headless;
  const gpu = await acquireWebGPUDevice(wantsWebGPU ? 'webgpu' : 'webgl2',
    (m) => console.error(m));
  if (wantsWebGPU && !gpu.device) console.warn(`[estella] WebGPU unavailable (${gpu.reason}) — using WebGL2.`);

  const module = await createModule({
    canvas,
    locateFile: (p: string) => `${wasmBase}${p}`,
    print: (t: string) => console.log(t),
    printErr: (t: string) => console.error(t),
    ...(gpu.device ? { preinitializedWebGPUDevice: gpu.device } : {}),
  });

  let gl: WebGL2RenderingContext | null = null;
  let renderSurface: RenderSurfaceSource;
  if (gpu.device) {
    canvas.id ||= 'canvas';
    renderSurface = { kind: 'webgpu', canvasSelector: `#${canvas.id}` };
  } else {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: headless,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available.');
    renderSurface = {
      kind: 'gl-context',
      handle: module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true }),
    };
  }

  const app = createWebApp(module, {
    renderSurface,
    // Everything the config says an App must be BUILT with (see packagedAppOptions).
    ...packagedAppOptions(cfg),
    getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
    wasmBaseUrl: wasmBase.replace(/\/$/, ''), // SDK appends "/<file>" — no trailing slash
  });
  setEditorMode(false);
  setPlayMode(true);

  if (headless) {
    (window as unknown as { __estellaCooked?: unknown }).__estellaCooked = {
      capture(): { width: number; height: number; rgba: Uint8Array } {
        const w = canvas.width, h = canvas.height;
        const rgba = new Uint8Array(w * h * 4);
        // `?headless` pins WebGL2 above, so this is the context that drew.
        gl!.readPixels(0, 0, w, h, gl!.RGBA, gl!.UNSIGNED_BYTE, rgba);
        return { width: w, height: h, rgba };
      },
      /**
       * How many of this build's systems run as compiled code. Zero in an
       * interpreted package, which is what tells the two apart from outside —
       * the frames they produce are meant to be identical.
       */
      compiledSystems(): number {
        return app.compiledSystemCount;
      },
      /**
       * Which systems this package is running compiled, and how many twin calls
       * have happened. Installed and dispatched are separate questions, and a
       * driver comparing positions can answer neither — the closure a twin
       * replaced moves the entity to the same place.
       */
      compiled(): { installed: readonly string[]; calls: number } {
        return app.compiledSystems;
      },

      /**
       * Where things are, for a driver that has to play rather than just look.
       * Capture answers "did it draw"; walking a route needs "am I there yet",
       * and guessing that from frame counts breaks on the first enemy in the
       * way. Named entities only, and only the names asked for.
       */
      probe(names: string[] = []): {
        scene: string | null;
        transitioning: boolean;
        at: Record<string, { x: number; y: number; z?: number; w?: number; h?: number }>;
      } {
        const at: Record<string, { x: number; y: number; z?: number; w?: number; h?: number }> = {};
        for (const name of names) {
          const entity = app.world.findEntityByName(name);
          if (entity === null || !app.world.has(entity, Transform)) continue;
          // World, not local: a driver asks where something IS, and for anything
          // parented (every UI node) the local offset answers a different question.
          const t = app.world.get(entity, Transform);
          const p = t.worldPosition ?? t.position;
          // z as well: a 3D driver asking where something is cannot be answered
          // by the plane, and a character walking a ramp moves in all three.
          at[name] = { x: p.x, y: p.y, z: p.z ?? 0 };
          // A node's own size, for a claim about a value the game COMPUTED rather
          // than about where it ended up — a spectrum bar barely moves while its
          // height carries the whole answer.
          if (app.world.has(entity, UINode)) {
            const node = app.world.get(entity, UINode);
            at[name].w = node.width?.value;
            at[name].h = node.height?.value;
          }
        }
        const scenes = app.hasResource(SceneManager) ? app.getResource(SceneManager) : null;
        // A scene arrives entity by entity, and a driver polling from outside
        // the frame loop can land in the middle of that. Half a world reads as
        // "the thing I was walking to is gone", which is a lie with a cost.
        return { scene: scenes?.getActive() ?? null, transitioning: scenes?.isTransitioning() ?? false, at };
      },
      /**
       * What a third-person character IS: where it stands, what the physics step
       * gave it, what its animator was told. Read-only, off the same components
       * the game runs on — pixels cannot say whether a ramp was climbed, and a
       * unit test answers about the request rather than the result.
       */
      gameplay(playerName: string, cameraName?: string): {
        found: boolean;
        position: { x: number; y: number; z: number } | null;
        realVelocity: { x: number; y: number; z: number } | null;
        askedVelocity: { x: number; y: number; z: number } | null;
        grounded: boolean;
        animator: { speed: number; grounded: boolean; state: string } | null;
        camera: { x: number; y: number; z: number } | null;
        cameraDistance: number | null;
      } {
        const blank = {
          found: false, position: null, realVelocity: null, askedVelocity: null,
          grounded: false, animator: null, camera: null, cameraDistance: null,
        };
        const player = app.world.findEntityByName(playerName);
        if (player === null || !app.world.has(player, Transform)) return blank;

        const t = app.world.get(player, Transform);
        const p = t.worldPosition ?? t.position;
        const position = { x: p.x, y: p.y, z: p.z ?? 0 };

        let realVelocity = null;
        let askedVelocity = null;
        let grounded = false;
        if (app.world.has(player, CharacterController3D)) {
          const c = app.world.get(player, CharacterController3D);
          realVelocity = { x: c.realVelocity.x, y: c.realVelocity.y, z: c.realVelocity.z };
          askedVelocity = { x: c.velocity.x, y: c.velocity.y, z: c.velocity.z };
          grounded = c.isOnFloor;
        }

        let animator = null;
        if (app.hasResource(AnimatorController) && app.world.has(player, Animator)) {
          const ctrl = app.getResource(AnimatorController);
          animator = {
            speed: ctrl.getFloat(player, TPC_SPEED),
            grounded: ctrl.getBool(player, TPC_GROUNDED),
            state: app.world.get(player, Animator).currentState,
          };
        }

        let camera = null;
        let cameraDistance = null;
        const eye = cameraName ? app.world.findEntityByName(cameraName)
          : (app.world.getEntitiesWithComponents([ThirdPersonCamera])[0] ?? null);
        if (eye !== null && eye !== undefined && app.world.has(eye, Transform)) {
          const ct = app.world.get(eye, Transform);
          const cp = ct.worldPosition ?? ct.position;
          camera = { x: cp.x, y: cp.y, z: cp.z ?? 0 };
          cameraDistance = Math.hypot(cp.x - position.x, cp.y - position.y,
                                      (cp.z ?? 0) - position.z);
        }

        return { found: true, position, realVelocity, askedVelocity, grounded,
                 animator, camera, cameraDistance };
      },
      /**
       * Advance the world by `frames` steps of exactly `dt`, wall clock ignored.
       *
       * What a driver measures between two probes is otherwise a function of
       * when the runner got scheduled — and two launches of ONE package disagree
       * by more than a compiled system reading the wrong field does.
       */
      async step(frames = 1, dt = 1 / 60): Promise<void> {
        await app.stepFrames(frames, dt);
      },
      /**
       * Hand the clock to the driver. `step` alone is not enough: it pauses the
       * loop only while it runs, so between two calls the world still advances by
       * whatever wall time the round trip took — which is the runner's load, not
       * the game's. Paused, the only frames are the ones a driver asks for.
       */
      setPaused(paused: boolean): void {
        app.setPaused(paused);
      },
      /**
       * A way from one named entity to another, over the same navigation grid
       * the game's own enemies walk. A driver that steers straight at its goal
       * is a driver that walks into the first wall between them; asking the
       * game means the route stays right when the level is re-authored.
       */
      pathBetween(fromName: string, toName: string): Array<{ x: number; y: number }> | null {
        if (!app.hasResource(Nav)) return null;
        const ends = [fromName, toName].map((name) => {
          const entity = app.world.findEntityByName(name);
          if (entity === null || !app.world.has(entity, Transform)) return null;
          const p = app.world.get(entity, Transform).position;
          return { x: p.x, y: p.y };
        });
        if (!ends[0] || !ends[1]) return null;
        return app.getResource(Nav).findWorldPath(ends[0], ends[1]);
      },
      /** Drive a hot update against a served (CDN) manifest: fetch + diff + apply.
       *  Rebinding the visuals is the game's job (via Assets.onInvalidate); a
       *  driver settles frames after this before re-capturing. */
      async applyRemoteUpdate(manifestUrl: string, remoteRoot?: string): Promise<{ changed: number; applied: boolean; failed: number }> {
        const assets = app.getResource(Assets);
        const plan = await assets.checkForUpdate({ manifestUrl, remoteRoot });
        const result = await assets.applyUpdate();
        return { changed: plan.changedAssets.length, applied: result.ok, failed: result.failed.length };
      },
    };
  }
  // physics.wasm sits next to esengine.wasm; the runtime loads it when a scene
  // uses physics, or when the project declared physics on for bodies it spawns
  // from script (packagedRuntimeInit carries that flag).
  // The entry scene boots eagerly (already fetched); every other shipped scene
  // registers lazily by path, so SceneManager.switchTo('name') fetches it on
  // first use — the same registration shape the WeChat runtime uses.
  const sceneList = cfg.scenes ?? [];
  const entryName = sceneList.find((s) => s.path === cfg.entryScene)?.name ?? '__play';
  // Cross-origin images taint a canvas, so a cooked build decodes through
  // fetch+blob rather than the platform's Image path.
  const source = createPackagedAssetSource(index, {
    backend: new HttpBackend({ baseUrl: '' }),
    decodePixels: (path) => fetchDecodePixels(path),
  });
  applyAssetRefResolvers(app, index.resolvePath);
  await initRuntime({
    app,
    module,
    source,
    // The compiled twins this build produced, if any. The path, not the bytes:
    // reading it is the platform seam's job, and on a mini-game only the seam
    // knows how (docs/REARCH_AOT.md §9).
    manifest: index.manifest,
    catalog: index.catalog,
    remoteRoot: cfg.hotUpdate?.remoteRoot,
    persistUpdateKey: cfg.hotUpdate?.persistUpdateKey,
    scenes: [
      { name: entryName, data: sceneData },
      ...sceneList.filter((s) => s.path !== cfg.entryScene).map((s) => ({ name: s.name, path: s.path })),
    ],
    firstScene: entryName,
    aspectRatio: canvas.width / canvas.height,
    // Everything the config APPLIES to a live app: physics, the mixer, the theme.
    ...packagedRuntimeInit(cfg),
  });
  app.run();
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err === 'unwind' || message.includes('unwind')) return; // emscripten loop took over — success
  console.error('[game] boot failed', err);
  // The game realm has no editor stylesheet — this literal mirrors --error.
  document.body.innerHTML = `<pre style="color:#d65a5a;padding:20px;font:13px monospace">${message}</pre>`;
});
