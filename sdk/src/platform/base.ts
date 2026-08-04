// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    base.ts
 * @brief   Base platform adapter - no platform-specific code
 */

import type { PlatformAdapter } from './types';
import type { PlatformAudioBackend } from '../audio/PlatformAudioBackend';
import { NullAudioBackend } from '../audio/NullAudioBackend';

// =============================================================================
// Platform Instance (set by entry point)
// =============================================================================

let currentPlatform: PlatformAdapter | null = null;

/**
 * Set the platform adapter (called by entry point)
 */
export function setPlatform(adapter: PlatformAdapter): void {
    currentPlatform = adapter;
}

/**
 * Get the current platform adapter
 * @throws Error if platform not initialized
 */
export function getPlatform(): PlatformAdapter {
    if (!currentPlatform) {
        throw new Error(
            '[ESEngine] Platform not initialized. ' +
            'Import from "esengine" (web) or "esengine/wechat" (WeChat) instead of direct imports.'
        );
    }
    return currentPlatform;
}

/**
 * Check if platform is initialized
 */
export function isPlatformInitialized(): boolean {
    return currentPlatform !== null;
}

/**
 * Get platform type
 */
export function getPlatformType(): PlatformAdapter['name'] | null {
    return currentPlatform?.name ?? null;
}

/**
 * Check if running on WeChat specifically (true vendor identity).
 * Prefer isMiniGame() for "no DOM / packaged fs / subpackages" checks that hold
 * for every mini-game vendor, not just WeChat.
 */
export function isWeChat(): boolean {
    return currentPlatform?.name === 'wechat';
}

/**
 * Check if running on any mini-game host (WeChat, Douyin, a vendor the game
 * brought itself) — the capability family that shares the packaged-filesystem /
 * subpackage / no-DOM model.
 *
 * Reads the adapter's declared family, not a list of vendor names: every
 * platform built on {@link MiniGamePlatformAdapter} answers true here, so
 * shipping a new vendor never means editing this function.
 */
export function isMiniGame(): boolean {
    return currentPlatform?.family === 'minigame';
}

/**
 * Check if running on Web
 */
export function isWeb(): boolean {
    return currentPlatform?.name === 'web';
}

/**
 * Check if running on a native host (embedded Dawn + JS engine on iOS/Android).
 * Native has no DOM: offscreen canvas/image throw, textures come from the
 * pixel-decode path (loadImagePixels), and lifecycle/safe-area treat it like a
 * headless-but-visible host rather than the web DOM branch.
 */
export function isNative(): boolean {
    return currentPlatform?.name === 'native';
}

// =============================================================================
// Convenience Functions
// =============================================================================

export async function platformFetch(
    url: string,
    options?: import('./types').PlatformRequestOptions
): Promise<import('./types').PlatformResponse> {
    return getPlatform().fetch(url, options);
}

export async function platformReadFile(path: string): Promise<ArrayBuffer> {
    return getPlatform().readFile(path);
}

export async function platformReadTextFile(path: string): Promise<string> {
    return getPlatform().readTextFile(path);
}

export async function platformFileExists(path: string): Promise<boolean> {
    return getPlatform().fileExists(path);
}

export async function platformLoadImagePixels(path: string): Promise<import('./types').ImageLoadResult> {
    return getPlatform().loadImagePixels(path);
}

export async function platformInstantiateWasm(
    pathOrBuffer: string | ArrayBuffer,
    imports: WebAssembly.Imports
): Promise<import('./types').WasmInstantiateResult> {
    return getPlatform().instantiateWasm(pathOrBuffer, imports);
}

export function platformCreateCanvas(
    width: number,
    height: number,
): import('./types').PlatformCanvas {
    return getPlatform().createCanvas(width, height);
}

export function platformCreateImage(): import('./types').PlatformImage {
    return getPlatform().createImage();
}

/** Whether this platform rasterizes glyphs itself (no 2D canvas to draw them on).
 *  The glyph atlas picks its rasterizer from this — false everywhere a canvas
 *  exists, so web/WeChat text is untouched. Safe before a platform is set. */
export function platformHasGlyphRasterizer(): boolean {
    return isPlatformInitialized() && typeof getPlatform().rasterizeGlyph === 'function';
}

/** Rasterize one glyph through the platform's own text stack; null when the
 *  platform has no rasterizer, or the font/glyph was unavailable. */
