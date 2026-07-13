// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, TilemapResult } from '../AssetLoader';
import {
    packCollectionGrid, parseTmjWithExternals, resolveRelativePath,
    type TiledMapData, type TiledTilesetData,
} from '../../tilemap/tiledLoader';
import { registerTilemapSource, type LoadedTilemapTileset } from '../../tilemap/tilesetCache';
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
            // Image-collection tileset: fold the loose per-tile images into one
            // grid atlas — from here on it IS a grid tileset to everyone.
            if (ts.collectionTiles?.length) {
                tilesets.push(await this.foldCollection_(path, ts, mapData, ctx));
                continue;
            }
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

    /**
     * Fold an image-collection tileset into one grid atlas: decode every tile
     * image through the platform's single decode path, pack them into a
     * near-square grid keyed by local id (packCollectionGrid), upload once.
     * Uniform tiles matching the map grid only — anything else has no meaning
     * on the fixed-grid renderer yet, so it fails loud with the fix.
     */
    private async foldCollection_(
        mapPath: string, ts: TiledTilesetData, mapData: TiledMapData, ctx: LoadContext,
    ): Promise<LoadedTilemapTileset> {
        if (!ctx.decodePixels || !ctx.createTextureFromPixels) {
            throw new Error(
                `[tilemap] "${mapPath}": tileset "${ts.name}" is an image collection, but this `
                + 'asset provider cannot decode/compose pixels — load it through the app Assets channel.');
        }
        const tiles = await Promise.all(ts.collectionTiles!.map(async (tile) => {
            const decoded = await ctx.decodePixels!(resolveRelativePath(mapPath, tile.image));
            if (decoded.width !== mapData.tileWidth || decoded.height !== mapData.tileHeight) {
                throw new Error(
                    `[tilemap] "${mapPath}": collection tile "${tile.image}" is `
                    + `${decoded.width}x${decoded.height}, but the map grid is `
                    + `${mapData.tileWidth}x${mapData.tileHeight} — collection tiles must match the `
                    + 'grid (resize them, or author a grid tileset image instead).');
            }
            return { id: tile.id, pixels: decoded.pixels };
        }));
        const grid = packCollectionGrid(tiles, mapData.tileWidth, mapData.tileHeight);
        const tex = await ctx.createTextureFromPixels(grid.width, grid.height, grid.pixels, true);
        return { textureHandle: tex.handle, columns: grid.columns, rows: grid.rows, firstId: ts.firstGid };
    }

    unload(_asset: TilemapResult): void {
        // Tilemap sources registered globally
    }
}
