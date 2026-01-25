/**
 * ESEngine TypeScript SDK - WeChat MiniGame Platform Implementation
 *
 * Platform implementation for WeChat MiniGame environment.
 */

import { TouchType, TouchPoint } from '../core/Types';
import { Platform, PlatformConfig, PlatformCapabilities } from './Platform';

// WeChat MiniGame API types
declare const wx: {
  createCanvas: () => HTMLCanvasElement;
  getSystemInfoSync: () => {
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    platform: string;
    brand: string;
    model: string;
  };
  onTouchStart: (callback: (res: WxTouchEvent) => void) => void;
  onTouchMove: (callback: (res: WxTouchEvent) => void) => void;
  onTouchEnd: (callback: (res: WxTouchEvent) => void) => void;
  onTouchCancel: (callback: (res: WxTouchEvent) => void) => void;
  offTouchStart: (callback: (res: WxTouchEvent) => void) => void;
  offTouchMove: (callback: (res: WxTouchEvent) => void) => void;
  offTouchEnd: (callback: (res: WxTouchEvent) => void) => void;
  offTouchCancel: (callback: (res: WxTouchEvent) => void) => void;
};

interface WxTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

interface WxTouchEvent {
  touches: WxTouch[];
  changedTouches: WxTouch[];
  timeStamp: number;
}

/**
 * WxPlatform - WeChat MiniGame platform implementation.
 */
export class WxPlatform extends Platform {
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
      hasTouch: true,
      hasKeyboard: false,
      hasMouse: false,
      hasWebGL2: false,
    };
  }

  initialize(config: PlatformConfig): boolean {
    // Get system info
    const systemInfo = wx.getSystemInfoSync();
    this.dpr = config.devicePixelRatio ?? systemInfo.pixelRatio;

    // Create canvas
    this.canvas = wx.createCanvas();

    // Set up dimensions
    this.width = config.width || systemInfo.windowWidth;
    this.height = config.height || systemInfo.windowHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;

    // Get WebGL context
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

    // Set up event listeners
    this.setupEventListeners();

    // Initialize timing
    this.startTime = Date.now() / 1000;
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
    const now = Date.now() / 1000;
    this.deltaTime = now - this.lastTime;
    this.lastTime = now;
  }

  swapBuffers(): void {
    // WeChat handles buffer swapping
  }

  getTime(): number {
    return Date.now() / 1000 - this.startTime;
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
    wx.onTouchStart(this.handleTouchStart);
    wx.onTouchMove(this.handleTouchMove);
    wx.onTouchEnd(this.handleTouchEnd);
    wx.onTouchCancel(this.handleTouchCancel);
  }

  private removeEventListeners(): void {
    wx.offTouchStart(this.handleTouchStart);
    wx.offTouchMove(this.handleTouchMove);
    wx.offTouchEnd(this.handleTouchEnd);
    wx.offTouchCancel(this.handleTouchCancel);
  }

  private handleTouchStart = (e: WxTouchEvent): void => {
    for (const touch of e.changedTouches) {
      const point: TouchPoint = {
        id: touch.identifier,
        x: touch.clientX * this.dpr,
        y: touch.clientY * this.dpr,
      };
      this.touchCallback?.(TouchType.Begin, point);
    }
  };

  private handleTouchMove = (e: WxTouchEvent): void => {
    for (const touch of e.changedTouches) {
      const point: TouchPoint = {
        id: touch.identifier,
        x: touch.clientX * this.dpr,
        y: touch.clientY * this.dpr,
      };
      this.touchCallback?.(TouchType.Move, point);
    }
  };

  private handleTouchEnd = (e: WxTouchEvent): void => {
    for (const touch of e.changedTouches) {
      const point: TouchPoint = {
        id: touch.identifier,
        x: touch.clientX * this.dpr,
        y: touch.clientY * this.dpr,
      };
      this.touchCallback?.(TouchType.End, point);
    }
  };

  private handleTouchCancel = (e: WxTouchEvent): void => {
    for (const touch of e.changedTouches) {
      const point: TouchPoint = {
        id: touch.identifier,
        x: touch.clientX * this.dpr,
        y: touch.clientY * this.dpr,
      };
      this.touchCallback?.(TouchType.Cancel, point);
    }
  };
}

// Auto-register WxPlatform when imported in WeChat MiniGame environment
// Check is done after class definition to ensure WxPlatform is available
try {
  if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') {
    Platform.registerFactory(() => new WxPlatform());
  }
} catch {
  // Ignore errors in environments where wx is not available
}
