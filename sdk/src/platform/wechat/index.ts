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

    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
        const canvas = wx.createCanvas() as unknown as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    now(): number {
        return Date.now();
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
    polyfillTextEncoder();

    console.log('[ESEngine] WeChat platform initialized');
}

function polyfillTextEncoder(): void {
    const g = globalThis as any;
    if (typeof g.TextEncoder === 'undefined') {
        g.TextEncoder = class {
            encode(str: string): Uint8Array {
                const buf = new ArrayBuffer(str.length * 3);
                const bytes = new Uint8Array(buf);
                let pos = 0;
                for (let i = 0; i < str.length; i++) {
                    let code = str.charCodeAt(i);
                    if (code < 0x80) {
                        bytes[pos++] = code;
                    } else if (code < 0x800) {
                        bytes[pos++] = 0xc0 | (code >> 6);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    } else if (code >= 0xd800 && code <= 0xdbff) {
                        const next = str.charCodeAt(++i);
                        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
                        bytes[pos++] = 0xf0 | (code >> 18);
                        bytes[pos++] = 0x80 | ((code >> 12) & 0x3f);
                        bytes[pos++] = 0x80 | ((code >> 6) & 0x3f);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    } else {
                        bytes[pos++] = 0xe0 | (code >> 12);
                        bytes[pos++] = 0x80 | ((code >> 6) & 0x3f);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    }
                }
                return bytes.subarray(0, pos);
            }
        };
    }
    if (typeof g.TextDecoder === 'undefined') {
        g.TextDecoder = class {
            decode(buf: ArrayBuffer | Uint8Array): string {
                const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
                let str = '';
                for (let i = 0; i < bytes.length;) {
                    const b = bytes[i];
                    if (b < 0x80) {
                        str += String.fromCharCode(b);
                        i++;
                    } else if ((b & 0xe0) === 0xc0) {
                        str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
                        i += 2;
                    } else if ((b & 0xf0) === 0xe0) {
                        str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
                        i += 3;
                    } else {
                        const code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
                        const offset = code - 0x10000;
                        str += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
                        i += 4;
                    }
                }
                return str;
            }
        };
    }
}

// =============================================================================
// Export
// =============================================================================

export const wechatAdapter = new WeChatPlatformAdapter();

export { polyfillFetch, polyfillWebAssembly };
export { wxReadFile, wxReadTextFile, wxFileExists, wxFileExistsSync, wxWriteFile } from './fs';
export { wxLoadImage, wxGetImagePixels, wxLoadImagePixels, type ImageLoadResult } from './image';
