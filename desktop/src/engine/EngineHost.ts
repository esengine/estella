// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import {
  createWebApp,
  defineSystem,
  Schedule,
  Commands,
  Transform,
  Sprite,
  Camera,
  EditorView,
  EditorGrid,
  installEditorGrid,
  setEditorMode,
  setPlayMode,
} from 'esengine';
import type { App, ESEngineModule, ResourceDef, SubsystemStatus, SceneData } from 'esengine';
import { SceneLoader } from './SceneLoader';
import { loadEditorSpine } from './spineLoad';
import { checkEngineBuild } from './EngineGuard';
import type { ReadonlyWorldT, WorldT } from './schema';

// Scene the editor opens on boot (placeholder until a project/open-scene flow exists).
const DEFAULT_SCENE_URL = '/scenes/sprite-rendering.esscene';
const DEFAULT_TEXTURES_URL = '/scenes/sprite-rendering.textures.json';

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';

export interface EngineSnapshot {
  status: EngineStatus;
  error: string | null;
}

/**
 * The engine runtime host: owns the wasm module, the App/World, the WebGL
 * canvas, and the boot lifecycle. Everything else (reflection, mutations,
 * picking, history) is a focused module layered on top — see SceneQuery,
 * SceneCommands, ViewportController, SceneStore, EditorHistory.
 *
 * A single detached <canvas> is created once and re-parented into whichever
 * Viewport DOM node is currently mounted, keeping the WebGL context and engine
 * alive across dockview re-mounts and React StrictMode double-invokes.
 */
class EngineHostImpl {
  private canvas_: HTMLCanvasElement | null = null;
  private app_: App | null = null;
  private module_: ESEngineModule | null = null;
  private booted = false;
  private resizeObserver: ResizeObserver | null = null;

  private readonly statusStore = createStore<EngineSnapshot>(() => ({ status: 'idle', error: null }));

  // Subsystem (module) observability for the status bar: which engine modules
  // are loaded, ready, stepping, or errored. Phase changes push immediately; a
  // low-frequency sampler refreshes derived liveness (stepping↔idle) without
  // per-frame churn. The signature gate keeps the snapshot reference stable
  // (so useSyncExternalStore doesn't loop) while nothing actually changed.
  private readonly subsystemStore = createStore<SubsystemStatus[]>(() => []);
  private subsystemTimer: ReturnType<typeof setInterval> | null = null;
  private subsystemSig = '';

  // Play-state isolation: Stop rebuilds the World from the untouched edit model
  // (model-authoritative), so no snapshot is needed — the model IS the truth.
  private playing_ = false;

  // What to load once the engine is ready. Set by ProjectStore when a project
  // is opened from the launcher; absent → the in-repo placeholder scene (dev).
  private sceneBootstrap: (() => Promise<void>) | null = null;
  setSceneBootstrap(fn: (() => Promise<void>) | null) {
    this.sceneBootstrap = fn;
  }

  // — World access behind two doors (RC12 §E2) —
  // The App is private: no module can reach `app.world` and write straight to
  // the World, bypassing the command/undo layer. Reads get a read-only view;
  // the single mutable door (mutableWorld) is used only by SceneCommands
  // (undoable edits) and bulk scene load (ProjectStore / SceneLoader).

  /** Read-only view of the live World — for reflection, picking, stats. */
  get world(): ReadonlyWorldT | null {
    return this.app_?.world ?? null;
  }
  /**
   * The mutable World — the editor's single write door. Only SceneCommands and
   * bulk scene load/reset should call this; everything else reads via `world`.
   */
  mutableWorld(): WorldT | null {
    return this.app_?.world ?? null;
  }
  /** Read an app-scoped resource (e.g. Assets, CameraView). */
  getResource<T>(resource: ResourceDef<T>): T | undefined {
    return this.app_?.getResource(resource);
  }
  get module(): ESEngineModule | null {
    return this.module_;
  }
  get canvas(): HTMLCanvasElement | null {
    return this.canvas_;
  }

  // — Status as an external store (for useSyncExternalStore) —
  subscribe = (fn: () => void): (() => void) => this.statusStore.subscribe(fn);
  getSnapshot = (): EngineSnapshot => this.statusStore.getState();

  // — Subsystem (module) status as an external store —
  subscribeSubsystems = (fn: () => void): (() => void) => this.subsystemStore.subscribe(fn);
  getSubsystemsSnapshot = (): SubsystemStatus[] => this.subsystemStore.getState();

  private setStatus(status: EngineStatus, error: string | null = null) {
    this.statusStore.setState({ status, error });
    window.estella?.reportEngineStatus?.(error ? `${status}: ${error}` : status);
  }

