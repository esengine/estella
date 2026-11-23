// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AsyncCache } from '../asset/AsyncCache';
import { ownedAssetLease, type AssetLease } from '../asset/AssetLease';
import type { Assets } from '../asset/Assets';
import type { TextureResult } from '../asset/AssetLoader';
import { isKtx2Path, type BasisTranscoder } from '../asset/compressed';
import { samplesAsSrgb } from '../ecs/env';
import { disposeAll } from '../util/disposeAll';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../wasm';
import { getResourceManager, requireResourceManager } from '../wasm/resourceManager';
import { provideTextureContent, withdrawTextureContent } from '../wasm/textureRefill';
import { createTextureFromPixels, type RuntimeAssetSource } from './runtimeAssets';

export type AcquireAtlasPage = (path: string) => Promise<AssetLease<TextureResult>>;

/** An atlas names its pages relative to its authored location. */
export function atlasPagePath(atlas: string, name: string): string {
    return atlas.slice(0, atlas.lastIndexOf('/') + 1) + name;
}

/** An App shares raw textures across scenes. A standalone read shares uploads within its batch.
 * Each skeleton takes its own receipt, including when two skeletons use the same page. */
export async function withAtlasPages<T>(
    module: ESEngineModule | null, source: RuntimeAssetSource,
    transcoder: (() => Promise<BasisTranscoder | null>) | undefined,
    read: (acquire: AcquireAtlasPage) => Promise<T>, assets?: Pick<Assets, 'acquireTexture'>,
): Promise<T> {
    if (assets) return read(path => assets.acquireTexture(path, false));

    const pages = new AsyncCache<AssetLease<TextureResult>>(lease => lease.release());
    try {
        return await read(async path => {
            const staged = source.resolveRef?.(path) ?? path;
            const lease = await pages.getOrLoad(staged, () => createHostPage(module, source, staged, transcoder));
            return lease.retain()!;
        });
    } finally {
        disposeAll([...pages.values()], lease => lease.release());
    }
}

async function createHostPage(
    module: ESEngineModule | null, source: RuntimeAssetSource, staged: string,
    transcoder: (() => Promise<BasisTranscoder | null>) | undefined,
): Promise<AssetLease<TextureResult>> {
    const rm = requireResourceManager();
    const upload = () => uploadAtlasPage(module, rm, source, staged, transcoder);
    const page = await upload();
    if (getResourceManager() !== rm) {
        rm.releaseTexture(page.handle);
        throw new Error(`Resource manager changed while loading atlas page: ${staged}`);
    }
    let held = true;
    const active = () => held && getResourceManager() === rm;
    const refill = async (): Promise<boolean> => {
        if (!active()) return false;
        const fresh = await upload();
        try { return active() && (rm.adoptTextureContent?.(page.handle, fresh.handle) ?? false); }
        finally { rm.releaseTexture(fresh.handle); }
    };
    provideTextureContent(page.handle, refill);
    return ownedAssetLease(staged, page.handle, page, () => {
        held = false;
        withdrawTextureContent(page.handle, refill);
        rm.releaseTexture(page.handle);
    });
}

async function uploadAtlasPage(
    module: ESEngineModule | null, rm: CppResourceManager, source: RuntimeAssetSource,
    staged: string, transcoderProvider: (() => Promise<BasisTranscoder | null>) | undefined,
): Promise<TextureResult> {
    const checkDevice = () => {
        if (getResourceManager() !== rm) throw new Error(`Resource manager changed while loading atlas page: ${staged}`);
    };
    let decoded;
    if (isKtx2Path(staged)) {
        const bytes = new Uint8Array(await source.backend.fetchBinary(staged));
        if (rm.createTextureFromKTX2) {
            checkDevice();
            const result = rm.createTextureFromKTX2(bytes, samplesAsSrgb());
            if (!result?.handle) throw new Error(`KTX2 transcode failed: ${staged}`);
            return result;
        }
        const transcoder = await transcoderProvider?.();
        if (!transcoder) throw new Error('KTX2 atlas page but no Basis transcoder in this realm');
        const rgba = await transcoder.transcodeToRgba(bytes);
        if (!rgba) throw new Error(`KTX2 transcode failed: ${staged}`);
        decoded = { width: rgba.width, height: rgba.height, pixels: rgba.data };
    } else {
        decoded = await source.decodePixels(staged, false);
    }
    checkDevice();
    const handle = createTextureFromPixels(module, decoded, TextureContent.AtlasPage, false, undefined, rm);
    if (!handle) throw new Error(`Texture upload failed: ${staged}`);
    return { handle, width: decoded.width, height: decoded.height };
}
