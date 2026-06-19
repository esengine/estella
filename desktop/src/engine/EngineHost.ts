import {
  createWebApp,
  defineSystem,
  Schedule,
  Commands,
  Transform,
  Sprite,
  Camera,
  setEditorMode,
  setPlayMode,
  serializeScene,
  resetWorldTo,
} from 'esengine';
import type { App, ESEngineModule, SceneData } from 'esengine';
import { SceneStore } from './SceneStore';
import { SceneLoader } from './SceneLoader';
import { checkEngineBuild } from './EngineGuard';

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

  private snapshot: EngineSnapshot = { status: 'idle', error: null };
  private readonly listeners = new Set<() => void>();

  // Play-state isolation: the scene captured when entering play, restored on stop.
  private playing_ = false;
  private playSnapshot_: SceneData | null = null;

  // What to load once the engine is ready. Set by ProjectStore when a project
  // is opened from the launcher; absent → the in-repo placeholder scene (dev).
  private sceneBootstrap: (() => Promise<void>) | null = null;
  setSceneBootstrap(fn: (() => Promise<void>) | null) {
    this.sceneBootstrap = fn;
  }

  // Live handles read by the layered modules.
  get app(): App | null {
    return this.app_;
  }
  get module(): ESEngineModule | null {
    return this.module_;
  }
  get canvas(): HTMLCanvasElement | null {
    return this.canvas_;
  }

  // — Status as an external store (for useSyncExternalStore) —
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): EngineSnapshot => this.snapshot;

  private setStatus(status: EngineStatus, error: string | null = null) {
    this.snapshot = { status, error };
    window.estella?.reportEngineStatus?.(error ? `${status}: ${error}` : status);
    this.listeners.forEach((l) => l());
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
   * Map the editor's play/pause UI state onto the engine, with play-state
   * isolation: entering play snapshots the scene; Stop despawns the played
   * scene and restores the snapshot, so try-playing never dirties the edit
   * scene. Not playing ⇒ edit mode (gameplay frozen via env.playModeOnly, scene
   * still rendered/editable); playing ⇒ gameplay runs; paused-while-playing
   * halts every schedule. No-op until booted.
   *
   * @returns true if a play→edit restore happened (the caller should clear any
   *          stale selection, since entity ids change on restore).
   */
  setRunMode(isPlaying: boolean, isPaused: boolean): boolean {
    const app = this.app_;
    if (!app) return false;

    let restored = false;
    if (isPlaying && !this.playing_) {
      // edit → play: capture the scene so Stop can restore it.
      this.playSnapshot_ = serializeScene(app.world);
    } else if (!isPlaying && this.playing_ && this.playSnapshot_) {
      // play → edit (Stop): restore the pre-play scene (snapshot is reusable).
      resetWorldTo(app.world, this.playSnapshot_);
      this.playSnapshot_ = null;
      restored = true;
    }
    this.playing_ = isPlaying;

    setPlayMode(isPlaying);
    app.setPaused(isPlaying && isPaused);
    return restored;
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
      const canvas = this.ensureCanvas();

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
      });
      this.app_ = app;

      // Mark this an editor host and open in edit mode: gameplay systems
      // (particle/animation/physics/timeline/…, gated on env.playModeOnly) are
      // frozen so simulation doesn't fight edits, while render/transform/camera
      // keep ticking. Play mode is toggled later via setRunMode.
      setEditorMode(true);
      setPlayMode(false);

      // Register the reactive bridge before the scene spawns so the initial
      // entities push through too.
      SceneStore.install();

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

      // Loop started — report ready before run() in case it never resolves.
      this.setStatus('ready');
      void Promise.resolve(app.run()).catch((err) => this.swallowUnwind(err));
    } catch (err) {
      this.swallowUnwind(err);
    }
  }

  /** Emscripten throws 'unwind' when its main loop takes over — that's success. */
  private swallowUnwind(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err === 'unwind' || msg.includes('unwind')) {
      if (this.snapshot.status !== 'ready') this.setStatus('ready');
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
