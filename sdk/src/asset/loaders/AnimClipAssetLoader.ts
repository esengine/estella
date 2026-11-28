// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimClipAssetLoader.ts
 * @brief   Loads a `.esanim` into the sprite-animation registry, under every ref
 *          a component may spell it as.
 *
 * A clip is named by ref, not held by handle, so what an owner owns is the SLOT
 * (see registryAssets.ts). The frame textures belong to the ERA that baked them
 * in — nothing else can say when they stop being needed.
 */
import type { AssetLoader, LoadContext, AnimClipResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { bakeAnimClip, extractAnimClipTexturePaths, parseAnimClipAsset, type AnimClipTexture } from '../../animation/AnimClipLoader';
import { log } from '../../util/logger';

export class AnimClipAssetLoader implements AssetLoader<AnimClipResult> {
    readonly type = 'anim-clip';
    readonly bindsTextures = true;
    readonly extensions = ['.esanim'];

    readonly registry: RegistryAssetLoader<AnimClipResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AnimClipResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const data = parseAnimClipAsset(JSON.parse(text));
            const document = ctx.sourceAddressOf?.(path) ?? path;
            const textures = new Map<string, AnimClipTexture>();

            for (const ref of extractAnimClipTexturePaths(data)) {
                const texPath = ctx.catalog.resolveDocumentRef(document, ref, ctx.assetTypeOf);
                try {
                    const lease = await ctx.acquireTexture(texPath, true, 'imported');
                    const atlas = ctx.getAtlasFrame ? ctx.getAtlasFrame(texPath) : ctx.catalog.getAtlasFrame(texPath);
                    const sourceSize = atlas ? undefined : ctx.catalog.getSourceImageSize(texPath);
                    const width = atlas?.frame.w ?? sourceSize?.width ?? lease.value.width;
                    const height = atlas?.frame.h ?? sourceSize?.height ?? lease.value.height;
                    const size = width > 0 && height > 0 ? { x: width, y: height } : undefined;
                    textures.set(ref, { handle: lease.value.handle, size, atlas });
                } catch (e) {
                    log.warn('asset', `Failed to load texture: ${texPath}`, e);
                }
            }
            return {
                published: bakeAnimClip(path, data, ref => textures.get(ref)),
                value: { clipId: path },
            };
        },
        // Nothing: the slot holds the era, and this app's sprite animation
        // reads it there. A clip registered into the API as well would be a
        // second copy of "which clip is walk.esanim now".
    };
}
