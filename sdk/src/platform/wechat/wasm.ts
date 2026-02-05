/**
 * @file    wasm.ts
 * @brief   WebAssembly adapter for WeChat MiniGame using WXWebAssembly
 */

/// <reference types="minigame-api-typings" />

import type { WasmInstantiateResult } from '../types';

// =============================================================================
// WeChat WASM Implementation
// =============================================================================

/**
 * Instantiate WASM using WXWebAssembly
 * Note: WeChat requires path to be a string (package-relative path), not ArrayBuffer
 */
export async function wxInstantiateWasm(
    path: string,
    imports: WebAssembly.Imports
): Promise<WasmInstantiateResult> {
    if (typeof WXWebAssembly === 'undefined') {
        throw new Error('WXWebAssembly is not available. Requires WeChat base library >= 2.13.0');
    }

    // WeChat requires the path to be a package-relative path string
    // e.g., "esengine.wasm" not "/esengine.wasm" or ArrayBuffer
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await WXWebAssembly.instantiate(normalizedPath, imports as any);
        return {
            // WXWebAssembly.instantiate returns { instance, module } but types are slightly different
            instance: (result as any).instance ?? result,
            module: (result as any).module,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`WXWebAssembly.instantiate failed for "${normalizedPath}": ${message}`);
    }
}

// =============================================================================
// Global WebAssembly Polyfill
// =============================================================================

/**
 * Polyfill global WebAssembly with WXWebAssembly
 * This allows existing code using WebAssembly.instantiate to work on WeChat
 */
export function polyfillWebAssembly(): void {
    if (typeof WXWebAssembly !== 'undefined' && typeof WebAssembly === 'undefined') {
        (globalThis as any).WebAssembly = {
            instantiate: async (
                bufferOrPath: BufferSource | string,
                imports?: WebAssembly.Imports
            ) => {
                if (typeof bufferOrPath !== 'string') {
                    throw new Error(
                        'WeChat WXWebAssembly requires a file path string, not ArrayBuffer. ' +
                        'Use platform adapter instead of direct WebAssembly.instantiate.'
                    );
                }
                return wxInstantiateWasm(bufferOrPath, imports ?? {});
            },
            compile: () => {
                throw new Error('WebAssembly.compile is not supported in WeChat MiniGame');
            },
            compileStreaming: () => {
                throw new Error('WebAssembly.compileStreaming is not supported in WeChat MiniGame');
            },
            instantiateStreaming: () => {
                throw new Error('WebAssembly.instantiateStreaming is not supported in WeChat MiniGame');
            },
            validate: () => {
                throw new Error('WebAssembly.validate is not supported in WeChat MiniGame');
            },
            Module: class {} as any,
            Instance: class {} as any,
            Memory: class {} as any,
            Table: class {} as any,
            Global: class {} as any,
            CompileError: Error,
            LinkError: Error,
            RuntimeError: Error,
        };
    }
}