export function platformRasterizeGlyph(
    request: import('./types').PlatformGlyphRequest,
): import('./types').PlatformGlyph | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().rasterizeGlyph?.(request) ?? null;
}

/** The platform's text-editing surface, or null where there is none (a headless
 *  realm, the editor in edit mode) — fields then render but cannot be typed
 *  into. Safe before a platform is set. */
export function platformCreateTextEditor(): import('./types').PlatformTextEditor | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().createTextEditor?.() ?? null;
}

export function platformNow(): number {
    return getPlatform().now();
}

/** Tear down input listeners the adapter bound. No-op on a host that never bound
 *  input (headless node) or before a platform is set (tests). */
export function platformUnbindInputEvents(): void {
    if (!isPlatformInitialized()) return;
    getPlatform().unbindInputEvents?.();
}

/** The platform audio backend, or the silent Null backend when the host has no
 *  audio device (headless node, the native shell before audio lands) — the single
 *  place the "no real backend" default is decided, mirroring the video backend. */
export function platformCreateAudioBackend(): PlatformAudioBackend {
    return getPlatform().createAudioBackend?.() ?? new NullAudioBackend();
}

/** Download an on-demand subpackage by name (resolves immediately on platforms
 *  with no subpackage concept, e.g. web). The single channel lazy asset groups
 *  use before loading their assets. */
export function platformLoadSubpackage(name: string): Promise<void> {
    const p = getPlatform();
    return p.loadSubpackage ? p.loadSubpackage(name) : Promise.resolve();
}

/** Read a content-addressed asset from the persistent cache (hot-update's offline
 *  store). Returns null on a miss, when the platform has no cache (web), when the
 *  platform is uninitialized (tests), OR on any read error — every case means "not
 *  cached, fetch normally", so cache failures never break loading. */
export async function platformReadCacheFile(key: string): Promise<ArrayBuffer | null> {
    if (!isPlatformInitialized()) return null;
    const p = getPlatform();
    if (!p.readCacheFile) return null;
    try {
        return await p.readCacheFile(key);
    } catch {
        return null;
    }
}

/** Persist a content-addressed asset to the cache. No-op when the platform has no
 *  cache (web) or is uninitialized (tests); swallows write errors (best-effort — a
 *  failed cache write must not fail the update). */
export async function platformWriteCacheFile(key: string, bytes: ArrayBuffer): Promise<void> {
    if (!isPlatformInitialized()) return;
    const p = getPlatform();
    if (!p.writeCacheFile) return;
    try {
        await p.writeCacheFile(key, bytes);
    } catch {
        // best-effort cache; ignore
    }
}

/** Subscribe to OS memory-pressure warnings (wx.onMemoryWarning on WeChat).
 *  Returns an unsubscribe. On platforms without a pressure signal the callback
 *  simply never fires. Tolerates an uninitialized platform (tests). */
export function platformOnMemoryWarning(callback: () => void): () => void {
    if (!isPlatformInitialized()) return () => {};
    const p = getPlatform();
    return p.onMemoryWarning ? p.onMemoryWarning(callback) : () => {};
}

/** Subscribe to the app returning to foreground / going to background — the
 *  native shell's push signals (no DOM visibility on native). Return an
 *  unsubscribe; a platform without the signal never fires. Tolerates an
 *  uninitialized platform (tests). */
export function platformOnAppShow(callback: () => void): () => void {
    if (!isPlatformInitialized()) return () => {};
    const p = getPlatform();
    return p.onAppShow ? p.onAppShow(callback) : () => {};
}

export function platformOnAppHide(callback: () => void): () => void {
    if (!isPlatformInitialized()) return () => {};
    const p = getPlatform();
    return p.onAppHide ? p.onAppHide(callback) : () => {};
}

/** Read a persisted string by key (adapter storage: localStorage on web,
 *  `wx.getStorageSync` on WeChat). Returns null when the key is absent OR the
 *  platform is uninitialized (tests) — callers treat both as "nothing stored". */
export function platformGetStorageItem(key: string): string | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().getStorageItem(key);
}

/** Persist a string by key through the adapter's storage. No-op when the platform
 *  is uninitialized (tests), so persistence is a safe best-effort everywhere. */
