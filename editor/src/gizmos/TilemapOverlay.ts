import type { OverlayContext } from './ColliderOverlay';
import type { EntityData } from '../types/SceneTypes';
import { getGlobalPathResolver } from '../asset';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { isUUID, getAssetLibrary } from '../asset/AssetLibrary';

const GRID_COLOR = 'rgba(100, 200, 255, 0.5)';
const FALLBACK_TILE_COLOR = 'rgba(100, 200, 255, 0.15)';
const HIGHLIGHT_COLOR = 'rgba(255, 200, 50, 0.6)';
const ORIGIN_COLOR = 'rgba(255, 80, 80, 0.8)';
const TILE_ID_COLOR = 'rgba(255, 255, 255, 0.7)';

const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;
const TILED_GID_MASK = 0x1FFFFFFF;

interface ParsedTilemapLayer {
    width: number;
    height: number;
    tiles: number[];
}

interface CachedTilemap {
    tileWidth: number;
    tileHeight: number;
    orientation: string;
    layers: ParsedTilemapLayer[];
    tilesetImage: HTMLImageElement | null;
    tilesetColumns: number;
}

export class TilemapOverlay {
    private cache_ = new Map<string, CachedTilemap | null>();
    private loading_ = new Set<string>();
    private requestRender_: (() => void) | null = null;

    setRenderCallback(cb: () => void): void {
        this.requestRender_ = cb;
    }

    drawAll(octx: OverlayContext): void {
        const { store } = octx;

        for (const entity of store.scene.entities) {
            if (!store.isEntityVisible(entity.id)) continue;
            this.drawEntity_(octx, entity);
        }
    }

    private drawEntity_(octx: OverlayContext, entity: EntityData): void {
        const tilemapComp = entity.components.find(c => c.type === 'Tilemap');
        if (!tilemapComp) return;

        const source: string = (tilemapComp.data as any).source ?? '';
        if (!source) return;

        const cached = this.loadTilemap_(source);
        if (!cached) return;

        const { ctx, zoom, store } = octx;
        const worldTransform = store.getWorldTransform(entity.id);
        const ox = worldTransform.position.x;
        const oy = -worldTransform.position.y;

        ctx.save();

        if (cached.layers.length > 0) {
            const firstLayer = cached.layers[0];
            if (cached.orientation === 'isometric') {
                this.drawIsometricGrid_(ctx, firstLayer.width, firstLayer.height,
                    cached.tileWidth, cached.tileHeight, ox, oy, zoom);
            } else {
                this.drawGrid_(ctx, firstLayer.width, firstLayer.height,
                    cached.tileWidth, cached.tileHeight, ox, oy, zoom);
            }
        }

        this.drawOriginMarker_(ctx, ox, oy, zoom);

        ctx.restore();
    }

    private drawLayer_(
        ctx: CanvasRenderingContext2D,
        cached: CachedTilemap,
        layer: ParsedTilemapLayer,
        ox: number, oy: number,
    ): void {
        const { tileWidth, tileHeight, tilesetImage, tilesetColumns } = cached;

        if (tilesetImage && tilesetImage.complete && tilesetImage.naturalWidth > 0) {
            for (let ty = 0; ty < layer.height; ty++) {
                for (let tx = 0; tx < layer.width; tx++) {
                    const tileId = layer.tiles[ty * layer.width + tx] ?? 0;
                    if (tileId === 0) continue;

                    const tileIndex = tileId - 1;
                    const sx = (tileIndex % tilesetColumns) * tileWidth;
                    const sy = Math.floor(tileIndex / tilesetColumns) * tileHeight;

                    ctx.drawImage(
                        tilesetImage,
                        sx, sy, tileWidth, tileHeight,
                        ox + tx * tileWidth, oy + ty * tileHeight, tileWidth, tileHeight,
                    );
                }
            }
        } else {
            ctx.fillStyle = FALLBACK_TILE_COLOR;
            for (let ty = 0; ty < layer.height; ty++) {
                for (let tx = 0; tx < layer.width; tx++) {
                    const tileId = layer.tiles[ty * layer.width + tx] ?? 0;
                    if (tileId === 0) continue;
                    ctx.fillRect(
                        ox + tx * tileWidth + 1, oy + ty * tileHeight + 1,
                        tileWidth - 2, tileHeight - 2,
                    );
                }
            }
        }
    }

    private drawGrid_(
        ctx: CanvasRenderingContext2D,
        mapWidth: number, mapHeight: number,
        tileWidth: number, tileHeight: number,
        ox: number, oy: number, zoom: number,
    ): void {
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1 / zoom;

        for (let x = 0; x <= mapWidth; x++) {
            const wx = ox + x * tileWidth;
            ctx.beginPath();
            ctx.moveTo(wx, oy);
            ctx.lineTo(wx, oy + mapHeight * tileHeight);
            ctx.stroke();
        }
        for (let y = 0; y <= mapHeight; y++) {
            const wy = oy + y * tileHeight;
            ctx.beginPath();
            ctx.moveTo(ox, wy);
            ctx.lineTo(ox + mapWidth * tileWidth, wy);
            ctx.stroke();
        }
    }

