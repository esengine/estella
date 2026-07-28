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
// native core has no wasm heap, so the JS-owned bytes go straight to the same
// engine entry point (rm_createTextureEx), whose QuickJS wrapper copies them and
// hands the binding a real pointer. This mirrors how createNativeRegistry composes
// the ECS over es_* host globals; the same single generated/marshalling
// philosophy, one more backend. The upload helpers (runtimeAssets, TextureLoader)
// prefer this byte method when present, so web (embind, no such method) stays
// byte-identical.

import type { CppResourceManager } from '../../wasm';
import { RESOURCE_BINDINGS, TEXT_BINDINGS } from './nativeBindings';

/** `rm_createTextureEx` filter/wrap codes, for the case with no import settings.
 *  They spell out what the plain `rm_createTexture` path does, so the two agree. */
const FILTER_LINEAR = 1;
const WRAP_CLAMP_TO_EDGE = 1;

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
 *   * es_rm_createTextureEx(w, h, pixels, len, format, flip, filter, wrap) -> handle
 *   * es_rm_releaseTexture(handle)
 *   * es_getTextureDimensions(handle) -> { width, height } | null
 * and optionally es_rm_updateTextureSubregion / es_setTextureBudget. The `rm_`
 * names are the engine's own entry points, generated for QuickJS from the same
 * declarations embind registers — see {@link RESOURCE_BINDINGS}.
 *
 * Only the methods the native asset path actually calls are implemented; the
 * wasm-specific ones (heap-pointer createTexture, registerExternalTexture,
 * bitmap-font glyph upload) throw if reached, and the residency /
 * stats hooks the SDK optional-chains are simply omitted — so a texture that lost
 * its last reference re-decodes instead of reviving (correct, just not yet cached).
 */
export function createNativeResourceManager(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): CppResourceManager {
    const rm: Partial<CppResourceManager> = {
        // The module-free upload the SDK prefers on native (no wasm heap). The
        // engine entry point is the web's `rm_createTextureEx`: it takes a byte
        // COUNT beside the buffer, because on the web the buffer is a heap offset.
        // Absent import settings mean the defaults the plain `rm_createTexture`
        // path applies — Linear filtering, ClampToEdge wrap (Texture::create's
        // pixel overload) — so a texture with no settings uploads identically.
        createTextureFromBytes: (
            width, height, pixels, format, flipY, filterMode, wrapMode,
        ): number =>
            hostCall(scope, RESOURCE_BINDINGS.createTexture,
                [width, height, pixels, pixels.length, format, flipY,
                 filterMode ?? FILTER_LINEAR, wrapMode ?? WRAP_CLAMP_TO_EDGE]) as number,

        // The host transcodes KTX2 (basis) and uploads the compressed blocks; it
        // returns { id, width, height } — expose it as { handle, ... }.
        createTextureFromKTX2: (bytes, srgb) => {
            const r = hostCall(scope, RESOURCE_BINDINGS.createTextureKTX2, [bytes, srgb]) as
                { id: number; width: number; height: number } | null;
            return r ? { handle: r.id, width: r.width, height: r.height } : null;
        },

        updateTextureSubregionFromBytes: (handle, x, y, width, height, pixels): void => {
            hostCallOpt(scope, TEXT_BINDINGS.updateTextureSubregion,
                [handle, x, y, width, height, pixels, pixels.length]);
        },

        // The id a draw command binds a texture by. Named for GL because that is
        // where it started, but the engine returns `Texture::getId()` on every
        // backend — the glyph atlas passes it straight to the text batch. The
        // host reads it off the same ResourceManager it created the texture in.
        getTextureGLId: (handle): number =>
            hostCall(scope, TEXT_BINDINGS.getTextureRenderId, [handle]) as number,

        releaseTexture: (handle): void => {
            hostCallOpt(scope, RESOURCE_BINDINGS.releaseTexture, [handle]);
        },

        // Register the handle under a logical path so a later load-by-path revives
        // the same texture instead of re-decoding. The web RM does this in its
        // loaders; the Spine loader calls it directly (not through the optional
        // TextureLoader path), so the native RM must answer it or Spine textures
        // fail to bind. hostCallOpt: a host that did not compile the entry point
        // simply skips the cache registration.
        registerTextureWithPath: (handle, path): void => {
            hostCallOpt(scope, RESOURCE_BINDINGS.registerTextureWithPath, [handle, path]);
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

    return rm as CppResourceManager;
}
