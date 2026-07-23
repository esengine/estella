// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bridge.ts
 * @brief   The contract a native host (embedded Dawn + JS engine on iOS/Android)
 *          injects so the existing TS SDK + wasm core runs unchanged — NOT a
 *          WebView. Every capability the engine needs from the OS is a method
 *          here; the {@link NativePlatformAdapter} adapts them to PlatformAdapter.
 *
 *          Deliberately NOT on the bridge:
 *          - WASM instantiation — the host JS engine (JavaScriptCore / V8 / Hermes)
 *            provides the `WebAssembly` global; the adapter uses it directly, the
 *            same as the Node host.
 *          - The GPU render surface — it reaches the C++ renderer via a device
 *            handle (WebAppOptions), not through this adapter. Out of scope here.
 *
 * @beta   Pre-1.0: the native host is unshipped; this contract will change as the
 *         shell (boot spike → full host) lands. Internal — not a public export yet.
 */

import type { ImageLoadResult, PlatformRequestOptions } from '../types';

/**
 * A single fetch result from the native http stack. The adapter wraps it into a
 * {@link PlatformResponse}: provide `text` OR `arrayBuffer` (matching the request's
 * responseType); the adapter derives the other on demand.
 */
export interface NativeFetchResult {
    ok: boolean;
    status: number;
    statusText?: string;
    headers?: Record<string, string>;
    arrayBuffer?: ArrayBuffer;
    text?: string;
}

/**
 * The engine's input sink. The shell PUSHES events (native has no DOM event
 * loop): touch coordinates are logical px, origin top-left. Keyboard is optional
 * (most devices are touch-only). The adapter synthesizes the primary pointer from
 * the first active touch, matching the web/mini-game adapters.
 */
export interface NativeInputListener {
    onTouchStart(id: number, x: number, y: number): void;
    onTouchMove(id: number, x: number, y: number): void;
    onTouchEnd(id: number): void;
    onTouchCancel(id: number): void;
    onKeyDown?(code: string): void;
    onKeyUp?(code: string): void;
}

/**
 * The host functions the native shell injects. Async where the call crosses to
 * the OS (files, network, image decode); sync where the native API is sync
 * (key-value storage). Textures take the pixel-decode path: the host decodes an
 * image to RGBA via {@link NativeBridge.loadImagePixels} (there is no offscreen
 * DOM canvas on native).
 */
export interface NativeBridge {
    /** Read a project-relative (packaged) file, or an absolute http(s) URL. */
    readFile(path: string): Promise<ArrayBuffer>;
    fileExists(path: string): Promise<boolean>;
    fetch(url: string, options?: PlatformRequestOptions): Promise<NativeFetchResult>;

    /** Decode an image to top-first RGBA (the Path-2 / createTextureFromPixels
     *  route the play realm and WeChat also use). */
    loadImagePixels(path: string): Promise<ImageLoadResult>;

    /** Persistent key-value store (NSUserDefaults / SharedPreferences). Sync,
     *  like localStorage / wx.*StorageSync. `storageKeys()` lets the adapter
     *  implement `clearStorage(prefix)` itself. */
    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    storageKeys(): string[];

    /** Register the engine's input sink; returns an unsubscribe. */
    registerInput(listener: NativeInputListener): () => void;

    devicePixelRatio(): number;
    /** High-resolution clock. Optional — falls back to `Date.now()`. */
    now?(): number;
    /** Host UI language ('zh-CN', 'en-US', …). Optional — falls back to 'en'. */
    language?(): string;

    /** App foreground/background signals. Reserved for the native Lifecycle seam
     *  (not wired this round). */
    onShow?(callback: () => void): void;
    onHide?(callback: () => void): void;
}
