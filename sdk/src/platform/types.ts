// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
    onTouchStart?(id: number, x: number, y: number): void;
    onTouchMove?(id: number, x: number, y: number): void;
    onTouchEnd?(id: number): void;
    onTouchCancel?(id: number): void;
}

/**
 * A per-frame snapshot of one gamepad. With `mapping === 'standard'` the button
 * and axis indices follow the W3C "standard gamepad" layout (see GamepadButton /
 * GamepadAxis in input.ts). `buttons[i]` is analog in [0,1] (1 = fully pressed);
 * `axes[i]` is signed in [-1,1]. Gamepads are POLLED (no DOM events), so the
 * platform produces these each frame rather than via InputEventCallbacks.
 */
export interface GamepadSnapshot {
    index: number;
    connected: boolean;
    buttons: number[];
    axes: number[];
    mapping: string;
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
// Sockets
// =============================================================================

export type PlatformSocketReadyState = 'connecting' | 'open' | 'closing' | 'closed';

export interface PlatformSocketOptions {
    url: string;
    protocols?: string | string[];
}

/** Event payloads for {@link PlatformSocket.on}. */
export interface PlatformSocketEvents {
    open: [];
    message: [data: string | ArrayBuffer];
    close: [code: number, reason: string];
    error: [error: unknown];
}

/**
 * The platform-neutral socket surface (GameSocket / WeChatSocket / a Node ws
 * wrapper all fit): multicast `on(event, fn)` → unsubscribe, queues sends
 * until open, moves string|ArrayBuffer frames.
 */
export interface PlatformSocket {
    readyState: PlatformSocketReadyState;
    on<K extends keyof PlatformSocketEvents>(
        event: K,
        handler: (...args: PlatformSocketEvents[K]) => void,
    ): () => void;
    connect(): void;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
}

// =============================================================================
// Neutral Surfaces (DOM-free)
// =============================================================================
//
// The offscreen 2D surface the engine uses for image decode and dynamic glyph
// rasterization. These are a bounded STRUCTURAL SUBSET of the DOM
// Canvas/OffscreenCanvas + HTMLImageElement so a real HTMLCanvasElement /
// OffscreenCanvas / HTMLImageElement is assignable to them (web/mini-game adapters
// need no casts), while a native host — which has no DOM — can implement the
// PlatformAdapter contract honestly (createCanvas/createImage simply throw there;
// native textures come from loadImagePixels, the C++ createTextureFromPixels path).
//
// The main RENDER surface does NOT flow through here — it enters the C++ renderer
// via a GL context handle / preinitialized WebGPU device (see WebAppOptions), not
// createCanvas. So the neutral canvas is 2D-only.

/** RGBA readback from getImageData. The DOM `ImageData` is assignable (its extra
 *  members are ignored structurally). */
export interface PlatformImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
}

/** The subset of `TextMetrics` the glyph rasterizer reads. `TextMetrics` is
 *  assignable. */
export interface PlatformTextMetrics {
    readonly width: number;
    readonly actualBoundingBoxLeft?: number;
    readonly actualBoundingBoxRight?: number;
    readonly actualBoundingBoxAscent?: number;
    readonly actualBoundingBoxDescent?: number;
}

/** The `getContext('2d', …)` options actually used. */
export interface PlatformCanvasContextAttributes {
    willReadFrequently?: boolean;
    alpha?: boolean;
}

/**
 * A drawable source for `ctx.drawImage`. Typed `object` deliberately: it is the
 * only DOM-free SUPERTYPE of lib.dom's `CanvasImageSource` union (its
 * `SVGImageElement`/`VideoFrame` branches share no structural `{width;height}`),
 * so the real `CanvasRenderingContext2D.drawImage(CanvasImageSource)` stays
 * assignable to this neutral method while callers pass an `ImageBitmap` OR a
 * `PlatformImage` with no `as unknown` cast.
 */
export type PlatformImageSource = object;

/** Paint value for `fillStyle`. `string | object` is the DOM-free supertype of the
 *  real `string | CanvasGradient | CanvasPattern` (callers only ever assign a color
 *  string; the supertype is what keeps the real 2D context assignable). */
export type PlatformCanvasPaint = string | object;

/**
 * The offscreen 2D context the engine uses: image decode (`drawImage`/
 * `getImageData`/`clearRect`) and dynamic glyph rasterization (`font`/`measureText`/
 * `fillText`/…). Every member is present on BOTH `CanvasRenderingContext2D` and
 * `OffscreenCanvasRenderingContext2D` with covariance-compatible types, so both are
 * assignable here.
 */
export interface PlatformCanvas2DContext {
    // Image decode.
    drawImage(image: PlatformImageSource, dx: number, dy: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): PlatformImageData;
    clearRect(x: number, y: number, w: number, h: number): void;
    // Glyph rasterization (ui/text/glyph-rasterizer.ts).
    font: string;
    textBaseline: string;
    textAlign: string;
    fillStyle: PlatformCanvasPaint;
    measureText(text: string): PlatformTextMetrics;
    fillText(text: string, x: number, y: number): void;
}

