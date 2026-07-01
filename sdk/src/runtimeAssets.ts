// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeAssets.ts
 * @brief   Shared runtime asset primitives — the pluggable asset-fetch provider
 *          interface and the decoded-pixels → GL texture upload — used by the
 *          builder runtime loader and the spine scene loader (and any editor that
 *          drives the same load path). Kept in its own module so neither the
 *          runtime loader nor the spine loader has to import the other.
 */
import type { ESEngineModule } from './wasm';
import type { Backend } from './asset/Backend';
import { requireResourceManager } from './resourceManager';
import { withMalloc } from './wasmScratch';

/**
 * How a target supplies scene assets to the single `Assets` channel, built from
 * canonical parts instead of a bespoke provider:
 *   - `backend`  — canonical fetch (text/binary, incl. KTX2 containers)
 *   - `decodePixels` — platform image → RGBA (URL `<img>` can't reach `estella://`
 *     / WeChat package files / inlined data-URLs); `flip` is applied on upload via
 *     `createTextureFromPixels`, so decoders return top-first and ignore it
 *   - `resolveRef` — ref → resolved (extension-bearing) path; must run before the
 *     `TextureLoader` KTX2 extension check, so uuid/manifest lookup lives HERE, not
 *     in `backend.resolveUrl`. Omit for identity.
 * (Signature declared locally, not imported from TextureLoader — that module
 * imports from this one, so importing back would cycle.)
 */
export interface RuntimeAssetSource {
    backend: Backend;
    decodePixels(path: string, flip: boolean): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    resolveRef?(ref: string): string;
}

export interface TextureParams {
    filterMode?: string;
    wrapMode?: string;
}

const FILTER_MODE_MAP: Record<string, number> = { 'nearest': 0, 'linear': 1 };
const WRAP_MODE_MAP: Record<string, number> = { 'repeat': 0, 'clamp': 1, 'mirror': 2 };

/** Upload decoded RGBA pixels as a GL texture; returns the engine texture handle. */
export function createTextureFromPixels(
    module: ESEngineModule,
    result: { width: number; height: number; pixels: Uint8Array },
    flipY: boolean = true,
    params?: TextureParams,
): number {
    const rm = requireResourceManager();
    return withMalloc(module, result.pixels.length, ptr => {
        module.HEAPU8.set(result.pixels, ptr);

        if (params && (params.filterMode || params.wrapMode) && rm.createTextureEx) {
            const filter = FILTER_MODE_MAP[params.filterMode ?? 'linear'] ?? 1;
            const wrap = WRAP_MODE_MAP[params.wrapMode ?? 'clamp'] ?? 1;
            return rm.createTextureEx(result.width, result.height, ptr, result.pixels.length, 1, flipY, filter, wrap);
        }
        return rm.createTexture(result.width, result.height, ptr, result.pixels.length, 1, flipY);
    });
}

/**
 * Upload pixels into a sub-rectangle of an existing texture. Lets the dynamic
 * glyph atlas pack glyphs individually instead of re-uploading
 * the whole atlas. `pixels` must match the texture's format (RGBA8) and the
 * rect must lie inside the texture (the engine bounds-checks and no-ops if not).
 */
export function updateTextureSubregion(
    module: ESEngineModule,
    handle: number,
    x: number,
    y: number,
    width: number,
    height: number,
    pixels: Uint8Array,
): void {
    if (width <= 0 || height <= 0 || pixels.length === 0) return;
    const rm = requireResourceManager();
    if (!rm.updateTextureSubregion) return;
    withMalloc(module, pixels.length, ptr => {
        module.HEAPU8.set(pixels, ptr);
        rm.updateTextureSubregion(handle, x, y, width, height, ptr, pixels.length);
    });
}
