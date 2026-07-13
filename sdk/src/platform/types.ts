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

/**
 * The platform-neutral socket surface (GameSocket / WeChatSocket / a Node ws
 * wrapper all fit): callback-based, queues sends until open, moves
 * string|ArrayBuffer frames.
 */
export interface PlatformSocket {
    readyState: PlatformSocketReadyState;
    onOpen: (() => void) | null;
    onMessage: ((data: string | ArrayBuffer) => void) | null;
    onClose: ((code: number, reason: string) => void) | null;
    onError: ((error: unknown) => void) | null;
    connect(): void;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
}

// =============================================================================
// Platform Adapter Interface
// =============================================================================

export interface PlatformAdapter {
    readonly name: 'web' | 'wechat' | 'node';

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

    /** Poll connected gamepads for this frame. Optional — platforms without
     *  gamepad support (WeChat, headless) omit it and the input plugin skips
     *  gamepad polling entirely. */
    pollGamepads?(): GamepadSnapshot[];

    createAudioBackend(): import('../audio/PlatformAudioBackend').PlatformAudioBackend;

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
