// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineAssetLoader.ts
 * @brief   Loads a `.estimeline` into the timeline registry, under every ref a
 *          component may spell it as. Each publication owns its frame textures,
 *          nested timelines and prepared spawn prefabs.
 */
import type { AssetLoader, LoadContext, TimelineResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../../timeline/TimelineLoader';
import type { PublishedTimeline } from '../../timeline/TimelineTypes';
import type { PreparedPrefab } from '../../prefab/preparedPrefab';
import type { AtlasFrameInfo } from '../Catalog';
import { log } from '../../util/logger';

export class TimelineAssetLoader implements AssetLoader<TimelineResult> {
    readonly type = 'timeline';
    readonly bindsTextures = true;
    readonly extensions = ['.estimeline'];

    readonly registry: RegistryAssetLoader<TimelineResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<TimelineResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const asset = parseTimelineAsset(text);
            const textureHandles = new Map<string, number>();
            const textureAtlases = new Map<string, AtlasFrameInfo>();
            const document = ctx.sourceAddressOf?.(path) ?? path;

            const { timelines, textures, prefabs } = extractTimelineAssetPaths(asset);
            for (const ref of timelines) {
                try {
                    await ctx.acquireAsset('timeline', ref);
                } catch (e) {
                    log.warn('asset', `${path}: failed to load the sequence ${ref}`, e);
                }
            }

            for (const texPath of textures) {
                const ref = ctx.catalog.resolveDocumentRef(document, texPath);
                try {
                    const lease = await ctx.acquireTexture(ref, true, 'imported');
                    textureHandles.set(texPath, lease.value.handle);
                    const atlas = ctx.getAtlasFrame ? ctx.getAtlasFrame(ref) : ctx.catalog.getAtlasFrame(ref);
                    if (atlas) textureAtlases.set(texPath, atlas);
                } catch (e) {
                    log.warn('asset', `Failed to load texture: ${texPath}`, e);
                    textureHandles.set(texPath, 0);
                }
            }
            const published: PublishedTimeline = { asset, textureHandles, ...(textureAtlases.size ? { textureAtlases } : {}) };
            if (ctx.preparePrefab) {
                const recipes = new Map<string, PreparedPrefab>();
                for (const ref of prefabs) {
                    try {
                        recipes.set(ref, (await ctx.preparePrefab(ref)).value);
                    } catch (e) {
                        log.warn('asset', `${path}: failed to prepare prefab ${ref}`, e);
                    }
                }
                published.prefabs = recipes;
            }
            return { published, value: { timelineId: path } };
        },
        // Nothing: the slot holds the era, and the timeline system reads it
        // there. A module-level "active registry" answered with whichever app
        // built its plugin last.
    };
}