export function platformSetStorageItem(key: string, value: string): void {
    if (!isPlatformInitialized()) return;
    getPlatform().setStorageItem(key, value);
}

/** Whether this platform can mint ad units at all, without minting one (a
 *  mini-game host materializes a real host object per created unit). */
export function platformCanCreateAds(): boolean {
    return isPlatformInitialized() && getPlatform().createRewardedAd !== undefined;
}

/** One rewarded ad unit from the platform, or null where the platform has no ad
 *  system (web, native, playable, an uninitialized platform in tests). Null is
 *  an answer, not an error: the services layer substitutes its mock provider or
 *  fails loud with the reason, which is a decision this layer cannot make. */
export function platformCreateRewardedAd(adUnitId: string): import('./types').PlatformRewardedAd | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().createRewardedAd?.(adUnitId) ?? null;
}

/** One interstitial ad unit, or null — same availability story as rewarded. */
export function platformCreateInterstitialAd(adUnitId: string): import('./types').PlatformInterstitialAd | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().createInterstitialAd?.(adUnitId) ?? null;
}

/** Whether this platform can open a share sheet at all, without opening one. */
export function platformCanShare(): boolean {
    return isPlatformInitialized() && getPlatform().share !== undefined;
}

/** Actively open the host's share sheet; false when this platform cannot share
 *  (web, native, tests) so the caller can hide its share button honestly. */
export function platformShare(options: import('./types').PlatformShareOptions): boolean {
    if (!isPlatformInitialized()) return false;
    const p = getPlatform();
    if (!p.share) return false;
    p.share(options);
    return true;
}

/** Register the passive-share card provider; false when the platform has no
 *  passive share surface. The host asks the provider at share time. */
export function platformOnShareRequest(provide: () => import('./types').PlatformShareOptions): boolean {
    if (!isPlatformInitialized()) return false;
    const p = getPlatform();
    if (!p.onShareRequest) return false;
    p.onShareRequest(provide);
    return true;
}

/**
 * Whether this platform has a USABLE open data context — what a leaderboard
 * reads to hide itself honestly (web, native and the editor have none).
 *
 * Method presence is not the answer here, the way it is for share: the
 * mini-game family is ONE adapter, so every vendor defines these, and a game
 * whose package declares no context directory has none even on a host that
 * supports them. So the honest probe is the same one the ad path uses — ask
 * for the thing and treat null as "not here".
 */
export function platformCanOpenData(): boolean {
    if (!isPlatformInitialized()) return false;
    const p = getPlatform();
    return p.openDataPostMessage !== undefined && p.openDataCanvas?.() != null;
}

/**
 * Send one message into the open data context; false where there is none.
 * One way: the hosts offer no path back, so there is nothing to await.
 *
 * Gated on the same probe rather than on method presence — otherwise this
 * reports a delivery it did not make, on every mini-game host without a
 * context, which is the answer a caller is least able to check.
 */
export function platformOpenDataPostMessage(message: Record<string, unknown>): boolean {
    if (!platformCanOpenData()) return false;
    getPlatform().openDataPostMessage!(message);
    return true;
}

/** The canvas the open data context draws on, for sampling as a texture. */
export function platformOpenDataCanvas(): import('./types').PlatformCanvas | null {
    if (!isPlatformInitialized()) return null;
    return getPlatform().openDataCanvas?.() ?? null;
}

/** Write this player's own cloud rows; false where the host has no such store.
 *  Unlike a share, "there was nowhere to write this" is knowable at call time,
 *  so it is reported rather than swallowed. */
export function platformSetCloudKeyValues(entries: Readonly<Record<string, string>>): boolean {
    if (!isPlatformInitialized()) return false;
    return getPlatform().setCloudKeyValues?.(entries) ?? false;
}

export function platformDevicePixelRatio(): number {
    if (currentPlatform) {
        return currentPlatform.devicePixelRatio();
    }
    return typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
}

/** The host's UI language as a BCP-47-ish tag ('zh-CN', 'en-US', …): the
 *  adapter's report (WeChat), else navigator.language (web), else 'en'.
 *  Underscore tags ('zh_CN') normalize to hyphens. Tolerates an
 *  uninitialized platform (tests). */
export function platformLanguage(): string {
    const raw = currentPlatform?.language?.()
        ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
    return (raw ?? 'en').replace(/_/g, '-');
}
