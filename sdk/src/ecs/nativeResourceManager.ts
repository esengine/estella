// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native ResourceManager — the embedded-Dawn sibling of the embind-bound C++
// ResourceManager. It presents the CppResourceManager surface the SDK's asset
// pipeline consumes (createTexture / releaseTexture / getTextureDimensions), so
// the real Assets channel + TextureLoader run on the native core unchanged.
//
// The one wasm-specific op in the texture path — marshal RGBA into the wasm heap,
// then call embind createTexture(ptr) — becomes createTextureFromBytes here: the
// native core has no wasm heap, so the host uploads the JS-owned bytes directly
// (es_createTexture). This mirrors how createNativeRegistry composes the ECS over
// es_* host globals; the same single generated/marshalling philosophy, one more
// backend. The upload helpers (runtimeAssets, TextureLoader) prefer this byte
// method when present, so web (embind, no such method) stays byte-identical.

import type { CppResourceManager } from '../wasm';
import { RESOURCE_BINDINGS } from './nativeBindings';

/** Invoke a host-provided global by name; throws if the host did not bind it
 *  (these are part of the native ResourceManager contract). */
function hostCall(scope: Record<string, unknown>, name: string, args: unknown[]): unknown {
    const fn = scope[name];
    if (typeof fn !== 'function') {
        throw new Error(`native host binding "${name}" is missing`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
}

/** Optional host global — returns undefined (and does nothing) when unbound, for
 *  the residency/budget hooks a minimal host may not provide yet. */
function hostCallOpt(scope: Record<string, unknown>, name: string, args: unknown[]): unknown {
    const fn = scope[name];
    if (typeof fn !== 'function') return undefined;
    return (fn as (...a: unknown[]) => unknown)(...args);
}

/**
 * Build the CppResourceManager over the host's native texture bindings. `scope`
 * holds the globals (the QuickJS global object on a device; a plain object in
 * tests): the host binds
 *   * es_createTexture(w, h, pixels, format, flip, filter?, wrap?) -> handle
 *   * es_releaseTexture(handle)
 *   * es_getTextureDimensions(handle) -> { width, height } | null
 * and optionally es_updateTextureSubregion / es_setTextureBudget.
 *
 * Only the methods the native asset path actually calls are implemented; the
 * wasm/GL-specific ones (heap-pointer createTexture, registerExternalTexture,
 * GL id lookup, bitmap-font glyph upload) throw if reached, and the residency /
 * stats hooks the SDK optional-chains are simply omitted — so a texture that lost
 * its last reference re-decodes instead of reviving (correct, just not yet cached).
 */
export function createNativeResourceManager(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): CppResourceManager {
    const rm: Partial<CppResourceManager> = {
        // The module-free upload the SDK prefers on native (no wasm heap).
        createTextureFromBytes: (
            width, height, pixels, format, flipY, filterMode, wrapMode,
        ): number =>
            hostCall(scope, RESOURCE_BINDINGS.createTexture,
                [width, height, pixels, format, flipY, filterMode, wrapMode]) as number,

        // The host transcodes KTX2 (basis) and uploads the compressed blocks; it
        // returns { id, width, height } — expose it as { handle, ... }.
        createTextureFromKTX2: (bytes, srgb) => {
            const r = hostCall(scope, RESOURCE_BINDINGS.createTextureKTX2, [bytes, srgb]) as
                { id: number; width: number; height: number } | null;
            return r ? { handle: r.id, width: r.width, height: r.height } : null;
        },

        updateTextureSubregionFromBytes: (handle, x, y, width, height, pixels): void => {
            hostCallOpt(scope, 'es_updateTextureSubregion', [handle, x, y, width, height, pixels]);
        },

        releaseTexture: (handle): void => {
            hostCallOpt(scope, RESOURCE_BINDINGS.releaseTexture, [handle]);
        },

        getTextureDimensions: (handle): { width: number; height: number } | null =>
            (hostCallOpt(scope, RESOURCE_BINDINGS.getTextureDimensions, [handle]) as
                { width: number; height: number } | null | undefined) ?? null,

        // The engine applies RuntimeConfig.textureCacheBudget at startup; forward it
        // to the native pool when the host wires it, else no-op (eviction off).
        setTextureBudget: (bytes): void => {
            hostCallOpt(scope, 'es_setTextureBudget', [bytes]);
        },
    };

    // The heap-pointer / GL / bitmap-font surface is not reachable on native (the
    // asset path takes the byte upload above); fail loud rather than silently
    // corrupt if some path ever calls one.
    const unsupported = (name: string) => (): never => {
        throw new Error(`native ResourceManager: ${name} is not supported (no wasm heap / GL on the embedded-Dawn core)`);
    };
    rm.createTexture = unsupported('createTexture(ptr)');
    rm.createTextureEx = unsupported('createTextureEx(ptr)');
    rm.registerExternalTexture = unsupported('registerExternalTexture');
    rm.registerExternalTextureSized = unsupported('registerExternalTextureSized');
    rm.getTextureGLId = unsupported('getTextureGLId');

    return rm as CppResourceManager;
}
