import type { AssetLoader, LoadContext, TilemapResult } from '../AssetLoader';
import { parseTmjJson, resolveRelativePath } from '../../tilemap/tiledLoader';
import { registerTilemapSource } from '../../tilemap/tilesetCache';
import { log } from '../../logger';

export class TilemapAssetLoader implements AssetLoader<TilemapResult> {
    readonly type = 'tilemap';
    readonly extensions = ['.tmj', '.tmx'];

    async load(path: string, ctx: LoadContext): Promise<TilemapResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const mapData = parseTmjJson(JSON.parse(text));
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
            tilesets.push({ textureHandle, columns: ts.columns });
        }

        registerTilemapSource(path, {
            tileWidth: mapData.tileWidth,
            tileHeight: mapData.tileHeight,
            layers: mapData.layers.map(l => ({
                name: l.name,
                width: l.width,
                height: l.height,
                tiles: l.tiles,
                chunks: l.chunks ?? [],
                infinite: l.infinite ?? false,
            })),
            tilesets,
        });

        return { sourceId: path };
    }

    unload(_asset: TilemapResult): void {
        // Tilemap sources registered globally
    }
}
