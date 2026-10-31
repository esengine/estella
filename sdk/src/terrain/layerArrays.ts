// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layerArrays.ts
 * @brief   A ground's layer files (`.esterrainlayer`) read and packed into the texture arrays its shader samples.
 */
import type { App } from '../app/app';
import { Assets } from '../asset/AssetPlugin';
import { platformLoadImagePixels } from '../platform/base';
import { decodeImagePixels } from '../asset/imageDecode';
import { decodePngData } from '../asset/pngData';
import { isMiniGame } from '../platform';
import { createTextureArrayFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { log } from '../util/logger';
import { packLayers, type LayerImage, type LayerSource, type PackedLayers, type TerrainLayerDef } from './layers';

/** An image file's pixels exactly as stored (no premultiply, no colour conversion), by its project path or reference. */
export async function imagePixelsAt(app: App, path: string): Promise<{ width: number; height: number; pixels: Uint8Array; wide?: Uint16Array } | null> {
    if (!app.hasResource(Assets)) return null;
    const assets = app.getResource(Assets);
    try {
        // The bytes the asset layer would load, decoded unmodified (no premultiply, no colour conversion): a height is data.
        if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
            const bytes = new Uint8Array(await assets.fetchBinary(path));
            return await decodePngData(bytes) ?? await decodeImagePixels(new Blob([bytes]));
        }
        const image = await platformLoadImagePixels(assets.resolveLoadPath(path));
        return { width: image.width, height: image.height, pixels: image.pixels };
    } catch (e) {
        log.warn('terrain', `reading ${path} failed`, e);
        return null;
    }
}

/** What a ground's layers came to: the albedo and normal arrays (engine texture handles) and how many world units a repeat of each layer covers. */
export interface LayerArrays {
    albedo: number;
    normal: number;
    tiles: number[];
}

/** Reads the layer files `refs` (at most `most`) and packs them, at half the size on a minigame, whose memory is smaller. */
export async function readAndPackLayers(app: App, refs: readonly string[], most: number): Promise<PackedLayers> {
    const assets = app.getResource(Assets);
    if (refs.length > most) log.warn('terrain', `a ground draws ${most} layers at most; it names ${refs.length}`);
    const sources: LayerSource[] = [];
    for (const ref of refs.slice(0, most)) {
        const def = await assets.load<TerrainLayerDef>('terrain-layer', ref);
        const image = async (path: string | undefined): Promise<LayerImage | null> => {
            if (!path) return null;
            const got = await imagePixelsAt(app, path);
            if (!got) log.warn('terrain', `the texture ${path} of terrain layer ${ref} could not be read`);
            return got;
        };
        sources.push({ def, albedo: await image(def.albedo), normal: await image(def.normal), mask: await image(def.mask) });
    }
    return packLayers(sources, isMiniGame() ? 512 : 1024);
}

type LayerKind = 'albedo' | 'normal' | 'mask';

/**
 * One texture array per kind from `packed`. The device keeps no copy of them (four layers of three kinds are 48 MiB): after a device loss
 * `repack` packs the sources again, once for all the kinds, and each kind's layers are moved behind the handle it had, which is when the
 * device counts them restored. Null, with nothing left made, if the engine refuses one.
 */
export function createLayerArrays(app: App, packed: PackedLayers, kinds: readonly LayerKind[],
                                  repack: () => Promise<PackedLayers>): number[] | null {
    const make = (layers: Uint8Array[], kind: LayerKind, content: TextureContent): number => createTextureArrayFromPixels(app.wasmModule,
        { width: packed.size, height: packed.size, layers }, content, { filterMode: 'linear', wrapMode: 'repeat', mipmaps: true, srgb: kind === 'albedo' });
    const handles = kinds.map((kind) => make(packed[kind], kind, TextureContent.Composed));
    if (handles.some((h) => !h)) {
        releaseLayerArrays(handles);
        return null;
    }
    let again: Promise<PackedLayers> | null = null;
    let waiting = 0;
    handles.forEach((handle, i) => provideTextureContent(handle, async () => {
        if (!again) { again = repack(); waiting = handles.length; }
        try {
            const fresh = make((await again)[kinds[i]!], kinds[i]!, TextureContent.Transient);
            const rm = getResourceManager();
            if (!fresh || !rm?.adoptTextureContent) return false;
            const moved = rm.adoptTextureContent(handle, fresh);
            rm.releaseTexture(fresh);
            return moved;
        } finally {
            if (--waiting === 0) again = null;
        }
    }));
    return handles;
}

/** Reads the layer files `refs` and packs them; null if the engine refuses the arrays. At most `most` layers are packed. */
export async function loadLayerArrays(app: App, refs: readonly string[], most: number): Promise<LayerArrays | null> {
    const packed = await readAndPackLayers(app, refs, most);
    const made = createLayerArrays(app, packed, ['albedo', 'normal'], () => readAndPackLayers(app, refs, most));
    return made ? { albedo: made[0]!, normal: made[1]!, tiles: packed.tiles } : null;
}

/** Gives the engine back arrays made by {@link createLayerArrays}. */
export function releaseLayerArrays(handles: readonly number[]): void {
    const rm = getResourceManager();
    for (const handle of handles) {
        if (!handle) continue;
        withdrawTextureContent(handle);
        rm?.releaseTexture(handle);
    }
}
