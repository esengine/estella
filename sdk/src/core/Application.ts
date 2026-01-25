/**
 * ESEngine TypeScript SDK - Application Base Class
 *
 * Provides the main entry point and lifecycle management for games.
 */

import {
  ApplicationConfig,
  TouchType,
  TouchPoint,
  KeyCode,
  RendererBackend,
} from './Types';
import { loadWasmModule, isWasmLoaded, WasmLoadOptions } from './WasmBridge';
import { Registry } from '../ecs/Registry';
import { SystemGroup } from '../ecs/System';
import { Input } from '../input/Input';
import { Platform, PlatformConfig } from '../platform/Platform';
import { Renderer, RendererMode } from '../renderer/Renderer';

/**
 * Application - Base class for games.
 * Extend this class and override lifecycle methods to create your game.
 */
export abstract class Application {
  private static instance: Application | null = null;

  protected config: Required<ApplicationConfig>;
  protected platform: Platform;
  protected registry: Registry;
  protected systems: SystemGroup;
  protected running: boolean = false;
  protected deltaTime: number = 0;
  protected animationFrameId: number = 0;
  protected rendererMode: RendererMode = RendererMode.Native;

  constructor(config: ApplicationConfig = {}) {
    if (Application.instance) {
      throw new Error('Only one Application instance can exist');
    }
    Application.instance = this;

    // Determine renderer backend
    const hasWasm = !!config.wasmPath;
    const requestedBackend = config.renderer ?? (hasWasm ? RendererBackend.Wasm : RendererBackend.Native);

    // Warn if Wasm requested but no path provided
    if (requestedBackend === RendererBackend.Wasm && !hasWasm) {
      console.warn(
        '[ESEngine] Wasm backend requested but wasmPath not provided. ' +
        'Falling back to Native. Provide wasmPath for C++ rendering.'
      );
    }

    // Apply default configuration
    this.config = {
      title: config.title ?? 'ESEngine Application',
      width: config.width ?? 800,
      height: config.height ?? 600,
      canvas: config.canvas ?? undefined as unknown as HTMLCanvasElement,
      vsync: config.vsync ?? true,
      wasmPath: config.wasmPath ?? '',
      renderer: requestedBackend,
    };

    // Initialize systems
    this.registry = new Registry();
    this.systems = new SystemGroup();

    // Create platform
    this.platform = Platform.create();
  }

  /**
   * Get the singleton application instance.
   */
  static get(): Application {
    if (!Application.instance) {
      throw new Error('No Application instance exists');
    }
    return Application.instance;
  }

  /**
   * Start the application main loop.
   * This is an async method that loads WASM if configured.
   */
  async run(): Promise<void> {
    if (this.running) return;

    // For WASM mode, we need to set up canvas first, then load WASM
    // because Emscripten needs the canvas to create WebGL context
    let canvas: HTMLCanvasElement | null = null;

    // Get or create canvas element
    if (this.config.canvas) {
      if (typeof this.config.canvas === 'string') {
        canvas = document.getElementById(this.config.canvas) as HTMLCanvasElement;
      } else {
        canvas = this.config.canvas;
      }
    }

    if (!canvas && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.id = 'esengine-canvas';
      document.body.appendChild(canvas);
    }

    // Set canvas size
    if (canvas) {
      const dpr = window.devicePixelRatio ?? 1;
      canvas.width = this.config.width * dpr;
      canvas.height = this.config.height * dpr;
      canvas.style.width = `${this.config.width}px`;
      canvas.style.height = `${this.config.height}px`;
    }

    // Load WASM module if configured for Wasm backend
    if (this.config.renderer === RendererBackend.Wasm && this.config.wasmPath) {
      try {
        console.log('[ESEngine] Loading WASM module...');
        const wasmOptions: WasmLoadOptions | undefined = canvas ? {
          canvas,
          width: this.config.width,
          height: this.config.height,
        } : undefined;
        await loadWasmModule(this.config.wasmPath, wasmOptions);
        this.rendererMode = RendererMode.Wasm;
        console.log('[ESEngine] WASM module loaded, using C++ renderer');
      } catch (error) {
        console.error('[ESEngine] Failed to load WASM module:', error);
        console.warn('[ESEngine] Falling back to Native renderer');
        this.rendererMode = RendererMode.Native;
      }
    } else {
      this.rendererMode = RendererMode.Native;
      if (this.config.renderer === RendererBackend.Wasm) {
        console.warn('[ESEngine] Using Native renderer (no wasmPath configured)');
      }
    }

    // Initialize platform (skip GL context creation if using WASM)
    const isWasmMode = this.rendererMode === RendererMode.Wasm;
    const platformConfig: PlatformConfig = {
      width: this.config.width,
      height: this.config.height,
      canvas: canvas ?? this.config.canvas,
      skipGLContext: isWasmMode, // Don't create GL context - C++ owns it
    };

    if (!this.platform.initialize(platformConfig)) {
      console.error('Failed to initialize platform');
      return;
    }

    // Initialize input
    Input.init();

    // Set up platform callbacks
    this.platform.setTouchCallback((type, point) => {
      Input.onTouchEvent(type, point);
      this.onTouch(type, point);
    });

    this.platform.setKeyCallback((key, pressed) => {
      Input.onKeyEvent(key, pressed);
      this.onKey(key, pressed);
    });

    this.platform.setResizeCallback((width, height) => {
      this.config.width = width;
      this.config.height = height;
      this.onResize(width, height);
    });

    // Initialize renderer with appropriate mode
    if (isWasmMode) {
      // WASM mode: C++ handles WebGL, no TypeScript GL context needed
      Renderer.init(null, this.rendererMode);
    } else {
      // Native mode: TypeScript handles WebGL
      const gl = this.platform.getGL();
      if (gl) {
        Renderer.init(gl, this.rendererMode);
        Renderer.setViewport(
          0,
          0,
          this.config.width * this.platform.getDevicePixelRatio(),
          this.config.height * this.platform.getDevicePixelRatio()
        );
      }
    }

    // Initialize systems
    this.systems.init(this.registry);

    // Call user initialization
    this.onInit();

    // Start game loop
    this.running = true;
    this.gameLoop();
  }

