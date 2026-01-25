/**
 * ESEngine TypeScript SDK - Platform Abstraction
 *
 * Defines the interface for platform-specific implementations.
 */

import { TouchType, TouchPoint, KeyCode } from '../core/Types';

/**
 * Platform capabilities.
 */
export interface PlatformCapabilities {
  hasTouch: boolean;
  hasKeyboard: boolean;
  hasMouse: boolean;
  hasWebGL2: boolean;
}

/**
 * Platform configuration.
 */
export interface PlatformConfig {
  width: number;
  height: number;
  canvas?: HTMLCanvasElement | string;
  devicePixelRatio?: number;
  /** Skip WebGL context creation (used when WASM creates the context) */
  skipGLContext?: boolean;
}

/**
 * Touch event callback type.
 */
export type TouchCallback = (type: TouchType, point: TouchPoint) => void;

/**
 * Key event callback type.
 */
export type KeyCallback = (key: KeyCode, pressed: boolean) => void;

/**
 * Resize event callback type.
 */
export type ResizeCallback = (width: number, height: number) => void;

/**
 * Platform - Abstract interface for platform implementations.
 */
export abstract class Platform {
  protected touchCallback: TouchCallback | null = null;
  protected keyCallback: KeyCallback | null = null;
  protected resizeCallback: ResizeCallback | null = null;

  /**
   * Initialize the platform.
   */
  abstract initialize(config: PlatformConfig): boolean;

  /**
   * Shut down the platform.
   */
  abstract shutdown(): void;

  /**
   * Poll for input events.
   */
  abstract pollEvents(): void;

  /**
   * Swap display buffers (for double buffering).
   */
  abstract swapBuffers(): void;

  /**
   * Get the current time in seconds.
   */
  abstract getTime(): number;

  /**
   * Get the time since last frame in seconds.
   */
  abstract getDeltaTime(): number;

  /**
   * Get the window width in pixels.
   */
  abstract getWindowWidth(): number;

  /**
   * Get the window height in pixels.
   */
  abstract getWindowHeight(): number;

  /**
   * Get the aspect ratio (width / height).
   */
  getAspectRatio(): number {
    const height = this.getWindowHeight();
    return height > 0 ? this.getWindowWidth() / height : 1;
  }

  /**
   * Get the device pixel ratio.
   */
  abstract getDevicePixelRatio(): number;

  /**
   * Check if the platform is still running.
   */
  abstract isRunning(): boolean;

  /**
   * Request the platform to quit.
   */
  abstract requestQuit(): void;

  /**
   * Get the WebGL rendering context.
   */
  abstract getGL(): WebGLRenderingContext | WebGL2RenderingContext | null;

  /**
   * Get the canvas element.
   */
  abstract getCanvas(): HTMLCanvasElement | null;

  /**
   * Get platform capabilities.
   */
  abstract getCapabilities(): PlatformCapabilities;

  /**
   * Set the touch event callback.
   */
  setTouchCallback(callback: TouchCallback | null): void {
    this.touchCallback = callback;
  }

  /**
   * Set the key event callback.
   */
  setKeyCallback(callback: KeyCallback | null): void {
    this.keyCallback = callback;
  }

  /**
   * Set the resize event callback.
   */
  setResizeCallback(callback: ResizeCallback | null): void {
    this.resizeCallback = callback;
  }

  private static platformFactory: (() => Platform) | null = null;

  /**
   * Register a platform factory function.
   * This is called by platform implementations to register themselves.
   */
  static registerFactory(factory: () => Platform): void {
    Platform.platformFactory = factory;
  }

  /**
   * Create the appropriate platform for the current environment.
   * The platform must be registered first via registerFactory.
   */
  static create(): Platform {
    if (Platform.platformFactory) {
      return Platform.platformFactory();
    }

    // Auto-detect and throw helpful error
    if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') {
      throw new Error('WeChat MiniGame detected. Import WxPlatform and register it.');
    } else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      throw new Error('Web browser detected. Import WebPlatform and register it.');
    } else {
      throw new Error('Unsupported platform');
    }
  }
}

// Type declaration for WeChat MiniGame API (minimal)
declare const wx: {
  createCanvas: () => HTMLCanvasElement;
  getSystemInfoSync: () => {
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
  };
} | undefined;
