import type { GizmoContext, GizmoDescriptor } from './GizmoRegistry';
import { getTilesetForSource } from './TilesetLoader';
import { TilePaintCommand, type TileChange } from '../commands/TilePaintCommand';
import { icons } from '../utils/icons';

interface TileBrushDragState {
    entityId: number;
    mapWidth: number;
    mapHeight: number;
    tileWidth: number;
    tileHeight: number;
    originX: number;
    originY: number;
    tiles: number[];
    changes: Map<number, TileChange>;
}

function findTilemapLayerData(gctx: GizmoContext): {
    entityId: number;
    data: Record<string, unknown>;
} | null {
    const entityData = gctx.store.getSelectedEntityData();
    if (!entityData) return null;
    const comp = entityData.components.find(c => c.type === 'TilemapLayer');
    if (!comp) return null;
    return { entityId: entityData.id, data: comp.data as Record<string, unknown> };
}

function findTilemapSource(gctx: GizmoContext): string | null {
    const entityData = gctx.store.getSelectedEntityData();
    if (!entityData) return null;
    const comp = entityData.components.find(c => c.type === 'Tilemap');
    if (comp) return (comp.data as Record<string, unknown>).source as string ?? null;
    return null;
}

function worldToTile(
    worldX: number, worldY: number,
    originX: number, originY: number,
    tileWidth: number, tileHeight: number,
): { tx: number; ty: number } {
    return {
        tx: Math.floor((worldX - originX) / tileWidth),
        ty: Math.floor((originY - worldY) / tileHeight),
    };
}

