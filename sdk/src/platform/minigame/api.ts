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
    /** Where the host itself is running — `ios`, `android`, `devtools`, … Not
     *  cosmetic: in-game purchase is permitted on some of these and forbidden
     *  on others, so a capability has to read it. */
    platform?: string;
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

/**
 * A one-shot audio player. Every mini-game host exposes this shape under
 * `createInnerAudioContext()`; WeChat's `InnerAudioContext` is structurally
 * assignable. Modelling it here is what makes audio a FAMILY capability instead
 * of a per-vendor backend.
 */
export interface MiniGameInnerAudioContext {
    src: string;
    loop: boolean;
    volume: number;
    playbackRate: number;
    startTime: number;
    obeyMuteSwitch: boolean;
    readonly paused: boolean;
    readonly currentTime: number;
    readonly duration: number;
    play(): void;
    pause(): void;
    stop(): void;
    destroy(): void;
    onEnded(cb: () => void): void;
    // The host passes an error record; typed as the bottom-ish `{ errMsg: string }`
    // supertype-by-contravariance so a vendor's richer callback stays assignable.
    onError(cb: (res: { errMsg: string }) => void): void;
}

/**
 * A rewarded video ad, as every mini-game host shapes it: WeChat's
 * `RewardedVideoAd` and Douyin's are structurally identical, which is what
 * makes ads a FAMILY capability rather than a per-vendor override. `onClose`
 * reports whether the video was watched to the end (`isEnded`); some hosts
 * omit the record entirely on older runtimes, which callers must treat as
 * "completed" — the platform granted the reward and simply didn't say so.
 */
export interface MiniGameRewardedVideoAd {
    load(): Promise<void>;
    show(): Promise<void>;
    onLoad(cb: () => void): void;
    offLoad(cb: () => void): void;
    onError(cb: (err: { errMsg: string; errCode?: number }) => void): void;
    offError(cb: (err: { errMsg: string; errCode?: number }) => void): void;
    onClose(cb: (res?: { isEnded: boolean }) => void): void;
    offClose(cb: (res?: { isEnded: boolean }) => void): void;
}

/** An interstitial ad. Same family shape as rewarded, plus `destroy` (the
 *  hosts document interstitials as destroyable; rewarded ads are singletons). */
export interface MiniGameInterstitialAd {
    load(): Promise<void>;
    show(): Promise<void>;
    destroy(): void;
    onLoad(cb: () => void): void;
    offLoad(cb: () => void): void;
    onError(cb: (err: { errMsg: string; errCode?: number }) => void): void;
    offError(cb: (err: { errMsg: string; errCode?: number }) => void): void;
    onClose(cb: () => void): void;
    offClose(cb: () => void): void;
}

/** The share card a host shows for an active or passive share. */
export interface MiniGameShareOptions {
    title?: string;
    imageUrl?: string;
    query?: string;
}

/**
 * The open data context, seen from the MAIN domain.
 *
 * It is a second JS runtime with no WebGL, no wasm and almost none of the host
 * API — and the only place a player's FRIENDS can be read at all. It draws on
 * `canvas`, which the main domain samples as a texture; `postMessage` is how it
 * is told what to draw. There is no channel back: no host offers sub→main
 * messaging, which is why nothing in this engine's leaderboard asks the context
 * a question.
 */
export interface MiniGameOpenDataContext {
    postMessage(message: Record<string, unknown>): void;
    /** The shared canvas. The context draws here; the main domain samples it. */
    readonly canvas: MiniGameCanvas;
}

/** One entry of the host's per-player cloud store — the rows a leaderboard is
 *  assembled from. Writable only for the player themselves. */
export interface MiniGameKVData {
    key: string;
    value: string;
}

/** The socket task `connectSocket()` returns. WeChat's `SocketTask` fits. */
export interface MiniGameSocketTask {
    send(opts: { data: string | ArrayBuffer }): void;
    close(opts: { code?: number; reason?: string }): void;
    onOpen(cb: (res?: unknown) => void): void;
    onMessage(cb: (res: { data: string | ArrayBuffer }) => void): void;
    onClose(cb: (res: { code: number; reason: string }) => void): void;
    onError(cb: (err: unknown) => void): void;
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
    createInnerAudioContext(): MiniGameInnerAudioContext;
    connectSocket(opts: { url: string; protocols?: string[] }): MiniGameSocketTask;
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

