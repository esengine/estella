/**
 * @file    runtimeAssets.ts
 * @brief   Shared runtime asset primitives — the pluggable asset-fetch provider
 *          interface and the decoded-pixels → GL texture upload — used by the
 *          builder runtime loader and the spine scene loader (and any editor that
 *          drives the same load path). Kept in its own module so neither the
 *          runtime loader nor the spine loader has to import the other.
 */
import type { ESEngineModule } from './wasm';
import { requireResourceManager } from './resourceManager';
import { withMalloc } from './wasmScratch';

/** How the loader fetches scene assets on a given target (http, virtual FS, …). */
export interface RuntimeAssetProvider {
    loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    loadPixelsRaw?(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    readText(ref: string): string | Promise<string>;
    readBinary(ref: string): Uint8Array | Promise<Uint8Array>;
    resolvePath(ref: string): string;
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