  /**
   * Request the application to quit.
   */
  quit(): void {
    this.running = false;
  }

  /**
   * Get the platform instance.
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get the ECS registry.
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get the system group.
   */
  getSystems(): SystemGroup {
    return this.systems;
  }

  /**
   * Get the window width.
   */
  getWidth(): number {
    return this.config.width;
  }

  /**
   * Get the window height.
   */
  getHeight(): number {
    return this.config.height;
  }

  /**
   * Get the time since last frame.
   */
  getDeltaTime(): number {
    return this.deltaTime;
  }

  /**
   * Check if the application is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if using WASM renderer.
   */
  isUsingWasm(): boolean {
    return this.rendererMode === RendererMode.Wasm && isWasmLoaded();
  }

  // ========== Lifecycle Methods (Override in subclass) ==========

  /**
   * Called once when the application initializes.
   */
  protected onInit(): void {}

  /**
   * Called every frame to update game logic.
   */
  protected onUpdate(deltaTime: number): void {}

  /**
   * Called every frame to render the game.
   */
  protected onRender(): void {}

  /**
   * Called when the application shuts down.
   */
  protected onShutdown(): void {}

  /**
   * Called when a touch event occurs.
   */
  protected onTouch(type: TouchType, point: TouchPoint): void {}

  /**
   * Called when a key event occurs.
   */
  protected onKey(key: KeyCode, pressed: boolean): void {}

  /**
   * Called when the window is resized.
   */
  protected onResize(width: number, height: number): void {}

  // ========== Private Methods ==========

  private gameLoop = (): void => {
    if (!this.running) {
      this.shutdown();
      return;
    }

    // Poll events and update timing
    this.platform.pollEvents();
    this.deltaTime = this.platform.getDeltaTime();

    // Update input state
    Input.update();

    // Begin frame
    Renderer.beginFrame();

    // Update systems
    this.systems.update(this.registry, this.deltaTime);

    // Update game
    this.onUpdate(this.deltaTime);

    // Render game
    this.onRender();

    // End frame
    Renderer.endFrame();

    // Swap buffers
    this.platform.swapBuffers();

    // Request next frame
    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(this.gameLoop);
    } else {
      // Fallback for environments without requestAnimationFrame
      setTimeout(this.gameLoop, 16);
    }
  };

  private shutdown(): void {
    // Cancel animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Call user shutdown
    this.onShutdown();

    // Shutdown systems
    this.systems.shutdown(this.registry);

    // Shutdown renderer
    Renderer.shutdown();

    // Shutdown input
    Input.shutdown();

    // Shutdown platform
    this.platform.shutdown();

    // Clear singleton
    Application.instance = null;
  }
}
