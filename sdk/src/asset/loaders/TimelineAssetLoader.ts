// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineAssetLoader.ts
 * @brief   Loads a `.estimeline` into the timeline registry, under every ref a
 *          component may spell it as. Same shape as the anim-clip loader: the
 *          owner owns the slot, the era owns the textures it resolved.
 */
import type { AssetLoader, LoadContext, TimelineResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../../timeline/TimelineLoader';
import type { PublishedTimeline } from '../../timeline/TimelineTypes';
import { log } from '../../util/logger';

export class TimelineAssetLoader implements AssetLoader<TimelineResult> {
    readonly type = 'timeline';
    readonly extensions = ['.estimeline'];

    readonly registry: RegistryAssetLoader<TimelineResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<TimelineResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const asset = parseTimelineAsset(text);
            const textureHandles = new Map<string, number>();

            const { timelines, textures } = extractTimelineAssetPaths(asset);
            for (const ref of timelines) {
                try {
                    await ctx.acquireAsset('timeline', ref);
                } catch (e) {
                    log.warn('asset', `${path}: failed to load the sequence ${ref}`, e);
                }
            }

            for (const texPath of textures) {
                try {
                    const lease = await ctx.acquireTexture(texPath, true);
                    textureHandles.set(texPath, lease.value.handle);
                } catch (e) {
                    log.warn('asset', `Failed to load texture: ${texPath}`, e);
                    textureHandles.set(texPath, 0);
                }
            }
            const published: PublishedTimeline = { asset, textureHandles };
            return { published, value: { timelineId: path } };
        },
        // Nothing: the slot holds the era, and the timeline system reads it
        // there. A module-level "active registry" answered with whichever app
        // built its plugin last.
    };
}
