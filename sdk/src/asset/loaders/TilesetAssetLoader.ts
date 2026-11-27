// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Runtime `.estileset` loader — parses the tileset and acquires its atlas,
 *        so the tilemap sync can derive the render table + collision + animations
 *        LIVE (no baking). Mirrors {@link TilemapAssetLoader} (the `.tmj` path).
 *
 * A component names a tileset by REF, so what an owner owns is the slot; the
 * atlas belongs to the ERA that resolved it, and goes back when that era retires.
 */
import type { AssetLoader, LoadContext, TilesetResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { parseTileset } from '../../tilemap/tilesetAsset';
import type { PublishedTileset } from '../../tilemap/tilesetCache';
import { log } from '../../util/logger';
import { resolveIndexedProjectRef } from '../documentRef';

export class TilesetAssetLoader implements AssetLoader<TilesetResult> {
    readonly type = 'tileset';
    readonly bindsTextures = true;
    readonly extensions = ['.estileset'];

    readonly registry: RegistryAssetLoader<TilesetResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<TilesetResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const asset = parseTileset(JSON.parse(text));

            let textureHandle = 0;
            let textureWidth: number | undefined;
            let textureHeight: number | undefined;
            if (asset.texture) {
                const document = ctx.sourceAddressOf?.(path) ?? path;
                const atlas = resolveIndexedProjectRef(document, asset.texture, candidate => ctx.assetTypeOf?.(candidate) !== undefined);
                try {
                    const lease = await ctx.acquireTexture(atlas, true, 'imported');
                    textureHandle = lease.value.handle;
                    textureWidth = lease.value.width;
                    textureHeight = lease.value.height;
                } catch (e) {
                    log.warn('asset', `Failed to load tileset atlas: ${atlas}`, e);
                }
            }
            const published: PublishedTileset = {
                resolved: { asset, textureHandle, textureWidth, textureHeight },
            };
            return { published, value: { tilesetId: path } };
        },
    };
}