/**
 * The offscreen 2D canvas surface. `HTMLCanvasElement` and `OffscreenCanvas` are
 * structurally assignable: their overloaded `getContext` matches this `'2d'`
 * overload, whose real return is assignable to {@link PlatformCanvas2DContext}.
 */
export interface PlatformCanvas {
    width: number;
    height: number;
    getContext(
        contextId: '2d',
        options?: PlatformCanvasContextAttributes,
    ): PlatformCanvas2DContext | null;
}

/**
 * A load/error callback SINK: callers only ever ASSIGN one (`img.onload = …`); the
 * host image invokes it. The parameter is the bottom type `never` so, by
 * contravariance, EVERY real handler shape is assignable to it — the DOM
 * `(ev: Event) => any`, the mini-game `() => void`, and the SDK's own
 * `() => resolve()` — without this "neutral" type naming any DOM type (`Event`).
 */
export type PlatformImageEventHandler = ((ev: never) => void) | null;

/**
 * A decodable image (the offscreen `<img>` on DOM hosts). `HTMLImageElement` and a
 * mini-game image are both structurally assignable. Native never creates one
 * (createImage throws), so the DOM-shaped members impose nothing on native.
 * `crossOrigin` is optional so a mini-game image (which lacks it) fits too.
 */
export interface PlatformImage {
    width: number;
    height: number;
    src: string;
    crossOrigin?: string | null;
    onload: PlatformImageEventHandler;
    onerror: PlatformImageEventHandler;
}

// =============================================================================
// Platform Adapter Interface
// =============================================================================

export interface PlatformAdapter {
    readonly name: 'web' | 'wechat' | 'douyin' | 'node' | 'native';

    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;

    readFile(path: string): Promise<ArrayBuffer>;

    readTextFile(path: string): Promise<string>;

    fileExists(path: string): Promise<boolean>;

    loadImagePixels(path: string): Promise<ImageLoadResult>;

    instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult>;

    createCanvas(width: number, height: number): PlatformCanvas;

    now(): number;

    createImage(): PlatformImage;

    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;

    /** Poll connected gamepads for this frame. Optional — platforms without
     *  gamepad support (WeChat, headless) omit it and the input plugin skips
     *  gamepad polling entirely. */
    pollGamepads?(): GamepadSnapshot[];

    createAudioBackend(): import('../audio/PlatformAudioBackend').PlatformAudioBackend;

    /** Create the platform video backend: HTMLVideoElement on web, the wasm
     *  software decoder (videodec side module) on WeChat. The choice is a static
     *  per-platform matrix — no runtime fallback chain. Optional — a platform
     *  without video (headless server) omits it and the video system uses the
     *  silent Null backend. */
    createVideoBackend?(
        ctx: import('../video/PlatformVideoBackend').VideoBackendContext
    ): import('../video/PlatformVideoBackend').PlatformVideoBackend;

    /** Download an on-demand asset subpackage by name and resolve when its files
     *  are available. WeChat → wx.loadSubpackage; platforms with no subpackage
     *  concept (web) omit it and lazy groups load directly from their URLs. */
    loadSubpackage?(name: string): Promise<void>;

    /** Open a socket connection. Web → WebSocket, WeChat → wx.connectSocket,
     *  Node → a ws wrapper. Optional — platforms without networking (playable
     *  ads) omit it and `createSocket()` fails loud. */
    createSocket?(options: PlatformSocketOptions): PlatformSocket;

    /** Subscribe to OS memory-pressure warnings; returns an unsubscribe.
     *  WeChat → wx.onMemoryWarning; platforms without a pressure signal (web)
     *  omit it. Residency caches subscribe to drop their evictable entries. */
    onMemoryWarning?(callback: () => void): () => void;

    /** The host's UI language tag ('zh-CN', 'en-US', …). WeChat reports
     *  'zh_CN'-style tags — `platformLanguage()` normalizes underscores.
     *  Optional; web falls through to navigator.language. */
    language?(): string;

    devicePixelRatio(): number;

    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    clearStorage(prefix: string): void;
}

// =============================================================================
// Platform Detection
// =============================================================================

export type PlatformType = 'web' | 'wechat' | 'douyin';

export function detectPlatform(): PlatformType {
    // Mini-game hosts expose their API under a vendor global (`tt` = Douyin,
    // `wx` = WeChat). Probe Douyin first — WeChat never defines `tt`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.tt !== 'undefined' && typeof g.tt.getSystemInfoSync === 'function') {
        return 'douyin';
    }
    if (typeof g.wx !== 'undefined' && typeof g.wx.getSystemInfoSync === 'function') {
        return 'wechat';
    }
    return 'web';
}
