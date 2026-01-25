/**
 * ESEngine TypeScript SDK - Web Platform Implementation
 *
 * Platform implementation for standard web browsers.
 */

import { TouchType, TouchPoint, KeyCode } from '../core/Types';
import { Platform, PlatformConfig, PlatformCapabilities } from './Platform';

/**
 * WebPlatform - Web browser platform implementation.
 */
export class WebPlatform extends Platform {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private running: boolean = false;
  private width: number = 0;
  private height: number = 0;
  private dpr: number = 1;
  private startTime: number = 0;
  private lastTime: number = 0;
  private deltaTime: number = 0;
  private capabilities: PlatformCapabilities;

  constructor() {
    super();
    this.capabilities = {
      hasTouch: false,
      hasKeyboard: true,
      hasMouse: true,
      hasWebGL2: false,
    };
  }

  initialize(config: PlatformConfig): boolean {
    // Get or create canvas
    if (config.canvas) {
      if (typeof config.canvas === 'string') {
        this.canvas = document.getElementById(config.canvas) as HTMLCanvasElement;
        if (!this.canvas) {
          console.error(`Canvas element not found: ${config.canvas}`);
          return false;
        }
      } else {
        this.canvas = config.canvas;
      }
    } else {
      this.canvas = document.createElement('canvas');
      document.body.appendChild(this.canvas);
    }

    // Set up dimensions
    this.dpr = config.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    this.width = config.width;
    this.height = config.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Get WebGL context (skip if WASM creates it)
    if (!config.skipGLContext) {
      this.gl = this.canvas.getContext('webgl2') as WebGL2RenderingContext;
      if (this.gl) {
        this.capabilities.hasWebGL2 = true;
      } else {
        this.gl = this.canvas.getContext('webgl') as WebGLRenderingContext;
        if (!this.gl) {
          console.error('WebGL not supported');
          return false;
        }
      }
    } else {
      // When using WASM, the C++ code creates and manages the WebGL context
      this.capabilities.hasWebGL2 = true; // WASM uses WebGL2
    }

    // Check touch support
    this.capabilities.hasTouch = 'ontouchstart' in window;

    // Set up event listeners
    this.setupEventListeners();

    // Initialize timing
    this.startTime = performance.now() / 1000;
    this.lastTime = this.startTime;
    this.running = true;

    return true;
  }

  shutdown(): void {
    this.removeEventListeners();
    this.running = false;
    this.gl = null;
    this.canvas = null;
  }

  pollEvents(): void {
    // Events are handled asynchronously via callbacks
    const now = performance.now() / 1000;
    this.deltaTime = now - this.lastTime;
    this.lastTime = now;
  }

  swapBuffers(): void {
    // WebGL automatically swaps buffers
  }

  getTime(): number {
    return performance.now() / 1000 - this.startTime;
  }

  getDeltaTime(): number {
    return this.deltaTime;
  }

  getWindowWidth(): number {
    return this.width;
  }

  getWindowHeight(): number {
    return this.height;
  }

  getDevicePixelRatio(): number {
    return this.dpr;
  }

  isRunning(): boolean {
    return this.running;
  }

  requestQuit(): void {
    this.running = false;
  }

  getGL(): WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.gl;
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  getCapabilities(): PlatformCapabilities {
    return { ...this.capabilities };
  }

  private setupEventListeners(): void {
    if (!this.canvas) return;

    // Touch events
    this.canvas.addEventListener('touchstart', this.handleTouchStart);
    this.canvas.addEventListener('touchmove', this.handleTouchMove);
    this.canvas.addEventListener('touchend', this.handleTouchEnd);
    this.canvas.addEventListener('touchcancel', this.handleTouchCancel);

    // Mouse events (emulate touch)
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);

    // Keyboard events
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // Resize event
    window.addEventListener('resize', this.handleResize);
  }

  private removeEventListeners(): void {
    if (!this.canvas) return;

    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchCancel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('resize', this.handleResize);
  }

  private getCanvasPosition(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    // Return logical coordinates (CSS pixels), not physical pixels
    // Game logic should use logical coords, only convert to physical in rendering
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private handleTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = this.getCanvasPosition(touch.clientX, touch.clientY);
      const point: TouchPoint = { id: touch.identifier, x: pos.x, y: pos.y };
      this.touchCallback?.(TouchType.Begin, point);
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = this.getCanvasPosition(touch.clientX, touch.clientY);
      const point: TouchPoint = { id: touch.identifier, x: pos.x, y: pos.y };
      this.touchCallback?.(TouchType.Move, point);
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = this.getCanvasPosition(touch.clientX, touch.clientY);
      const point: TouchPoint = { id: touch.identifier, x: pos.x, y: pos.y };
      this.touchCallback?.(TouchType.End, point);
    }
  };

  private handleTouchCancel = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = this.getCanvasPosition(touch.clientX, touch.clientY);
      const point: TouchPoint = { id: touch.identifier, x: pos.x, y: pos.y };
      this.touchCallback?.(TouchType.Cancel, point);
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    const pos = this.getCanvasPosition(e.clientX, e.clientY);
    const point: TouchPoint = { id: 0, x: pos.x, y: pos.y };
    this.touchCallback?.(TouchType.Begin, point);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const pos = this.getCanvasPosition(e.clientX, e.clientY);
    const point: TouchPoint = { id: 0, x: pos.x, y: pos.y };
    this.touchCallback?.(TouchType.Move, point);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    const pos = this.getCanvasPosition(e.clientX, e.clientY);
    const point: TouchPoint = { id: 0, x: pos.x, y: pos.y };
    this.touchCallback?.(TouchType.End, point);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const keyCode = this.mapKeyCode(e.keyCode);
    this.keyCallback?.(keyCode, true);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const keyCode = this.mapKeyCode(e.keyCode);
    this.keyCallback?.(keyCode, false);
  };

  private handleResize = (): void => {
    this.resizeCallback?.(window.innerWidth, window.innerHeight);
  };

  private mapKeyCode(code: number): KeyCode {
    // Most key codes map directly
    if (code in KeyCode) {
      return code as KeyCode;
    }
    return KeyCode.Unknown;
  }
}

// Auto-register WebPlatform when imported in browser environment
// Check is done after class definition to ensure WebPlatform is available
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  Platform.registerFactory(() => new WebPlatform());
}