    /** Monetization + share — optional like every capability a vendor may lack
     *  (or a game may not have configured): the adapter probes at use time. */
    createRewardedVideoAd?(opts: { adUnitId: string }): MiniGameRewardedVideoAd;
    createInterstitialAd?(opts: { adUnitId: string }): MiniGameInterstitialAd;
    shareAppMessage?(opts: MiniGameShareOptions): void;
    /** Passive share: what the card says when the player shares from the host's
     *  own menu. The host calls `cb` at share time, not at registration. */
    onShareAppMessage?(cb: () => MiniGameShareOptions): void;

    /** Begin a sign-in. The result is a one-time code the game's own server
     *  exchanges — see the note on `PlatformAdapter.login`. */
    login?(opts: {
        success?: (res: { code: string }) => void;
        fail?: (err: unknown) => void;
        timeout?: number;
    }): void;
    /** Whether the host still regards the last sign-in as current. Reports the
     *  answer by WHICH callback it calls, not by a value. */
    checkSession?(opts: { success?: () => void; fail?: (err: unknown) => void }): void;

    /** In-game purchase of the host's currency. Present on the global whatever
     *  device it is running on — whether it may actually be CALLED is a
     *  platform rule, not an API-shape question. See `MiniGamePlatformAdapter.canPay`. */
    requestMidasPayment?(opts: {
        mode: string;
        offerId: string;
        buyQuantity: number;
        zoneId?: string;
        currencyType?: string;
        platform?: string;
        env?: number;
        success?: () => void;
        fail?: (err: { errMsg?: string; errCode?: number }) => void;
    }): void;

    /** The open data context, if this host has one. Absent on a host without
     *  friend data, and on a game whose package declares no context directory. */
    getOpenDataContext?(): MiniGameOpenDataContext;
    /** Write THIS player's rows into the host's cloud store. Writing is the main
     *  domain's half of a leaderboard; reading — anyone's, including the
     *  player's own — belongs to the open data context alone. */
    setUserCloudStorage?(opts: {
        KVDataList: MiniGameKVData[];
        success?: () => void;
        fail?: (err: unknown) => void;
        complete?: () => void;
    }): void;

    getStorageSync(key: string): unknown;
    setStorageSync(key: string, value: string): void;
    removeStorageSync(key: string): void;
    getStorageInfoSync(): MiniGameStorageInfo;
}

// =============================================================================
// Per-vendor profile
// =============================================================================

/**
 * A mini-game vendor's id. The vendors the engine ships are named for
 * completion, but the type is OPEN: a game can describe a host the engine has
 * never heard of and get the whole family for it. Nothing in the SDK branches on
 * this value — it is identity (adapter name, diagnostics, logs), not behavior.
 */
export type MiniGameVendor = 'wechat' | 'douyin' | (string & {});

/**
 * A vendor described as DATA — three facts and, at most, one method.
 *
 * The family adapter reads `global` for every capability the hosts share, and
 * that is nearly all of them: audio (`createInnerAudioContext`), sockets
 * (`connectSocket`), video (the engine's own wasm decoder) and the whole
 * fs/fetch/canvas/input/storage surface all come from the normalized global. So
 * the overrides below are OPTIONAL — a vendor supplies one only where it truly
 * differs from the family. WeChat overrides exactly one (`instantiateWasm`, for
 * WXWebAssembly); a host with standard `WebAssembly` overrides none.
 */
export interface MiniGameProfile {
    /** Vendor identity — used for the adapter `name`, diagnostics, and logs. */
    readonly id: MiniGameVendor;
    /** Human label woven into filesystem error guidance ("WeChat" / "抖音"). */
    readonly hostLabel: string;
    /** The host global (`wx` / `tt`), bound with a cast at the profile boundary. */
    readonly global: MiniGameGlobal;

    /** WASM instantiation, when the host does not use the standard
     *  `WebAssembly.instantiate` (WeChat routes it through WXWebAssembly, which
     *  takes a package path and is not a member of the host global). Omit and
     *  the family reads the file through the adapter and instantiates it. */
    instantiateWasm?(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;

    /** Omit for the family backend over `global.createInnerAudioContext()`. */
    createAudioBackend?(): PlatformAudioBackend;
    /** Omit for the engine's own wasm video decoder (portable to every vendor). */
    createVideoBackend?(ctx: VideoBackendContext): PlatformVideoBackend;
    /** Omit for the family socket over `global.connectSocket()`. */
    createSocket?(options: PlatformSocketOptions): PlatformSocket;
}
