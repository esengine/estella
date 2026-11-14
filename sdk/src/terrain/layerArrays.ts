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
import { isTextureRecipePath, renderTextureRecipe } from '../asset/textureRecipe';
import { isMiniGame } from '../platform';
import { createTextureArrayFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { log } from '../util/logger';
import { Material } from '../render/material';
import { packLayers, type LayerImage, type LayerSource, type PackedLayers, type TerrainLayerDef } from './layers';

/** An image file's pixels exactly as stored (no premultiply, no colour conversion), by its project path or reference. */
export async function imagePixelsAt(app: App, path: string): Promise<{ width: number; height: number; pixels: Uint8Array; wide?: Uint16Array } | null> {
    if (!app.hasResource(Assets)) return null;
    const assets = app.getResource(Assets);
    try {
        // A recipe is drawn, and is then pixels as a decoded image's are.
        if (isTextureRecipePath(path)) return await renderTextureRecipe(path, (p) => assets.fetchBinary(p));
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

export class ImageRevisions {
    private counts_ = new Map<string, number>();
    private stop_: (() => void) | null = null;

    of(app: App, paths: readonly string[]): string {
        if (!app.hasResource(Assets) || paths.every((p) => !p)) return '';
        const assets = app.getResource(Assets);
        this.stop_ ??= assets.onSourceChanged((path) => { this.counts_.set(path, (this.counts_.get(path) ?? 0) + 1); });
        return paths.map((p) => (p ? this.counts_.get(assets.sourceIdentity(p)) ?? 0 : 0)).join(',');
    }

    stop(): void {
        this.stop_?.();
        this.stop_ = null;
        this.counts_.clear();
    }
}

/** Reads the layer files `refs` (at most `most`) and packs them, at half the size on a minigame, whose memory is smaller. */
export async function readAndPackLayers(app: App, refs: readonly string[], most: number): Promise<PackedLayers> {
    const assets = app.getResource(Assets);
    if (refs.length > most) log.warn('terrain', `a ground draws ${most} layers at most; it names ${refs.length}`);
    // Every layer's pictures are asked for at once: one that is a recipe is drawn on a worker, and twelve drawn one after another kept a ground
    // out of sight for as long as all of them took in a row.
    const sources: LayerSource[] = await Promise.all(refs.slice(0, most).map(async (ref) => {
        const def = await assets.load<TerrainLayerDef>('terrain-layer', ref);
        const image = async (path: string | undefined): Promise<LayerImage | null> => {
            if (!path) return null;
            const got = await imagePixelsAt(app, path);
            if (!got) log.warn('terrain', `the texture ${path} of terrain layer ${ref} could not be read`);
            return got;
        };
        const [albedo, normal, mask] = await Promise.all([image(def.albedo), image(def.normal), image(def.mask)]);
        return { def, albedo, normal, mask };
    }));
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

/**
 * Reads the layer files `refs` (at most `most`), packs them into the albedo, normal and mask arrays, and hands them to the material
 * `instance` with what the shared layer code reads of them (layerSurfaceShader.ts: the count, each layer's tile and height blend). The
 * arrays made, for {@link releaseLayerArrays}; null if the engine refused one. `still` is asked once the packing is done: false, and
 * nothing is kept (the ground was made again meanwhile).
 */
export async function loadLayersInto(app: App, instance: number, refs: readonly string[], most: number, still: () => boolean): Promise<number[] | null> {
    const packed = await readAndPackLayers(app, refs, most);
    if (!still()) return null;
    const arrays = createLayerArrays(app, packed, ['albedo', 'normal', 'mask'], () => readAndPackLayers(app, refs, most));
    if (!arrays) return null;
    const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(instance, name, value); };
    set('u_albedoLayers', Material.tex(arrays[0]!));
    set('u_normalLayers', Material.tex(arrays[1]!));
    set('u_maskLayers', Material.tex(arrays[2]!));
    set('u_layerCount', packed.tiles.length);
    const t = (i: number): number => packed.tiles[i] ?? 4;
    set('u_tiles0', { x: t(0), y: t(1), z: t(2), w: t(3) });
    set('u_tiles1', { x: t(4), y: t(5), z: t(6), w: t(7) });
    const hb = (i: number): number => packed.heightBlends[i] ?? -1;
    set('u_heightBlends0', { x: hb(0), y: hb(1), z: hb(2), w: hb(3) });
    set('u_heightBlends1', { x: hb(4), y: hb(5), z: hb(6), w: hb(7) });
    return arrays;
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