export function createTileBrushGizmo(): GizmoDescriptor {
    let hoverTile: { tx: number; ty: number } | null = null;
    let dragState: TileBrushDragState | null = null;

    function getLayerInfo(gctx: GizmoContext): {
        entityId: number;
        width: number;
        height: number;
        tileWidth: number;
        tileHeight: number;
        tiles: number[];
        originX: number;
        originY: number;
    } | null {
        const layer = findTilemapLayerData(gctx);
        if (!layer) return null;

        const d = layer.data;
        const width = d.width as number ?? 0;
        const height = d.height as number ?? 0;
        if (width === 0 || height === 0) return null;

        const worldTransform = gctx.store.getWorldTransform(layer.entityId);
        return {
            entityId: layer.entityId,
            width,
            height,
            tileWidth: d.tileWidth as number ?? 32,
            tileHeight: d.tileHeight as number ?? 32,
            tiles: d.tiles as number[] ?? [],
            originX: worldTransform.position.x,
            originY: worldTransform.position.y,
        };
    }

    function getTilesetImage(gctx: GizmoContext): {
        image: HTMLImageElement;
        columns: number;
        tileWidth: number;
        tileHeight: number;
    } | null {
        const source = findTilemapSource(gctx);
        if (!source) return null;
        const info = getTilesetForSource(source);
        if (!info?.tilesetImage) return null;
        return {
            image: info.tilesetImage,
            columns: info.tilesetColumns,
            tileWidth: info.tileWidth,
            tileHeight: info.tileHeight,
        };
    }

    function paintTile(state: TileBrushDragState, tx: number, ty: number, tileId: number): void {
        if (tx < 0 || tx >= state.mapWidth || ty < 0 || ty >= state.mapHeight) return;
        const index = ty * state.mapWidth + tx;
        if (!state.changes.has(index)) {
            state.changes.set(index, {
                index,
                oldTile: state.tiles[index] ?? 0,
                newTile: tileId,
            });
        } else {
            state.changes.get(index)!.newTile = tileId;
        }
        state.tiles[index] = tileId;
    }

    return {
        id: 'tile-brush',
        name: 'Tile Brush',
        icon: icons.pencil(14),
        shortcut: 'b',
        order: 5,

        isApplicable(ctx: GizmoContext): boolean {
            const entityData = ctx.store.getSelectedEntityData();
            if (!entityData) return false;
            return entityData.components.some(
                c => c.type === 'TilemapLayer' || c.type === 'Tilemap',
            );
        },

        hitTest(worldX, worldY, gctx) {
            const info = getLayerInfo(gctx);
            if (!info) return { hit: false };

            const tile = worldToTile(worldX, worldY,
                info.originX, info.originY, info.tileWidth, info.tileHeight);

            if (tile.tx >= 0 && tile.tx < info.width &&
                tile.ty >= 0 && tile.ty < info.height) {
                return { hit: true, data: tile };
            }
            return { hit: false };
        },

        draw(gctx) {
            if (!hoverTile) return;

            const info = getLayerInfo(gctx);
            if (!info) return;

            const { ctx, zoom } = gctx;
            const store = gctx.store;
            const isErase = store.tileBrushMode === 'erase';

            const screenX = info.originX + hoverTile.tx * info.tileWidth;
            const screenY = -info.originY + hoverTile.ty * info.tileHeight;

            ctx.save();

            if (isErase) {
                ctx.fillStyle = 'rgba(255, 60, 60, 0.3)';
                ctx.fillRect(screenX, screenY, info.tileWidth, info.tileHeight);
                ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
                ctx.lineWidth = 2 / zoom;
                ctx.beginPath();
                ctx.moveTo(screenX, screenY);
                ctx.lineTo(screenX + info.tileWidth, screenY + info.tileHeight);
                ctx.moveTo(screenX + info.tileWidth, screenY);
                ctx.lineTo(screenX, screenY + info.tileHeight);
                ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(100, 200, 255, 0.3)';
                ctx.fillRect(screenX, screenY, info.tileWidth, info.tileHeight);
                ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
                ctx.lineWidth = 2 / zoom;
                ctx.strokeRect(screenX, screenY, info.tileWidth, info.tileHeight);
            }

            ctx.restore();
        },

        onDragStart(worldX, worldY, _hitData, gctx) {
            gctx.setGizmoActive(true);
            const info = getLayerInfo(gctx);
            if (!info) return;

            const tile = worldToTile(worldX, worldY,
                info.originX, info.originY, info.tileWidth, info.tileHeight);

            const isErase = gctx.store.tileBrushMode === 'erase';
            const tileId = isErase ? 0 : gctx.store.tileBrushSelectedTileId;

            dragState = {
                entityId: info.entityId,
                mapWidth: info.width,
                mapHeight: info.height,
                tileWidth: info.tileWidth,
                tileHeight: info.tileHeight,
                originX: info.originX,
                originY: info.originY,
                tiles: info.tiles,
                changes: new Map(),
            };

            paintTile(dragState, tile.tx, tile.ty, tileId);
            gctx.requestRender();
        },

        onDrag(worldX, worldY, _hitData, gctx, event) {
            if (!dragState) return;

            const isShiftErase = event?.shiftKey ?? false;
            const storeErase = gctx.store.tileBrushMode === 'erase';
            const isErase = isShiftErase || storeErase;
            const tileId = isErase ? 0 : gctx.store.tileBrushSelectedTileId;

            const tile = worldToTile(worldX, worldY,
                dragState.originX, dragState.originY,
                dragState.tileWidth, dragState.tileHeight);

            paintTile(dragState, tile.tx, tile.ty, tileId);

            hoverTile = tile;
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);
            if (!dragState || dragState.changes.size === 0) {
                dragState = null;
                return;
            }

            const changes = Array.from(dragState.changes.values());
            const entityId = dragState.entityId;
            dragState = null;

            const store = gctx.store;
            const cmd = new TilePaintCommand(
                store.scene,
                store.entityMap_,
                entityId,
                changes,
            );
            store.executeCommand(cmd);
            gctx.requestRender();
        },

        onHover(worldX, worldY, hitData, gctx) {
            let newTile: { tx: number; ty: number } | null = null;
            if (hitData) {
                const info = getLayerInfo(gctx);
                if (info) {
                    newTile = worldToTile(worldX, worldY,
                        info.originX, info.originY, info.tileWidth, info.tileHeight);
                }
            }
            if (newTile?.tx === hoverTile?.tx && newTile?.ty === hoverTile?.ty) return;
            hoverTile = newTile;
            gctx.requestRender();
        },

        getCursor(hitData) {
            return hitData ? 'crosshair' : 'default';
        },
    };
}
