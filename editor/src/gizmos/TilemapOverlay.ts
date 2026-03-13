import type { OverlayContext } from './ColliderOverlay';
import type { EntityData } from '../types/SceneTypes';
import { getTilesetForSource, addTilesetLoadListener } from './TilesetLoader';

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
        const width = data.width as number ?? 0;
        const height = data.height as number ?? 0;
        const tileWidth = data.tileWidth as number ?? 32;
        const tileHeight = data.tileHeight as number ?? 32;
        const tiles = data.tiles as number[] ?? [];
        const tilesetColumns = data.tilesetColumns as number ?? 1;

        if (width === 0 || height === 0) return;

        const { ctx, zoom, store } = octx;
        const worldTransform = store.getWorldTransform(entity.id);
        const ox = worldTransform.position.x;
        const oy = -worldTransform.position.y;

        ctx.save();

        this.drawGrid_(ctx, width, height, tileWidth, tileHeight, ox, oy, zoom);

        if (tiles.length > 0) {
            this.drawTiles_(ctx, tiles, width, height, tileWidth, tileHeight,
                tilesetColumns, null, ox, oy);
        }

        this.drawOriginMarker_(ctx, ox, oy, zoom);
        ctx.restore();
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
