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
    console.log(`[ESEngine] Platform: ${adapter.name}`);
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
export function getPlatformType(): 'web' | 'wechat' | null {
    return currentPlatform?.name ?? null;
}

/**
 * Check if running on WeChat
 */
export function isWeChat(): boolean {
    return currentPlatform?.name === 'wechat';
}

/**
 * Check if running on Web
 */
export function isWeb(): boolean {
    return currentPlatform?.name === 'web';
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

export async function platformInstantiateWasm(
    pathOrBuffer: string | ArrayBuffer,
    imports: WebAssembly.Imports
): Promise<import('./types').WasmInstantiateResult> {
    return getPlatform().instantiateWasm(pathOrBuffer, imports);
}

export function platformCreateCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    return getPlatform().createCanvas(width, height);
}

export function platformNow(): number {
    return getPlatform().now();
}
