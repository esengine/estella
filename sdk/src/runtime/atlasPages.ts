// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AsyncCache } from '../asset/AsyncCache';
import { ownedAssetLease, type AssetLease } from '../asset/AssetLease';
import type { Assets } from '../asset/Assets';
import type { TextureResult } from '../asset/AssetLoader';
import type { BasisTranscoder } from '../asset/compressed';
import { TextureLoader } from '../asset/loaders/TextureLoader';
import { atlasBindingSettings, atlasPageBinding } from '../asset/manifestBinding';
import { disposeAll } from '../util/disposeAll';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../wasm';
import { getResourceManager, requireResourceManager } from '../wasm/resourceManager';
import { provideTextureContent, withdrawTextureContent } from '../wasm/textureRefill';
import type { RuntimeAssetSource } from './runtimeAssets';

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
    if (assets) return read(path => assets.acquireTexture(path, false, 'imported'));

    const pages = new AsyncCache<AssetLease<TextureResult>>(lease => lease.release());
    let load: ReturnType<typeof standalonePageReader> | undefined;
    try {
        return await read(async path => {
            const staged = source.resolveRef?.(path) ?? path;
            const key = atlasPageBinding(staged, source.textureImportSettings?.(path));
            const lease = await pages.getOrLoad(key, () => {
                load ??= standalonePageReader(module, source, transcoder);
                return load(staged, key);
            });
            return lease.retain()!;
        });
    } finally {
        disposeAll([...pages.values()], lease => lease.release());
    }
}

function standalonePageReader(
    module: ESEngineModule | null, source: RuntimeAssetSource,
    transcoder: (() => Promise<BasisTranscoder | null>) | undefined,
) {
    const rm = requireResourceManager();
    const loader = new TextureLoader(module, {
        content: TextureContent.AtlasPage,
        resourceManager() {
            if (getResourceManager() !== rm) throw new Error('Resource manager changed while loading atlas page');
            return rm;
        },
    });
    loader.setPixelDecoder((file, flip) => source.decodePixels(file, flip));
    if (transcoder) loader.setTranscoderProvider(transcoder);
    if (source.compressedTexture) loader.setCompressedSource(async file => {
        const cooked = await source.compressedTexture!(file);
        // Skeleton attachments address imported pixels even while the editor cooks a compressed copy.
        return cooked === 'pending' ? null : cooked;
    });
    return (staged: string, key: string) => {
        const settings = atlasBindingSettings(key);
        return createHostPage(key, rm, async () => {
            const page = await loader.loadDetached(staged, { backend: source.backend }, false, settings);
            if (!page.handle) throw new Error(`Texture upload failed: ${staged}`);
            return page;
        });
    };
}

async function createHostPage(
    key: string, rm: CppResourceManager, upload: () => Promise<TextureResult>,
): Promise<AssetLease<TextureResult>> {
    const page = await upload();
    if (getResourceManager() !== rm) {
        rm.releaseTexture(page.handle);
        throw new Error(`Resource manager changed while loading atlas page: ${key}`);
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
    return ownedAssetLease(key, page.handle, page, () => {
        held = false;
        withdrawTextureContent(page.handle, refill);
        rm.releaseTexture(page.handle);
    });
}
