/**
 * @file    index.ts
 * @brief   WeChat MiniGame platform adapter
 */

/// <reference types="minigame-api-typings" />

import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
} from '../types';
import { wxFetch, polyfillFetch } from './fetch';
import { wxInstantiateWasm, polyfillWebAssembly } from './wasm';
import { wxReadFile, wxReadTextFile, wxFileExists } from './fs';

// =============================================================================
// WeChat Platform Adapter
// =============================================================================

class WeChatPlatformAdapter implements PlatformAdapter {
    readonly name = 'wechat' as const;

    async fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
        return wxFetch(url, options);
    }

    async readFile(path: string): Promise<ArrayBuffer> {
        return wxReadFile(path);
    }

    async readTextFile(path: string): Promise<string> {
        return wxReadTextFile(path);
    }

    async fileExists(path: string): Promise<boolean> {
        return wxFileExists(path);
    }

    async instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult> {
        if (typeof pathOrBuffer !== 'string') {
            throw new Error(
                'WeChat WXWebAssembly requires a file path string, not ArrayBuffer'
            );
        }
        return wxInstantiateWasm(pathOrBuffer, imports);
    }
}

// =============================================================================
// Initialization
// =============================================================================

let initialized = false;

/**
 * Initialize WeChat platform polyfills
 * Call this at the entry point of your game
 */
export function initWeChatPlatform(): void {
    if (initialized) return;
    initialized = true;

    polyfillFetch();
    polyfillWebAssembly();

    console.log('[ESEngine] WeChat platform initialized');
}

// =============================================================================
// Export
// =============================================================================

export const wechatAdapter = new WeChatPlatformAdapter();

export { polyfillFetch, polyfillWebAssembly };
export { wxReadFile, wxReadTextFile, wxFileExists, wxFileExistsSync, wxWriteFile } from './fs';
export { wxLoadImage, wxGetImagePixels, wxLoadImagePixels, type ImageLoadResult } from './image';
