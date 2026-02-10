/**
 * @file    types.ts
 * @brief   Platform adapter interface definitions
 */

// =============================================================================
// Response Types
// =============================================================================

export interface PlatformResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    json<T = unknown>(): Promise<T>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

// =============================================================================
// Request Types
// =============================================================================

export interface PlatformRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer' | 'json';
    timeout?: number;
}

// =============================================================================
// WASM Types
// =============================================================================

export interface WasmInstantiateResult {
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
}

// =============================================================================
// Input Event Types
// =============================================================================

export interface InputEventCallbacks {
    onKeyDown(code: string): void;
    onKeyUp(code: string): void;
    onPointerMove(x: number, y: number): void;
    onPointerDown(button: number, x: number, y: number): void;
    onPointerUp(button: number): void;
    onWheel(deltaX: number, deltaY: number): void;
}

// =============================================================================
// Platform Adapter Interface
// =============================================================================

export interface PlatformAdapter {
    /**
     * Platform name identifier
     */
    readonly name: 'web' | 'wechat';

    /**
     * Fetch resource from URL
     */
    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;

    /**
     * Read local file as ArrayBuffer
     * @param path - File path (relative to game root)
     */
    readFile(path: string): Promise<ArrayBuffer>;

    /**
     * Read local file as text
     * @param path - File path (relative to game root)
     */
    readTextFile(path: string): Promise<string>;

    /**
     * Check if file exists
     * @param path - File path
     */
    fileExists(path: string): Promise<boolean>;

    /**
     * Instantiate WebAssembly module
     * @param pathOrBuffer - WASM file path (WeChat) or ArrayBuffer (Web)
     * @param imports - Import object
     */
    instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult>;

    /**
     * Create a 2D canvas for offscreen rendering
     */
    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;

    /**
     * High-resolution timestamp in milliseconds
     */
    now(): number;

    /**
     * Create an Image element for loading textures
     */
    createImage(): HTMLImageElement;

    /**
     * Bind input events (keyboard, pointer, wheel)
     * @param callbacks - Event callbacks
     * @param target - Optional event target (canvas element)
     */
    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;
}

// =============================================================================
// Platform Detection
// =============================================================================

export type PlatformType = 'web' | 'wechat';

export function detectPlatform(): PlatformType {
    // Check for WeChat MiniGame environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.wx !== 'undefined' && typeof g.wx.getSystemInfoSync === 'function') {
        return 'wechat';
    }
    return 'web';
}
