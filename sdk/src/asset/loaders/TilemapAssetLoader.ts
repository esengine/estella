// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, TilemapResult } from '../AssetLoader';
import { parseTmjWithExternals, resolveRelativePath } from '../../tilemap/tiledLoader';
import { registerTilemapSource } from '../../tilemap/tilesetCache';
import { log } from '../../logger';

export class TilemapAssetLoader implements AssetLoader<TilemapResult> {
    readonly type = 'tilemap';
    readonly extensions = ['.tmj', '.tmx'];

    async load(path: string, ctx: LoadContext): Promise<TilemapResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        // The engine has ONE Tiled parser and it speaks the JSON format. A
        // .tmx (XML) map fails loud with the fix, not with a JSON syntax error
        // — Tiled exports .tmj natively (File → Export As → JSON map files).
        if (text.trimStart().startsWith('<')) {
            throw new Error(
                `[tilemap] "${path}" is a Tiled XML map — the engine parses the JSON format only. ` +
                'In Tiled: File → Export As → "JSON map files (*.tmj)", then reference the .tmj.');
        }
        // External .tsj tilesets resolve relative to the map, through the same
        // text channel as the map itself.
        const mapData = await parseTmjWithExternals(JSON.parse(text), (source) =>
            ctx.loadText(ctx.catalog.getBuildPath(resolveRelativePath(path, source))));
        if (!mapData) {
            throw new Error(`Failed to parse tilemap: ${path}`);
        }

        const tilesets = [];
        for (const ts of mapData.tilesets) {
            const imagePath = resolveRelativePath(path, ts.image);
            let textureHandle = 0;
            try {
                const result = await ctx.loadTexture(imagePath, true);
                textureHandle = result.handle;
            } catch (e) {
                log.warn('asset', `Failed to load tileset texture: ${imagePath}`, e);
            }
            const rows = ts.columns > 0 ? Math.max(1, Math.ceil(ts.tileCount / ts.columns)) : 1;
            tilesets.push({ textureHandle, columns: ts.columns, rows, firstId: ts.firstGid });
        }

        registerTilemapSource(path, {
            tileWidth: mapData.tileWidth,
            tileHeight: mapData.tileHeight,
            // Carry every parsed field the runtime cache/plugin consume — the loader
            // previously dropped orientation/animations/properties/collision, so isometric
            // asset-loaded maps rendered flat, tile animations never ran, and tilemaps had
            // no physics collision (the B2-1 gap).
            orientation: mapData.orientation,
            hexSideLength: mapData.hexSideLength,
            staggerAxis: mapData.staggerAxis,
            staggerIndex: mapData.staggerIndex,
            layers: mapData.layers.map(l => ({
                name: l.name,
                width: l.width,
                height: l.height,
                tiles: l.tiles,
                chunks: l.chunks ?? [],
                infinite: l.infinite ?? false,
            })),
            tilesets,
            collisionTileIds: mapData.collisionTileIds,
            tileAnimations: mapData.tileAnimations,
            tileProperties: mapData.tileProperties,
            objectGroups: mapData.objectGroups,
        });

        return { sourceId: path };
    }

    unload(_asset: TilemapResult): void {
        // Tilemap sources registered globally
    }
}