  /**
   * Pull the current subsystem statuses into the editor-facing store. Gated by a
   * cheap signature so an unchanged sample neither swaps the snapshot reference
   * nor re-renders subscribers. Wired to both the registry's transition events
   * (immediate) and a low-frequency timer (derived liveness) in bootCore.
   */
  private syncSubsystems(app: App) {
    const statuses = app.subsystems.getStatuses();
    const sig = statuses
      .map((s) => `${s.id}:${s.phase}:${s.activity}:${s.lastError ?? ''}`)
      .join('|');
    if (sig === this.subsystemSig) return;
    this.subsystemSig = sig;
    this.subsystemStore.setState(statuses, true);
  }

  private ensureCanvas(): HTMLCanvasElement {
    if (!this.canvas_) {
      const c = document.createElement('canvas');
      c.id = 'estella-viewport-canvas';
      c.style.display = 'block';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.outline = 'none';
      this.canvas_ = c;
    }
    return this.canvas_;
  }

  /** Mount the engine canvas into a container and (lazily) boot the runtime. */
  attach(container: HTMLElement) {
    const canvas = this.ensureCanvas();
    container.appendChild(canvas);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    void this.boot();
  }

  /** Remove the canvas from its container; the engine keeps running detached. */
  detach() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas_?.parentElement?.removeChild(this.canvas_);
  }

  /**
   * Map the editor's play/pause UI state onto the engine (pure engine concern):
   * not playing ⇒ edit mode (gameplay frozen via env.playModeOnly, scene still
   * rendered/editable); playing ⇒ gameplay runs; paused-while-playing halts every
   * schedule. No-op until booted.
   *
   * Play-state isolation (rebuilding the World from the untouched edit MODEL on
   * Stop) is orchestrated by the EditorSession/surface, not here — EngineHost is
   * a pure engine host and does not know the Reconciler.
   *
   * @returns true if this was a play→edit (Stop) transition, so the caller
   *          (the session) can rebuild the World from the model.
   */
  setRunMode(isPlaying: boolean, isPaused: boolean): boolean {
    const app = this.app_;
    if (!app) return false;

    const wasStop = !isPlaying && this.playing_;
    this.playing_ = isPlaying;

    // The editor camera shows in edit mode; entering play switches the viewport
    // to the scene's game camera (the real "Game" view). Toggling `active` keeps
    // the editor view's pan/zoom intact across play→stop.
    const view = this.getResource(EditorView);
    if (view) view.active = !isPlaying;

    setPlayMode(isPlaying);
    app.setPaused(isPlaying && isPaused);
    return wasStop;
  }

  /**
   * Seed the editor camera from the scene's active camera and activate it for
   * edit mode. Called after a scene loads; navigation thereafter is independent
   * of the scene — the editor view never writes back to a scene Camera entity,
   * so panning/zooming the viewport never dirties or moves the game camera.
   */
  syncEditorViewToScene(): void {
    const view = this.getResource(EditorView);
    if (!view) return;
    const cam = this.readSceneCamera();
    if (cam) {
      view.x = cam.x;
      view.y = cam.y;
      view.orthoSize = cam.orthoSize;
    }
    view.active = !this.playing_;
  }

  /**
   * Drive the editor reference grid from the editor's Show-Flags + Snap state.
   * The renderer only paints when the EditorView is active (edit mode), so this
   * just mirrors the user's intent; play/edit gating is handled there. No-op
   * before the grid resource is installed (pre-boot).
   */
  setGrid(enabled: boolean, spacing?: number): void {
    const grid = this.getResource(EditorGrid);
    if (!grid) return;
    grid.enabled = enabled;
    if (spacing != null && spacing > 0) grid.spacing = spacing;
  }

  /** The active (or first) scene camera's center + ortho half-height, for seeding. */
  private readSceneCamera(): { x: number; y: number; orthoSize: number } | null {
    const world = this.world;
    if (!world) return null;
    let chosen: number | null = null;
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Camera) || !world.has(e, Transform)) continue;
      if (chosen == null) chosen = e;
      if ((world.get(e, Camera) as { isActive?: boolean }).isActive) {
        chosen = e;
        break;
      }
    }
    if (chosen == null) return null;
    const t = world.get(chosen, Transform);
    const c = world.get(chosen, Camera) as { orthoSize?: number };
    return { x: t.position.x, y: t.position.y, orthoSize: c.orthoSize ?? 360 };
  }

  // — Headless / automation drive —
  // The live editor lets the engine drive its own rAF loop (app.run()); a
  // headless render host or a verification/automation driver instead advances
  // frames itself, so it can capture a deterministic, reproducible frame. These
  // mediate the private App so encapsulation (the two-door world access) holds.

  /**
   * Advance the engine by exactly one frame with a fixed delta — no rAF, no
   * wall-clock. The same per-frame work app.run()'s loop does, driven manually.
   * No-op until booted. Do not mix with a running app.run() loop.
   */
  async tick(delta: number): Promise<void> {
    await this.app_?.tick(delta);
  }

  /**
   * Bulk-load a scene into the live World, resolving asset refs via the manifest
   * (same door the boot bootstrap uses). Returns the spawned entity count.
   */
  async loadScene(sceneUrl: string, manifestUrl?: string): Promise<number> {
    return this.app_ ? SceneLoader.loadInto(this.app_, sceneUrl, manifestUrl) : 0;
  }

  /**
   * Bind a scene's spine entities into the SpineManager so spine renders in the
   * viewport (the World already holds the SpineAnimation components). entityMap =
   * scene id → runtime entity; `toUrl` maps an asset ref to a fetchable URL. The
   * project transport (ProjectStore) drives this after Reconciler.adopt; the
   * dev/automation transport (SceneLoader.loadInto) calls loadEditorSpine itself.
   */
  async loadSpine(
    sceneData: SceneData,
    entityMap: Map<number, number>,
    toUrl: (ref: string) => string,
  ): Promise<void> {
    if (this.app_) await loadEditorSpine(this.app_, sceneData, entityMap, toUrl);
  }

  private resize() {
    const canvas = this.canvas_;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
    const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  private async boot() {
    if (this.booted) return;
    this.booted = true;
    this.setStatus('booting');
    try {
      const canvas = this.ensureCanvas();
      await this.bootCore(canvas, { runLoop: true, loadInitialScene: true });
    } catch (err) {
      this.swallowUnwind(err);
    }
  }

  /**
   * Boot the engine without a DOM viewport or a self-driving loop, for the
   * headless render host: a fixed-size
   * offscreen canvas, no initial scene (the driver loads one), and frames
   * advanced manually via tick() so captures are deterministic. Resolves once
   * the engine is ready; the driver then does loadScene → step → captureViewport.
   */
  async bootHeadless(size: { width: number; height: number }): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.setStatus('booting');
    try {
      const canvas = this.ensureCanvas();
      canvas.width = size.width;
      canvas.height = size.height;
      await this.bootCore(canvas, { runLoop: false, loadInitialScene: false });
    } catch (err) {
      this.swallowUnwind(err);
    }
  }

  // The shared boot sequence: instantiate the wasm, bind a WebGL2 context, build
  // the App, open in edit mode. The DOM viewport (boot) then drives the engine's
  // own rAF loop and loads an initial scene; the headless host (bootHeadless)
  // does neither — it advances frames via tick() and loads scenes on demand.
  private async bootCore(
    canvas: HTMLCanvasElement,
    opts: { runLoop: boolean; loadInitialScene: boolean },
  ) {
    // Early build-consistency check: compare the wasm's stamped manifest
    // (variant / ABI / provenance) against this SDK before the heavy
    // instantiate. Advisory only — the runtime bridge handshake is the
    // authoritative fatal layout check (reads the real binary).
    const guard = await checkEngineBuild();
    if (guard.level === 'warn') console.warn('[engine]', guard.message);
    else console.info('[engine]', guard.message);

    // The glue lives under public/. Vite's import-analysis rejects static
    // imports of public files, so build the specifier at runtime from the
    // origin — non-analyzable, so Vite emits a native dynamic import (allowed
    // by CSP script-src 'self', no eval needed).
    // NOTE: works in dev (http origin); production packaging will need a
    // custom protocol or relative base since file:// roots differently.
    const glueUrl = `${location.origin}/wasm/esengine.js`;
    const { default: createModule } = (await import(/* @vite-ignore */ glueUrl)) as {
      default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
    };

    const module = await createModule({
      canvas,
      // The glue resolves esengine.wasm relative to itself; pin it explicitly.
      locateFile: (path: string) => `/wasm/${path}`,
      print: (text: string) => console.log('[wasm]', text),
      printErr: (text: string) => console.warn('[wasm]', text),
    });
    this.module_ = module;

    // Bind the renderer to a context WE create on this canvas (rather than the
    // engine's default '#canvas' selector) so the viewport works embedded
    // under any element id. Mirrors the wechat runtime path.
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this renderer.');

    const glHandle = module.GL.registerContext(gl, {
      majorVersion: 2,
      minorVersion: 0,
      enableExtensionsByDefault: true,
    });

    const app = createWebApp(module, {
      glContextHandle: glHandle,
      getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
      // The per-version spine side modules are served next to esengine.wasm
      // (same /wasm/ dir as locateFile above), so the web spine provider can
      // load 3.8/4.1 assets in the viewport, not just the engine-linked 4.2.
      wasmBaseUrl: '/wasm',
    });
    this.app_ = app;

    // Subsystem observability: phase changes push immediately; the sampler
    // refreshes derived liveness (stepping↔idle) a couple of times a second.
    this.syncSubsystems(app);
    app.subsystems.subscribe(() => this.syncSubsystems(app));
    if (this.subsystemTimer == null) {
      this.subsystemTimer = setInterval(() => {
        if (this.app_) this.syncSubsystems(this.app_);
      }, 500);
    }

    // Mark this an editor host and open in edit mode: gameplay systems
    // (particle/animation/physics/timeline/…, gated on env.playModeOnly) are
    // frozen so simulation doesn't fight edits, while render/transform/camera
    // keep ticking. Play mode is toggled later via setRunMode.
    setEditorMode(true);
    setPlayMode(false);

    // Editor-only world-space reference grid (drawn through the editor camera,
    // occluded by scene entities). Inserts the EditorGrid resource + registers
    // the pre-scene draw pass; the UI flips enabled/spacing via setGrid(). The
    // renderer self-gates on EditorView.active, so it never draws in play mode.
    installEditorGrid(app);

    // Model-authoritative wiring (Reconciler model→World projection + SceneStore
    // reactivity) is owned by the EditorSession (constructed at app/headless
    // entry), not here — EngineHost is a pure engine host.
    // The session's wiring only subscribes the model, so it is in place
    // before this boot loads the initial scene.

    if (opts.loadInitialScene) {
      // Load the opened project's scene if the launcher set a bootstrap;
      // otherwise the in-repo placeholder scene (dev). Falls back to the
      // in-code scene on failure.
      try {
        if (this.sceneBootstrap) {
          await this.sceneBootstrap();
        } else {
          await SceneLoader.loadInto(app, DEFAULT_SCENE_URL, DEFAULT_TEXTURES_URL);
        }
      } catch (err) {
        console.warn('[engine] scene load failed; using placeholder', err);
        this.setupScene(app);
      }
      this.syncEditorViewToScene();
    }

    // Report ready before run() (the DOM path) in case the loop never resolves.
    this.setStatus('ready');
    if (opts.runLoop) {
      void Promise.resolve(app.run()).catch((err) => this.swallowUnwind(err));
    }
  }

  /** Emscripten throws 'unwind' when its main loop takes over — that's success. */
  private swallowUnwind(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err === 'unwind' || msg.includes('unwind')) {
      if (this.statusStore.getState().status !== 'ready') this.setStatus('ready');
      return;
    }
    console.error('[engine] boot failed', err);
    // Allow a later re-attach (HMR / remount) to retry with fresh code.
    this.booted = false;
    this.setStatus('error', msg);
  }

  /**
   * A small placeholder scene — a camera and a few colored quads — purely to
   * prove the render path end-to-end. Replaced by real scene loading next.
   */
  private setupScene(app: App) {
    app.addSystemToSchedule(
      Schedule.Startup,
      defineSystem([Commands()], (cmds) => {
        cmds
          .spawn()
          .insert(Camera, {
            projectionType: 1, // orthographic
            fov: 60,
            orthoSize: 360,
            nearPlane: 0.1,
            farPlane: 1000,
            aspectRatio: 1,
            isActive: true,
            priority: 0,
          })
          .insert(Transform, {
            position: { x: 0, y: 0, z: 10 },
            rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          });

        const place = (
          x: number,
          y: number,
          color: { r: number; g: number; b: number; a: number },
          size: number,
        ) =>
          cmds
            .spawn()
            .insert(Sprite, {
              texture: 0,
              color,
              size: { x: size, y: size },
              uvOffset: { x: 0, y: 0 },
              uvScale: { x: 1, y: 1 },
              layer: 0,
              flipX: false,
              flipY: false,
            })
            .insert(Transform, {
              position: { x, y, z: 0 },
              rotation: { w: 1, x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            });

        place(0, 0, { r: 0.3, g: 0.62, b: 1.0, a: 1 }, 120); // starlight blue
        place(-170, 96, { r: 1.0, g: 0.7, b: 0.33, a: 1 }, 72); // amber
        place(168, -84, { r: 0.27, g: 0.83, b: 0.62, a: 1 }, 84); // green
        place(150, 120, { r: 0.61, g: 0.42, b: 1.0, a: 1 }, 60); // violet
      }),
    );
  }
}

export const EngineHost = new EngineHostImpl();

// The engine owns a live WebGL context and a singleton runtime — HMR can't
// safely hot-patch it. Force a full reload whenever this module changes so a
// fresh context boots cleanly instead of stacking onto a stale one.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload());
}
