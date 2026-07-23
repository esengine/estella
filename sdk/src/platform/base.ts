// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    base.ts
 * @brief   Base platform adapter - no platform-specific code
 */

import type { PlatformAdapter } from './types';

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
 * Check if running on any mini-game host (WeChat, Douyin, …) — the capability
 * family that shares the packaged-filesystem / subpackage / no-DOM model.
 */
export function isMiniGame(): boolean {
    const name = currentPlatform?.name;
    return name === 'wechat' || name === 'douyin';
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

export function platformNow(): number {
    return getPlatform().now();
}

export function platformCreateAudioBackend(): import('../audio/PlatformAudioBackend').PlatformAudioBackend {
    return getPlatform().createAudioBackend();
}

/** Download an on-demand subpackage by name (resolves immediately on platforms
 *  with no subpackage concept, e.g. web). The single channel lazy asset groups
 *  use before loading their assets. */
export function platformLoadSubpackage(name: string): Promise<void> {
    const p = getPlatform();
    return p.loadSubpackage ? p.loadSubpackage(name) : Promise.resolve();
}

/** Subscribe to OS memory-pressure warnings (wx.onMemoryWarning on WeChat).
 *  Returns an unsubscribe. On platforms without a pressure signal the callback
 *  simply never fires. Tolerates an uninitialized platform (tests). */
export function platformOnMemoryWarning(callback: () => void): () => void {
    if (!isPlatformInitialized()) return () => {};
    const p = getPlatform();
    return p.onMemoryWarning ? p.onMemoryWarning(callback) : () => {};
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
