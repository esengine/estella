// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeAssets.ts
 * @brief   Shared runtime asset primitives — the pluggable asset-fetch provider
 *          interface and the decoded-pixels → GL texture upload — used by the
 *          builder runtime loader and the spine scene loader (and any editor that
 *          drives the same load path). Kept in its own module so neither the
 *          runtime loader nor the spine loader has to import the other.
import { linearColorSpace } from './env';
 */
import type { ESEngineModule } from './wasm';
import { linearColorSpace } from './env';
import type { Backend } from './asset/Backend';
import type { ParsedTextureImportSettings } from './asset/textureImportSettings';
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
    /**
     * The LOGICAL source path a ref was authored at (e.g. `assets/spine/hero.atlas`),
     * even after a content-addressed build renamed the physical file to a hash. A
     * loader that resolves a SIBLING by name — a Spine atlas naming its page PNG
     * relative to itself — needs the logical directory, which `resolveRef` (a build
     * path) has lost. Optional: a realm that stages under logical paths has nothing
     * to recover, and a caller falls back to the resolved path.
     */
    resolveAddress?(ref: string): string | null;
    /**
     * Every asset path this realm ships (logical, extension-bearing). Powers
     * content-driven discovery of assets NO scene references — locale string
     * tables (`.eslocale`), which Text binds by KEY, not path. Optional: a
     * realm without it simply can't auto-load such assets (the runtime loader
     * warns when a scene needs them).
     */
    listAssetPaths?(): string[];
    /**
     * Per-texture import settings (filter/wrap/sRGB and the 9-slice border) for a
     * ref. These belong to the ASSET, not to any scene that uses it, which is why
     * they arrive through the realm's source alongside `resolveRef` rather than
     * being copied into every scene that references the texture — a copy in the
     * scene goes stale the moment the `.meta` changes.
     *
     * Optional: a realm without it renders with loader defaults. Each realm has
     * the data already — the editor from its asset database, a cooked build from
     * the `importer` block the cook copies into the ship manifest.
     */
    textureImportSettings?(ref: string): ParsedTextureImportSettings | undefined;
}

export interface TextureParams {
    filterMode?: string;
    wrapMode?: string;
    /** sRGB-encoded color image (default true); see TextureImportSettings.srgb. */
    srgb?: boolean;
}

const FILTER_MODE_MAP: Record<string, number> = { 'nearest': 0, 'linear': 1 };
const WRAP_MODE_MAP: Record<string, number> = { 'repeat': 0, 'clamp': 1, 'mirror': 2 };

/** Upload decoded RGBA pixels as a GL texture; returns the engine texture handle.
 *  `module` is the wasm-heap marshalling vehicle; it may be null on the native
 *  (embedded-Dawn) backend, whose ResourceManager takes the bytes directly. */
export function createTextureFromPixels(
    module: ESEngineModule | null,
    result: { width: number; height: number; pixels: Uint8Array },
    flipY: boolean = true,
    params?: TextureParams,
): number {
    const rm = requireResourceManager();
    // Format code 2 = sRGB-encoded color (linear pipeline); 1 = plain RGBA8.
    const format = linearColorSpace() && (params?.srgb ?? true) ? 2 : 1;
    // Native path: no wasm heap — the ResourceManager uploads the bytes itself.
    // The wasm embind object has no createTextureFromBytes, so web falls through
    // to the heap path below unchanged.
    if (rm.createTextureFromBytes) {
        const filter = params?.filterMode ? FILTER_MODE_MAP[params.filterMode] ?? 1 : undefined;
        const wrap = params?.wrapMode ? WRAP_MODE_MAP[params.wrapMode] ?? 1 : undefined;
        return rm.createTextureFromBytes(result.width, result.height, result.pixels, format, flipY, filter, wrap);
    }
    if (!module) {
        throw new Error('createTextureFromPixels: a wasm module is required for the heap upload path');
    }
    return withMalloc(module, result.pixels.length, ptr => {
        module.HEAPU8.set(result.pixels, ptr);

        if (params && (params.filterMode || params.wrapMode) && rm.createTextureEx) {
            const filter = FILTER_MODE_MAP[params.filterMode ?? 'linear'] ?? 1;
            const wrap = WRAP_MODE_MAP[params.wrapMode ?? 'clamp'] ?? 1;
            return rm.createTextureEx(result.width, result.height, ptr, result.pixels.length, format, flipY, filter, wrap);
        }
        return rm.createTexture(result.width, result.height, ptr, result.pixels.length, format, flipY);
    });
}

/**
 * Upload pixels into a sub-rectangle of an existing texture. Lets the dynamic
 * glyph atlas pack glyphs individually instead of re-uploading
 * the whole atlas. `pixels` must match the texture's format (RGBA8) and the
 * rect must lie inside the texture (the engine bounds-checks and no-ops if not).
 */
export function updateTextureSubregion(
    module: ESEngineModule | null,
    handle: number,
    x: number,
    y: number,
    width: number,
    height: number,
    pixels: Uint8Array,
): void {
    if (width <= 0 || height <= 0 || pixels.length === 0) return;
    const rm = requireResourceManager();
    // Native byte path (no wasm heap); web embind lacks it and takes the heap path.
    if (rm.updateTextureSubregionFromBytes) {
        rm.updateTextureSubregionFromBytes(handle, x, y, width, height, pixels);
        return;
    }
    if (!rm.updateTextureSubregion || !module) return;
    withMalloc(module, pixels.length, ptr => {
        module.HEAPU8.set(pixels, ptr);
        rm.updateTextureSubregion(handle, x, y, width, height, ptr, pixels.length);
    });
}
