// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    api.ts
 * @brief   Normalized mini-game host surface + per-vendor profile descriptor.
 *
 * WeChat (`wx`) and Douyin (`tt`) are two vendors of the same "mini-game
 * platform" family: their global objects expose a near-identical API. This file
 * models only the subset the engine actually uses; each vendor's global
 * satisfies `MiniGameGlobal` structurally and is bound at the profile boundary
 * (`sdk/src/platform/<vendor>/profile.ts`) with a single cast.
 *
 * The family logic (canvas / fs / fetch / image / input / storage) is written
 * ONCE against `MiniGameGlobal` in `adapter.ts`. Genuinely divergent operations
 * — WASM instantiation (WeChat's WXWebAssembly vs a standard loader), audio,
 * video, sockets — are methods on `MiniGameProfile`, not derived from the global.
 */

import type { PlatformAudioBackend } from '../../audio/PlatformAudioBackend';
import type { PlatformVideoBackend, VideoBackendContext } from '../../video/PlatformVideoBackend';
import type { PlatformSocket, PlatformSocketOptions, WasmInstantiateResult } from '../types';

// =============================================================================
// Normalized host primitives
// =============================================================================

export interface MiniGameCanvas {
    width: number;
    height: number;
    getContext(type: string, attributes?: unknown): unknown;
}

export interface MiniGameImage {
    width: number;
    height: number;
    src: string;
    onload: (() => void) | null;
    onerror: ((err: unknown) => void) | null;
}

export interface MiniGameFileSystemManager {
    readFileSync(path: string, encoding?: string): ArrayBuffer | string;
    readFile(opts: {
        filePath: string;
        encoding?: string;
        success?: (res: { data: ArrayBuffer | string }) => void;
        fail?: (err: { errMsg: string }) => void;
    }): void;
    access(opts: { path: string; success?: () => void; fail?: (err: { errMsg: string }) => void }): void;
    accessSync(path: string): void;
    writeFile(opts: {
        filePath: string;
        data: string | ArrayBuffer;
        encoding?: string;
        success?: () => void;
        fail?: (err: { errMsg: string }) => void;
    }): void;
}

export interface MiniGameRequestOptions {
    url: string;
    method?: string;
    data?: string | ArrayBuffer;
    header?: Record<string, string>;
    responseType?: 'text' | 'arraybuffer';
    timeout?: number;
    success?: (res: { statusCode: number; header?: Record<string, string>; data: string | ArrayBuffer }) => void;
    fail?: (err: { errMsg: string }) => void;
}

export interface MiniGameSystemInfo {
    pixelRatio?: number;
    language?: string;
    windowWidth?: number;
    windowHeight?: number;
}

export interface MiniGameTouch {
    identifier: number;
    clientX: number;
    clientY: number;
}
export interface MiniGameTouchEvent {
    changedTouches: MiniGameTouch[];
}
export interface MiniGameKeyEvent {
    code: string;
}
export interface MiniGameStorageInfo {
    keys: string[];
}

// =============================================================================
// The normalized mini-game global
// =============================================================================

/**
 * The subset of the mini-game host global (`wx` / `tt`) the engine consumes.
 * Optional members are capabilities a vendor may lack (keyboard, subpackages,
 * memory-pressure signal, app show/hide). The adapter probes for them at use
 * time, so a vendor missing one degrades gracefully rather than throwing.
 */
export interface MiniGameGlobal {
    createCanvas(): MiniGameCanvas;
    createImage(): MiniGameImage;
    getFileSystemManager(): MiniGameFileSystemManager;
    request(opts: MiniGameRequestOptions): void;
    createInnerAudioContext(): unknown;
    connectSocket(opts: { url: string; protocols?: string[] }): unknown;
    getSystemInfoSync(): MiniGameSystemInfo;

    onTouchStart(cb: (res: MiniGameTouchEvent) => void): void;
    onTouchMove(cb: (res: MiniGameTouchEvent) => void): void;
    onTouchEnd(cb: (res: MiniGameTouchEvent) => void): void;
    offTouchStart(cb: (res: MiniGameTouchEvent) => void): void;
    offTouchMove(cb: (res: MiniGameTouchEvent) => void): void;
    offTouchEnd(cb: (res: MiniGameTouchEvent) => void): void;
    // Optional: a cancelled gesture (system interruption). Present on WeChat/Douyin;
    // guarded so a host without it still binds start/move/end.
    onTouchCancel?(cb: (res: MiniGameTouchEvent) => void): void;
    offTouchCancel?(cb: (res: MiniGameTouchEvent) => void): void;

    onKeyDown?(cb: (res: MiniGameKeyEvent) => void): void;
    onKeyUp?(cb: (res: MiniGameKeyEvent) => void): void;
    offKeyDown?(cb: (res: MiniGameKeyEvent) => void): void;
    offKeyUp?(cb: (res: MiniGameKeyEvent) => void): void;

    loadSubpackage?(opts: {
        name: string;
        success?: () => void;
        fail?: (err: unknown) => void;
        complete?: () => void;
    }): void;
    onMemoryWarning?(cb: () => void): void;
    offMemoryWarning?(cb: () => void): void;

    onShow?(cb: () => void): void;
    onHide?(cb: () => void): void;

    getStorageSync(key: string): unknown;
    setStorageSync(key: string, value: string): void;
    removeStorageSync(key: string): void;
    getStorageInfoSync(): MiniGameStorageInfo;
}

// =============================================================================
// Per-vendor profile
// =============================================================================

export type MiniGameVendor = 'wechat' | 'douyin';

/**
 * A vendor described as DATA. The family adapter reads `global` for every shared
 * capability; the methods below are the genuine per-vendor divergences.
 */
export interface MiniGameProfile {
    /** Vendor identity — used for the adapter `name`, diagnostics, and logs. */
    readonly id: MiniGameVendor;
    /** Human label woven into filesystem error guidance ("WeChat" / "抖音"). */
    readonly hostLabel: string;
    /** The host global (`wx` / `tt`), bound with a cast at the profile boundary. */
    readonly global: MiniGameGlobal;

    /** WASM instantiation — the biggest divergence (WeChat's WXWebAssembly vs a
     *  standard loader). Kept off `global` because the WASM entry point is not a
     *  member of the host global on every vendor. */
    instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;

    createAudioBackend(): PlatformAudioBackend;
    createVideoBackend(ctx: VideoBackendContext): PlatformVideoBackend;
    createSocket(options: PlatformSocketOptions): PlatformSocket;
}
