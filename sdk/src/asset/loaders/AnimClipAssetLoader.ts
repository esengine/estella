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
import { AssetScope } from '../AssetLease';
import { extractAnimClipTexturePaths, parseAnimClipAsset, parseAnimClipData } from '../../animation/AnimClipLoader';
import { log } from '../../util/logger';

export class AnimClipAssetLoader implements AssetLoader<AnimClipResult> {
    readonly type = 'anim-clip';
    readonly extensions = ['.esanim'];

    readonly registry: RegistryAssetLoader<AnimClipResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AnimClipResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const data = parseAnimClipAsset(JSON.parse(text));
            const dependencies = new AssetScope();
            const textureHandles = new Map<string, number>();

            for (const texPath of extractAnimClipTexturePaths(data)) {
                try {
                    const lease = await ctx.acquireTexture(texPath, true);
                    dependencies.add(lease);
                    textureHandles.set(texPath, lease.value.handle);
                } catch (e) {
                    log.warn('asset', `Failed to load texture: ${texPath}`, e);
                    textureHandles.set(texPath, 0);
                }
            }
            return {
                published: parseAnimClipData(path, data, textureHandles),
                value: { clipId: path },
                dependencies,
            };
        },
        // Nothing: the slot holds the era, and this app's sprite animation
        // reads it there. A clip registered into the API as well would be a
        // second copy of "which clip is walk.esanim now".
    };
}
