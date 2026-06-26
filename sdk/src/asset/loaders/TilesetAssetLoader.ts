// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Runtime `.estileset` loader — parses the tileset asset and loads its
 *        atlas texture, caching the resolved tileset so the tilemap sync can
 *        derive the render table + collision + animations LIVE (no baking).
 *        Mirrors {@link TilemapAssetLoader} (the `.tmj` path).
 */
import type { AssetLoader, LoadContext, TilesetResult } from '../AssetLoader';
import { parseTileset } from '../../tilemap/tilesetAsset';
import { registerResolvedTileset } from '../../tilemap/tilesetCache';
import { log } from '../../logger';

export class TilesetAssetLoader implements AssetLoader<TilesetResult> {
    readonly type = 'tileset';
    readonly extensions = ['.estileset'];

    async load(path: string, ctx: LoadContext): Promise<TilesetResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const asset = parseTileset(JSON.parse(text));

        // The atlas is a `@uuid:` ref inside the .estileset; loadTexture resolves it.
        let textureHandle = 0;
        if (asset.texture) {
            try {
                const tex = await ctx.loadTexture(asset.texture, true);
                textureHandle = tex.handle;
            } catch (e) {
                log.warn('asset', `Failed to load tileset atlas: ${asset.texture}`, e);
            }
        }

        registerResolvedTileset(path, { asset, textureHandle });
        return { tilesetId: path };
    }

    unload(_asset: TilesetResult): void {
        // Resolved tilesets live in the module cache (cleared on scene reset); the
        // atlas texture is ref-counted by the texture loader. Nothing per-asset here.
    }
}