    private drawIsometricGrid_(
        ctx: CanvasRenderingContext2D,
        mapWidth: number, mapHeight: number,
        tileWidth: number, tileHeight: number,
        ox: number, oy: number, zoom: number,
    ): void {
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1 / zoom;

        const hw = tileWidth * 0.5;
        const hh = tileHeight * 0.5;

        for (let x = 0; x <= mapWidth; x++) {
            const sx = ox + x * hw;
            const sy = oy + x * hh;
            const ex = sx - mapHeight * hw;
            const ey = sy + mapHeight * hh;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
        }
        for (let y = 0; y <= mapHeight; y++) {
            const sx = ox - y * hw;
            const sy = oy + y * hh;
            const ex = sx + mapWidth * hw;
            const ey = sy + mapWidth * hh;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
        }
    }

    private drawOriginMarker_(
        ctx: CanvasRenderingContext2D,
        ox: number, oy: number, zoom: number,
    ): void {
        const size = 6 / zoom;
        ctx.fillStyle = ORIGIN_COLOR;
        ctx.beginPath();
        ctx.arc(ox, oy, size, 0, Math.PI * 2);
        ctx.fill();
    }

    private loadTilemap_(source: string): CachedTilemap | null {
        if (this.cache_.has(source)) {
            return this.cache_.get(source) ?? null;
        }
        if (this.loading_.has(source)) {
            return null;
        }

        this.loading_.add(source);
        this.loadTilemapAsync_(source).then(result => {
            this.cache_.set(source, result);
            this.loading_.delete(source);
            if (result) {
                this.requestRender_?.();
            }
        });
        return null;
    }

    private resolveSource_(source: string): string {
        if (isUUID(source)) {
            return getAssetLibrary().getPath(source) ?? source;
        }
        return source;
    }

    private async loadTilemapAsync_(source: string): Promise<CachedTilemap | null> {
        try {
            const resolver = getGlobalPathResolver();
            if (!resolver) return null;

            const platform = getPlatformAdapter();
            const resolvedPath = this.resolveSource_(source);
            const absPath = resolver.toAbsolutePath(resolvedPath);
            const jsonText = await platform.readTextFile(absPath);
            const json = JSON.parse(jsonText) as Record<string, unknown>;

            const mapWidth = json.width as number;
            const mapHeight = json.height as number;
            const tileWidth = (json.tilewidth as number) ?? 32;
            const tileHeight = (json.tileheight as number) ?? 32;
            if (!mapWidth || !mapHeight) return null;

            const rawTilesets = json.tilesets as Array<Record<string, unknown>> | undefined;
            const firstGid = rawTilesets?.[0]?.firstgid as number ?? 1;
            const tilesetImage = rawTilesets?.[0]?.image as string ?? '';
            const tilesetColumns = (rawTilesets?.[0]?.columns as number) ?? 1;

            const rawLayers = json.layers as Array<Record<string, unknown>> | undefined;
            const layers: ParsedTilemapLayer[] = [];

            if (rawLayers) {
                for (const layer of rawLayers) {
                    if (layer.type !== 'tilelayer') continue;
                    const lw = (layer.width as number) ?? mapWidth;
                    const lh = (layer.height as number) ?? mapHeight;
                    if (layer.visible === false) continue;
                    const rawData = layer.data as number[] | undefined;
                    const tiles: number[] = [];
                    if (rawData) {
                        for (const gid of rawData) {
                            if (gid === 0) {
                                tiles.push(0);
                            } else {
                                const localId = (gid & TILED_GID_MASK) - firstGid;
                                tiles.push(localId + 1);
                            }
                        }
                    }
                    layers.push({ width: lw, height: lh, tiles });
                }
            }

            let loadedImage: HTMLImageElement | null = null;
            if (tilesetImage) {
                const baseDir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/') + 1);
                const imagePath = baseDir + tilesetImage;
                const absImagePath = resolver.toAbsolutePath(imagePath);
                const imageUrl = platform.convertFilePathToUrl(absImagePath);

                const img = new Image();
                img.src = imageUrl;
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('Failed to load tileset image'));
                });
                loadedImage = img;
            }

            const orientation = (json.orientation as string) ?? 'orthogonal';

            return {
                tileWidth,
                tileHeight,
                orientation,
                layers,
                tilesetImage: loadedImage,
                tilesetColumns,
            };
        } catch {
            return null;
        }
    }
}
