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
import { AssetScope } from '../AssetLease';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../../timeline/TimelineLoader';
import type { TimelineAsset } from '../../timeline/TimelineTypes';
import {
    registerTimelineAsset, registerTimelineTextureHandles, unregisterTimelineAsset, getTimelineAsset,
} from '../../timeline/TimelineAssetRegistry';
import { log } from '../../util/logger';

/** What one era publishes: the parsed asset and the handles it resolved. */
interface PublishedTimeline {
    asset: TimelineAsset;
    textureHandles: Map<string, number>;
}

export class TimelineAssetLoader implements AssetLoader<TimelineResult> {
    readonly type = 'timeline';
    readonly extensions = ['.estimeline'];

    readonly registry: RegistryAssetLoader<TimelineResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<TimelineResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const asset = parseTimelineAsset(JSON.parse(text));
            const dependencies = new AssetScope();
            const textureHandles = new Map<string, number>();

            for (const texPath of extractTimelineAssetPaths(asset).textures) {
                try {
                    const lease = await ctx.acquireTexture(texPath, true);
                    dependencies.add(lease);
                    textureHandles.set(texPath, lease.value.handle);
                } catch (e) {
                    log.warn('asset', `Failed to load texture: ${texPath}`, e);
                    textureHandles.set(texPath, 0);
                }
            }
            return { published: { asset, textureHandles }, value: { timelineId: path }, dependencies };
        },
        publish: (names, published) => {
            const { asset, textureHandles } = published as PublishedTimeline;
            for (const name of names) {
                registerTimelineAsset(name, asset);
                if (textureHandles.size > 0) registerTimelineTextureHandles(name, textureHandles);
            }
        },
        unpublish: (names, published) => {
            const { asset } = published as PublishedTimeline;
            for (const name of names) {
                if (getTimelineAsset(name) === asset) unregisterTimelineAsset(name);
            }
        },
    };
}
