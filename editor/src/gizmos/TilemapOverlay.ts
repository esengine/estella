import type { OverlayContext } from './ColliderOverlay';
import type { EntityData } from '../types/SceneTypes';
import { getTilesetForSource, getTilesetForImage, findParentTilemapSource, addTilesetLoadListener } from './TilesetLoader';
import { CHUNK_SIZE } from './TileChunkUtils';

const GRID_COLOR = 'rgba(100, 200, 255, 0.5)';
const FALLBACK_TILE_COLOR = 'rgba(100, 200, 255, 0.15)';
const ORIGIN_COLOR = 'rgba(255, 80, 80, 0.8)';

export class TilemapOverlay {
    private requestRender_: (() => void) | null = null;
    private unsubscribe_: (() => void) | null = null;

    setRenderCallback(cb: () => void): void {
        this.requestRender_ = cb;
        this.unsubscribe_?.();
        this.unsubscribe_ = addTilesetLoadListener(() => this.requestRender_?.());
    }

    drawAll(octx: OverlayContext): void {
        const { store } = octx;

        for (const entity of store.scene.entities) {
            if (!store.isEntityVisible(entity.id)) continue;
            this.drawTilemapEntity_(octx, entity);
            this.drawTilemapLayerEntity_(octx, entity);
        }
    }

    private drawTilemapEntity_(octx: OverlayContext, entity: EntityData): void {
        const tilemapComp = entity.components.find(c => c.type === 'Tilemap');
        if (!tilemapComp) return;

        const source: string = (tilemapComp.data as any).source ?? '';
        if (!source) return;

        const cached = getTilesetForSource(source);
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

    private drawTilemapLayerEntity_(octx: OverlayContext, entity: EntityData): void {
        const layerComp = entity.components.find(c => c.type === 'TilemapLayer');
        if (!layerComp) return;

        const data = layerComp.data as Record<string, unknown>;
        const infinite = data.infinite as boolean ?? false;
        const width = data.width as number ?? 0;
        const height = data.height as number ?? 0;
        const tileWidth = data.tileWidth as number ?? 32;
        const tileHeight = data.tileHeight as number ?? 32;
        const tilesetColumns = data.tilesetColumns as number ?? 1;

        if (!infinite && (width === 0 || height === 0)) return;

        const { ctx, zoom, store } = octx;
        const worldTransform = store.getWorldTransform(entity.id);
        const ox = worldTransform.position.x;
        const oy = -worldTransform.position.y;

        ctx.save();

        const image = this.resolveTilesetImage_(octx, entity, data, tileWidth, tileHeight, tilesetColumns);

        if (infinite) {
            const chunks = data.chunks as Record<string, number[]> ?? {};
            this.drawChunks_(ctx, chunks, tileWidth, tileHeight, tilesetColumns, image, ox, oy);
        } else {
            this.drawGrid_(ctx, width, height, tileWidth, tileHeight, ox, oy, zoom);
            const tiles = data.tiles as number[] ?? [];
            if (tiles.length > 0) {
                this.drawTiles_(ctx, tiles, width, height, tileWidth, tileHeight,
                    tilesetColumns, image, ox, oy);
            }
        }

        this.drawOriginMarker_(ctx, ox, oy, zoom);
        ctx.restore();
    }

    private resolveTilesetImage_(
        octx: OverlayContext, entity: EntityData, data: Record<string, unknown>,
        tileWidth: number, tileHeight: number, tilesetColumns: number,
    ): HTMLImageElement | null {
        const parentSource = findParentTilemapSource(octx.store.scene.entities, entity.id);
        if (parentSource) {
            const info = getTilesetForSource(parentSource);
            if (info?.tilesetImage) return info.tilesetImage;
        }

        const textureUuid = data.texture as string ?? '';
        if (textureUuid && typeof textureUuid === 'string') {
            const info = getTilesetForImage(textureUuid, tileWidth, tileHeight, tilesetColumns);
            if (info?.tilesetImage) return info.tilesetImage;
        }

        return null;
    }


    private drawChunks_(
        ctx: CanvasRenderingContext2D,
        chunks: Record<string, number[]>,
        tileWidth: number, tileHeight: number,
        tilesetColumns: number,
        image: HTMLImageElement | null,
        ox: number, oy: number,
    ): void {
        const hasImage = image && image.complete && image.naturalWidth > 0;

        for (const [key, tiles] of Object.entries(chunks)) {
            const [cxStr, cyStr] = key.split(',');
            const cx = parseInt(cxStr, 10);
            const cy = parseInt(cyStr, 10);
            const baseX = ox + cx * CHUNK_SIZE * tileWidth;
            const baseY = oy + cy * CHUNK_SIZE * tileHeight;

            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                    const tileId = tiles[ly * CHUNK_SIZE + lx] ?? 0;
                    if (tileId === 0) continue;

                    const dx = baseX + lx * tileWidth;
                    const dy = baseY + ly * tileHeight;

                    if (hasImage) {
                        const tileIndex = tileId - 1;
                        const sx = (tileIndex % tilesetColumns) * tileWidth;
                        const sy = Math.floor(tileIndex / tilesetColumns) * tileHeight;
                        ctx.drawImage(image!, sx, sy, tileWidth, tileHeight, dx, dy, tileWidth, tileHeight);
                    } else {
                        ctx.fillStyle = FALLBACK_TILE_COLOR;
                        ctx.fillRect(dx + 1, dy + 1, tileWidth - 2, tileHeight - 2);
                    }
                }
            }
        }
    }

    private drawTiles_(
        ctx: CanvasRenderingContext2D,
        tiles: number[], mapWidth: number, mapHeight: number,
        tileWidth: number, tileHeight: number,
        tilesetColumns: number,
        image: HTMLImageElement | null,
        ox: number, oy: number,
    ): void {
        if (image && image.complete && image.naturalWidth > 0) {
            for (let ty = 0; ty < mapHeight; ty++) {
                for (let tx = 0; tx < mapWidth; tx++) {
                    const tileId = tiles[ty * mapWidth + tx] ?? 0;
                    if (tileId === 0) continue;

                    const tileIndex = tileId - 1;
                    const sx = (tileIndex % tilesetColumns) * tileWidth;
                    const sy = Math.floor(tileIndex / tilesetColumns) * tileHeight;

                    ctx.drawImage(
                        image,
                        sx, sy, tileWidth, tileHeight,
                        ox + tx * tileWidth, oy + ty * tileHeight, tileWidth, tileHeight,
                    );
                }
            }
        } else {
            ctx.fillStyle = FALLBACK_TILE_COLOR;
            for (let ty = 0; ty < mapHeight; ty++) {
                for (let tx = 0; tx < mapWidth; tx++) {
                    const tileId = tiles[ty * mapWidth + tx] ?? 0;
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
}
