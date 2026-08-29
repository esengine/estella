// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineAssetLoader.ts
 * @brief   The asset half of spine: two documents read, atlas pages acquired.
 *
 * @details It makes nothing, so it destroys nothing. The pages are taken through
 *          the acquisition door, which is what records them as the era's — and
 *          the native skeleton they end up in belongs to a runtime backend, not
 *          here: it is per Spine version, per App, and dies with the entities
 *          posing it.
 */
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { getAssetTypeEntry } from '../../assetTypes';
import { prepareSpine, type SpineAssetValue, type SpineIO } from '../../spine/prepareSpine';

export class SpineAssetLoader implements AssetLoader<SpineAssetValue> {
    readonly type = 'spine';
    readonly extensions = ['.skel'];

    /** The pair a skeleton names on its own: its atlas is a Catalog dependency,
     *  which is what a cook records for it. */
    async load(skeletonPath: string, ctx: LoadContext): Promise<SpineAssetValue> {
        const deps = ctx.catalog.getDeps(skeletonPath);
        const atlasPath = deps.length > 0 ? deps[0] : null;
        if (!atlasPath) {
            throw new Error(`Spine skeleton has no atlas dependency: ${skeletonPath}. `
                + 'Pass the atlas explicitly or configure Catalog deps.');
        }
        return this.prepare(skeletonPath, atlasPath, ctx);
    }

    /** The pair as a caller named it — a component authors both fields. */
    async prepare(skeletonRef: string, atlasRef: string, ctx: LoadContext): Promise<SpineAssetValue> {
        return prepareSpine(spineIo(ctx, atlasRef), skeletonRef, atlasRef);
    }
}

/** The asset layer as a spine transport: documents through the source door,
 *  pages through the acquisition door — so the era holds every page receipt. */
function spineIo(ctx: LoadContext, atlasRef: string): SpineIO {
    const dir = atlasRef.substring(0, atlasRef.lastIndexOf('/'));
    return {
        // Read, not loaded: what these bytes say decides what the asset becomes,
        // which is exactly when a change to them must rebuild it.
        text: (ref) => (ctx.readSource
            ? ctx.readSource(ref)
            : ctx.loadText(ctx.catalog.getBuildPath(ref))),
        binary: (ref) => ctx.loadBinary(ctx.catalog.getBuildPath(ref)),
        // flipY false: an atlas page's rows are a layout, and the atlas's
        // coordinates are top-first.
        page: async (path) => (await ctx.acquireTexture(path, false)).value,
        // Named relative to where the atlas was AUTHORED; the acquisition
        // resolves that through the manifest like any other ref.
        pagePath: (name) => (dir ? `${dir}/${name}` : name),
        isBinary: (ref) => getAssetTypeEntry(ref)?.contentType === 'binary',
    };
}
