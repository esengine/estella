// SPDX-License-Identifier: Apache-2.0
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
  EditorView, editorViewHalfHeight, setEditorViewHalfHeight,
  EditorGrid,
  installEditorGrid,
  setEditorMode,
  setPlayMode,
} from 'esengine';
import type { App, ResourceDef, SubsystemStatus, SceneData, RenderSurfaceSource } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
import { SpinePlugin } from 'esengine/spine';
import type { SpineManager } from 'esengine/spine';
import { SceneLoader } from './SceneLoader';
import { useSettings } from '@/store/settingsStore';
import { loadEditorSpine } from './spineLoad';
import { loadEditorDragonBones, editorDragonBonesManager } from './dragonBonesLoad';
import type { DragonBonesManager } from 'esengine/dragonbones';
import { checkEngineBuild } from './EngineGuard';
import { bootProfiler } from './bootProfiler';
import { PROJECT_MANIFEST_FILE } from '@/project/format';
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
  private targetFps_ = 0;
  private booted = false;
  /** The GPU backend the viewport actually booted with (after availability fallback). */
  activeBackend: 'webgl2' | 'webgpu' = 'webgl2';
  /** The color space the engine booted with (Project Settings → Rendering; boot-fixed). */
  activeColorSpace: 'gamma' | 'linear' = 'gamma';
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
  /** The edit realm's App, for whole-app diagnostics (the resource census). */
  get app(): App | null {
    return this.app_;
  }
  /** Cap the edit-realm engine loop (0 = uncapped). Survives reboot. */
  setTargetFrameRate(fps: number): void {
    this.targetFps_ = fps;
    this.app_?.setTargetFrameRate(fps);
  }
  /** The viewport's SpineManager (per-entity spine bindings); null until booted. */
  get spineManager(): SpineManager | null {
    return this.app_?.getPlugin(SpinePlugin)?.spineManager ?? null;
  }
  /** Animation names of a spine entity's loaded skeleton (for the inspector dropdown); empty if none. */
  spineAnimations(runtimeId: number): string[] {
    return this.app_?.getPlugin(SpinePlugin)?.spineManager?.getAnimations(runtimeId as never) ?? [];
  }
  /** Skin names of a spine entity's loaded skeleton; empty if none. */
  spineSkins(runtimeId: number): string[] {
    return this.app_?.getPlugin(SpinePlugin)?.spineManager?.getSkins(runtimeId as never) ?? [];
  }
  /** The viewport's DragonBonesManager; null until a scene has asked for one. */
  get dragonBonesManager(): DragonBonesManager | null {
    return editorDragonBonesManager(this.app_);
  }
  get module(): ESEngineModule | null {
    return this.module_;
  }
  get canvas(): HTMLCanvasElement | null {
    return this.canvas_;
  }

  /** The engine's last-frame telemetry for the profiler; null until booted. */
  readEngineFrame(): {
    phaseMs: Record<string, number>;
    systemMs: Record<string, number>;
    drawCalls: number;
    triangles: number;
    sprites: number;
    entities: number;
    gpuMs: number;
    cppScopes: Record<string, number>;
    cppCounters: Record<string, number>;
    gpuScopes: Record<string, number>;
    jsScopes: Record<string, number>;
    wasmBytes: number;
    vramBytes: number;
  } | null {
    const app = this.app_;
    if (!app) return null;
    const m = this.module_;
    const phases = app.getPhaseTimings();
    const systems = app.getSystemTimings();
    const jsScopes = app.getFrameScopes();
    let cppScopes: Record<string, number> = {};
    const scopesJson = m?.engine_getCpuScopes?.();
    if (scopesJson) {
      try { cppScopes = JSON.parse(scopesJson) as Record<string, number>; } catch { /* ignore */ }
    }
    let cppCounters: Record<string, number> = {};
    const countersJson = m?.engine_getCounters?.();
    if (countersJson) {
      try { cppCounters = JSON.parse(countersJson) as Record<string, number>; } catch { /* ignore */ }
    }
    let gpuScopes: Record<string, number> = {};
    const gpuJson = m?.engine_getGpuScopes?.();
    if (gpuJson) {
      try { gpuScopes = JSON.parse(gpuJson) as Record<string, number>; } catch { /* ignore */ }
    }
    return {
      phaseMs: phases ? Object.fromEntries(phases) : {},
      systemMs: systems ? Object.fromEntries(systems) : {},
      drawCalls: m?.renderer_getDrawCalls?.() ?? 0,
      triangles: m?.renderer_getTriangles?.() ?? 0,
      sprites: m?.renderer_getSprites?.() ?? 0,
      entities: this.world?.entityCount() ?? 0,
      gpuMs: m?.renderer_getGpuTimeMs?.() ?? -1,
      cppScopes,
      cppCounters,
      gpuScopes,
      jsScopes: jsScopes ? Object.fromEntries(jsScopes) : {},
      wasmBytes: m?.HEAPU8?.byteLength ?? 0,
      vramBytes: m?.renderer_getTextureBytes?.() ?? 0,
    };
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
    this.rebindResize(container);
    void this.boot();
  }

  /**
   * Point the resize observer at `container` in its CURRENT window. The single
   * canvas rides the DOM when the viewport panel is popped out into its own OS
   * window (a same-origin move preserves the live GL context), but a ResizeObserver
   * created in the main window won't reliably fire for the popout — so re-create it
   * from the container's own window whenever the viewport changes windows.
   */
  rebindResize(container: HTMLElement) {
    this.resizeObserver?.disconnect();
    const RO = container.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    this.resizeObserver = new RO(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
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
      // The scene camera's framing, as an extent the editor view SEES — under a
      // perspective eye that is a distance, not an orthoSize.
      setEditorViewHalfHeight(view, cam.orthoSize);
    }
    view.active = !this.playing_;
  }

  /** The editor camera's current center + the world half-height it SEES, or null
   *  pre-boot. Prefab Mode saves this on enter so exit can return the user to the
   *  exact scene view they left (syncEditorViewToScene would otherwise reframe).
   *  The seen extent rather than the raw field, so a view saved in perspective and
   *  restored in either projection comes back to the same framing. */
  editorViewState(): { x: number; y: number; orthoSize: number } | null {
    const view = this.getResource(EditorView);
    return view ? { x: view.x, y: view.y, orthoSize: editorViewHalfHeight(view) } : null;
  }

  /** Restore the editor camera to a saved center + zoom (the inverse read of
   *  {@link editorViewState}). No-op pre-boot. */
  setEditorView(v: { x: number; y: number; orthoSize: number }): void {
    const view = this.getResource(EditorView);
    if (!view) return;
    view.x = v.x;
    view.y = v.y;
    setEditorViewHalfHeight(view, v.orthoSize);
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

  /**
   * The aspect the editor lays UI out against — a selected device preset's aspect, or 0
   * for the design resolution (WYSIWYG). Drives uiLayoutRect via EditorView so a simulated
   * device previews how the UI adapts. No-op pre-boot (the resource installs at plugin build).
   */
  setUiPreviewAspect(aspect: number): void {
    const view = this.getResource(EditorView);
    if (view) view.uiPreviewAspect = aspect;
  }

  /**
   * Whether the editor's own eye is a perspective one — the only way to look at
   * 2.5D content while authoring it. Editor-only and never serialized, like the
   * rest of EditorView; the shipped game sees its own scene camera. No-op
   * pre-boot, and re-applied on each boot since a fresh EditorView defaults off.
   */
  setViewPerspective(on: boolean): void {
    const view = this.getResource(EditorView);
    if (!view || view.perspective === on) return;
    // Switching projection keeps the FRAMING: the two modes zoom with different
    // fields (a box half-height, a camera distance), so flipping the flag alone
    // jumped to whatever the other field happened to hold — the scene lurched
    // ~2× on a button that is supposed to change how depth looks, not what you
    // are looking at. Carry the seen extent across; one formula owns both.
    const seen = editorViewHalfHeight(view);
    view.perspective = on;
    setEditorViewHalfHeight(view, seen);
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
    resolvePath?: (ref: string) => string,
  ): Promise<void> {
    if (this.app_) await loadEditorSpine(this.app_, sceneData, entityMap, toUrl, resolvePath);
  }

  /** The DragonBones counterpart of {@link loadSpine}, over the same transport. */
  async loadDragonBones(
    sceneData: SceneData,
    entityMap: Map<number, number>,
    toUrl: (ref: string) => string,
    resolvePath?: (ref: string) => string,
  ): Promise<void> {
    if (this.app_) await loadEditorDragonBones(this.app_, sceneData, entityMap, toUrl, resolvePath);
  }

  private resize() {
    const canvas = this.canvas_;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    // Measure the canvas' own layout box rather than `clientWidth * dpr`: UI zoom
    // makes the dpr fractional, and scaling an already-rounded integer CSS width
    // lands up to a pixel off what the compositor paints — enough to resample the
    // whole viewport, which is exactly the sharpness the zoom exists to preserve.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  private async boot() {
    if (this.booted) return;
    this.booted = true;
    this.setStatus('booting');
    try {
      const canvas = this.ensureCanvas();
      const backend = await this.resolveBackend();
      const colorSpace = await this.resolveColorSpace();
      await this.bootCore(canvas, { runLoop: true, loadInitialScene: true, backend, colorSpace });
    } catch (err) {
      this.swallowUnwind(err);
    }
  }

  /**
   * The project's declared color space (Project Settings → Rendering), read
   * straight from the manifest: shaders compile against it, so it must be known
   * before bootCore — and EngineHost cannot import ProjectStore (which imports
   * EngineHost). No project / unreadable manifest ⇒ the default gamma pipeline.
   */
  private async resolveColorSpace(): Promise<'gamma' | 'linear'> {
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as {
        features?: { rendering?: { colorSpace?: unknown } };
      };
      return raw.features?.rendering?.colorSpace === 'linear' ? 'linear' : 'gamma';
    } catch {
      return 'gamma';
    }
  }

  /**
   * The viewport's GPU backend: the persisted `renderer.backend` setting, with a
   * safe fall back to WebGL2 when WebGPU is requested but unavailable (no
   * `navigator.gpu`, or no adapter). Probed BEFORE the canvas is touched — a
   * canvas cannot switch context types once one is acquired.
   */
  private async resolveBackend(): Promise<'webgl2' | 'webgpu'> {
    const requested = useSettings.getState().getValue<string>('renderer.backend');
    if (requested !== 'webgpu') return 'webgl2';
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) {
      console.warn('[engine] WebGPU requested, but navigator.gpu is unavailable — using WebGL2.');
      return 'webgl2';
    }
    try {
      if (await gpu.requestAdapter()) return 'webgpu';
      console.warn('[engine] WebGPU requested, but no adapter is available — using WebGL2.');
    } catch (e) {
      console.warn('[engine] WebGPU adapter probe failed — using WebGL2.', e);
    }
    return 'webgl2';
  }

  /**
   * Boot the engine without a DOM viewport or a self-driving loop, for the
   * headless render host: a fixed-size
   * offscreen canvas, no initial scene (the driver loads one), and frames
   * advanced manually via tick() so captures are deterministic. Resolves once
   * the engine is ready; the driver then does loadScene → step → captureViewport.
   */
  async bootHeadless(size: {
    width: number;
    height: number;
    backend?: 'webgl2' | 'webgpu';
    colorSpace?: 'gamma' | 'linear';
    depthLayers?: number;
    randomSeed?: number;
  }): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.setStatus('booting');
    try {
      const canvas = this.ensureCanvas();
      canvas.width = size.width;
      canvas.height = size.height;
      await this.bootCore(canvas, {
        runLoop: false,
        loadInitialScene: false,
        backend: size.backend,
        colorSpace: size.colorSpace,
        depthLayers: size.depthLayers,
        randomSeed: size.randomSeed,
      });
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
    opts: {
      runLoop: boolean; loadInitialScene: boolean;
      backend?: 'webgl2' | 'webgpu'; colorSpace?: 'gamma' | 'linear';
      depthLayers?: number; randomSeed?: number;
    },
  ) {
    const backend = opts.backend ?? 'webgl2';
    this.activeBackend = backend;
    this.activeColorSpace = opts.colorSpace ?? 'gamma';
    console.info(`[engine] backend: ${backend}, colorSpace: ${this.activeColorSpace}`);
    bootProfiler.begin(`engine boot (${backend})`);
    // Early build-consistency check: compare the wasm's stamped manifest
    // (variant / ABI / provenance) against this SDK before the heavy
    // instantiate. Advisory only — the runtime bridge handshake is the
    // authoritative fatal layout check (reads the real binary).
    const guard = await bootProfiler.phase('checkBuild', () => checkEngineBuild());
    if (guard.level === 'warn') console.warn('[engine]', guard.message);
    else console.info('[engine]', guard.message);

    // The glue lives under public/. Vite's import-analysis rejects static
    // imports of public files, so build the specifier at runtime from the
    // origin — non-analyzable, so Vite emits a native dynamic import (allowed
    // by CSP script-src 'self', no eval needed).
    // NOTE: works in dev (http origin); production packaging will need a
    // custom protocol or relative base since file:// roots differently.
    const glueUrl = `${location.origin}/wasm/esengine.js`;
    const { default: createModule } = await bootProfiler.phase('importGlue', () => import(/* @vite-ignore */ glueUrl)) as {
      default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
    };

    const moduleArg: Record<string, unknown> = {
      canvas,
      // The glue resolves esengine.wasm relative to itself; pin it explicitly.
      locateFile: (path: string) => `/wasm/${path}`,
      print: (text: string) => console.log('[wasm]', text),
      printErr: (text: string) => console.warn('[wasm]', text),
    };
    if (backend === 'webgpu') {
      // The device must exist BEFORE the module instantiates — the wasm side
      // reads it synchronously (Module.preinitializedWebGPUDevice).
      const gpu = (navigator as unknown as {
        gpu?: {
          requestAdapter(): Promise<{
            features?: { has(name: string): boolean };
            requestDevice(descriptor?: { requiredFeatures?: string[] }): Promise<unknown>;
          } | null>;
        };
      }).gpu;
      if (!gpu) throw new Error('WebGPU is not available in this renderer.');
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter available.');
      // Opt into timestamp-query when the adapter supports it, so the engine's GPU
      // timer can populate gpuMs/gpuScopes (matches the GL timer-query path). Absent
      // it, the WebGPU backend reports no GPU timing — same as before.
      const hasTimestamp = adapter.features?.has('timestamp-query') ?? false;
      const requiredFeatures = hasTimestamp ? ['timestamp-query'] : [];
      console.info(`[engine] webgpu timestamp-query: ${hasTimestamp ? 'enabled (GPU timing on)' : 'unavailable (no GPU timing)'}`);
      moduleArg.preinitializedWebGPUDevice = await adapter.requestDevice(
        requiredFeatures.length ? { requiredFeatures } : undefined);
      // Surface Dawn validation failures: without a listener an invalid draw is
      // silently dropped — a black pass with no trace (exactly how the WGSL
      // bloom-chain regression hid). console.error passes the shot/verify
      // console filters, so headless runs carry the evidence.
      (moduleArg.preinitializedWebGPUDevice as {
        addEventListener?: (t: string, cb: (e: { error?: { message?: string } }) => void) => void;
      }).addEventListener?.('uncapturederror', (e) => {
        console.error('[webgpu] uncaptured error:', e.error?.message ?? e);
      });
      // The swapchain glue resolves the canvas by document.querySelector, so
      // it must be connected (the headless host never attaches it to a view).
      // Pin it at the page origin at its backing size: a hidden window never
      // presents for drawImage readback, so the WebGPU verify captures the
      // PAGE (capturePage forces a composite) and needs pixel-exact placement.
      if (!canvas.isConnected) {
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        document.body.appendChild(canvas);
      }
    }
    const module = await bootProfiler.phase('createModule (wasm instantiate)', () => createModule(moduleArg));
    this.module_ = module;

    // WebGL2: bind the renderer to a context WE create on this canvas (rather
    // than the engine's default '#canvas' selector) so the viewport works
    // embedded under any element id. Mirrors the wechat runtime path. WebGPU
    // instead hands the engine the whole canvas swapchain via the injected
    // device ('#canvas' resolves to the moduleArg canvas).
    let glHandle: number | undefined;
    if (backend === 'webgl2') {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: true,
        stencil: true,
        premultipliedAlpha: false,
        // The editor must be able to READ BACK what it drew — `captureViewport`
        // (screenshots, visual verification, the MCP automation surface) does a
        // `readPixels` on the default framebuffer from a task of its own. Without
        // this the browser is free to discard the drawing buffer as soon as it
        // has composited, so every readback that isn't in the same task as the
        // draw comes back BLACK — which is exactly what happened in the live
        // editor while the headless host (no rAF loop, nothing composites) kept
        // working. This is the editor's own context, created here rather than by
        // the engine, so the cost lands on the editor alone and no shipping
        // build pays for it.
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null;
      if (!gl) throw new Error('WebGL2 is not available in this renderer.');

      glHandle = module.GL.registerContext(gl, {
        majorVersion: 2,
        minorVersion: 0,
        enableExtensionsByDefault: true,
      });
    }

    // WebGPU hands the engine the whole canvas swapchain via the injected device
    // (canvas resolved by selector); WebGL2 binds the context we registered above.
    const renderSurface: RenderSurfaceSource = backend === 'webgpu'
      ? { kind: 'webgpu', canvasSelector: `#${canvas.id}` }
      : { kind: 'gl-context', handle: glHandle! };
    const app = await bootProfiler.phase('createWebApp', () => createWebApp(module, {
      renderSurface,
      colorSpace: opts.colorSpace,
      randomSeed: opts.randomSeed,
      depthLayers: opts.depthLayers,
      getViewportSize: () => ({ width: canvas.width, height: canvas.height }),
      // The per-version spine side modules are served next to esengine.wasm
      // (same /wasm/ dir as locateFile above), so the web spine provider can
      // load 3.8/4.1 assets in the viewport, not just the engine-linked 4.2.
      wasmBaseUrl: '/wasm',
    }));
    this.app_ = app;
    if (this.targetFps_ > 0) app.setTargetFrameRate(this.targetFps_);

    app.enableStats();
    module.engine_setCpuProfiling?.(true);

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
    // Emit the boot timing table now that the overlay is about to clear — the
    // sceneBootstrap above recorded its own sub-phases (asset scan, preload, …).
    bootProfiler.report();
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
