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
// Image Types
// =============================================================================

export interface ImageLoadResult {
    width: number;
    height: number;
    pixels: Uint8Array;
}

// =============================================================================
// Platform Adapter Interface
// =============================================================================

export interface PlatformAdapter {
    readonly name: 'web' | 'wechat';

    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;

    readFile(path: string): Promise<ArrayBuffer>;

    readTextFile(path: string): Promise<string>;

    fileExists(path: string): Promise<boolean>;

    loadImagePixels(path: string): Promise<ImageLoadResult>;

    instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult>;

    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;

    now(): number;

    createImage(): HTMLImageElement;

    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;

    createAudioBackend(): import('../audio/PlatformAudioBackend').PlatformAudioBackend;

    devicePixelRatio(): number;

    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    clearStorage(prefix: string): void;
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
