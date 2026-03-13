import type { GizmoContext, GizmoDescriptor } from './GizmoRegistry';
import { getTilesetForSource, getTilesetForImage, findParentTilemapSource } from './TilesetLoader';
import { TilePaintCommand, type TileChange } from '../commands/TilePaintCommand';
import { floodFill } from './TileFill';
import { readChunkTile, writeChunkTile, FLIP_H_BIT, FLIP_V_BIT, TILE_ID_MASK, applyFlipBits } from './TileChunkUtils';
import { icons } from '../utils/icons';

interface TileBrushDragState {
    entityId: number;
    mapWidth: number;
    mapHeight: number;
    tileWidth: number;
    tileHeight: number;
    originX: number;
    originY: number;
    infinite: boolean;
    tiles: number[];
    chunks: Record<string, number[]>;
    changes: Map<string, TileChange>;
    rightClickErase: boolean;
}

interface RectDragState {
    entityId: number;
    startTx: number;
    startTy: number;
    endTx: number;
    endTy: number;
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

    const tilemapComp = entityData.components.find(c => c.type === 'Tilemap');
    if (tilemapComp) {
        const source = (tilemapComp.data as Record<string, unknown>).source as string ?? '';
        if (source) return source;
    }

    return findParentTilemapSource(gctx.store.scene.entities, entityData.id);
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

type LayerInfo = {
    entityId: number;
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    infinite: boolean;
    tiles: number[];
    chunks: Record<string, number[]>;
    originX: number;
    originY: number;
};

export function createTileBrushGizmo(): GizmoDescriptor {
    let hoverTile: { tx: number; ty: number } | null = null;
    let dragState: TileBrushDragState | null = null;
    let rectDrag: RectDragState | null = null;
    let cachedImageEntityId_ = -1;
    let cachedImageResult_: { image: HTMLImageElement; tilesetColumns: number } | null = null;

    function getLayerInfo(gctx: GizmoContext): LayerInfo | null {
        const layer = findTilemapLayerData(gctx);
        if (!layer) return null;

        const d = layer.data;
        const infinite = d.infinite as boolean ?? false;
        const width = d.width as number ?? 0;
        const height = d.height as number ?? 0;
        if (!infinite && (width === 0 || height === 0)) return null;

        const worldTransform = gctx.store.getWorldTransform(layer.entityId);
        return {
            entityId: layer.entityId,
            width,
            height,
            tileWidth: d.tileWidth as number ?? 32,
            tileHeight: d.tileHeight as number ?? 32,
            infinite,
            tiles: d.tiles as number[] ?? [],
            chunks: d.chunks as Record<string, number[]> ?? {},
            originX: worldTransform.position.x,
            originY: worldTransform.position.y,
        };
    }

    function readTile(state: TileBrushDragState, tx: number, ty: number): number {
        if (state.infinite) {
            return readChunkTile(state.chunks, tx, ty);
        }
        return state.tiles[ty * state.mapWidth + tx] ?? 0;
    }

    function writeTile(state: TileBrushDragState, tx: number, ty: number, tileId: number): void {
        if (state.infinite) {
            writeChunkTile(state.chunks, tx, ty, tileId);
        } else {
            state.tiles[ty * state.mapWidth + tx] = tileId;
        }
    }

    function paintTile(state: TileBrushDragState, tx: number, ty: number, tileId: number): void {
        if (!state.infinite) {
            if (tx < 0 || tx >= state.mapWidth || ty < 0 || ty >= state.mapHeight) return;
            const expectedLen = state.mapWidth * state.mapHeight;
            if (state.tiles.length < expectedLen) {
                const oldLen = state.tiles.length;
                state.tiles.length = expectedLen;
                state.tiles.fill(0, oldLen, expectedLen);
            }
        }
        const changeKey = `${tx},${ty}`;
        if (!state.changes.has(changeKey)) {
            state.changes.set(changeKey, {
                x: tx,
                y: ty,
                oldTile: readTile(state, tx, ty),
                newTile: tileId,
            });
        } else {
            state.changes.get(changeKey)!.newTile = tileId;
        }
        writeTile(state, tx, ty, tileId);
    }

    function paintStamp(
        state: TileBrushDragState, tx: number, ty: number,
        stamp: Readonly<{ width: number; height: number; tiles: number[] }>,
        flipH: boolean, flipV: boolean,
    ): void {
        for (let sy = 0; sy < stamp.height; sy++) {
            for (let sx = 0; sx < stamp.width; sx++) {
                const tileId = stamp.tiles[sy * stamp.width + sx] ?? 0;
                if (tileId > 0) {
                    paintTile(state, tx + sx, ty + sy, applyFlipBits(tileId, flipH, flipV));
                }
            }
        }
    }

    function createDragState(info: LayerInfo, rightClickErase: boolean): TileBrushDragState {
        return {
            entityId: info.entityId,
            mapWidth: info.width,
            mapHeight: info.height,
            tileWidth: info.tileWidth,
            tileHeight: info.tileHeight,
            originX: info.originX,
            originY: info.originY,
            infinite: info.infinite,
            tiles: info.tiles,
            chunks: info.chunks,
            changes: new Map(),
            rightClickErase,
        };
    }

    function commitChanges(state: TileBrushDragState, gctx: GizmoContext): void {
        if (state.changes.size === 0) return;
        const changes = Array.from(state.changes.values());
        const store = gctx.store;
        const cmd = new TilePaintCommand(
            store.scene,
            store.entityMap_,
            state.entityId,
            changes,
        );
        store.executeCommand(cmd);
    }

    function resolveLayerImage(gctx: GizmoContext): { image: HTMLImageElement; tilesetColumns: number } | null {
        const entityData = gctx.store.getSelectedEntityData();
        if (!entityData) { cachedImageEntityId_ = -1; cachedImageResult_ = null; return null; }
        if (entityData.id === cachedImageEntityId_ && cachedImageResult_) return cachedImageResult_;

        cachedImageEntityId_ = entityData.id;
        cachedImageResult_ = null;

        const layerComp = entityData.components.find(c => c.type === 'TilemapLayer');
        if (!layerComp) return null;
        const d = layerComp.data as Record<string, unknown>;

        const parentSource = findParentTilemapSource(gctx.store.scene.entities, entityData.id);
        if (parentSource) {
            const info = getTilesetForSource(parentSource);
            if (info?.tilesetImage?.complete) { cachedImageResult_ = { image: info.tilesetImage, tilesetColumns: info.tilesetColumns }; return cachedImageResult_; }
        }

        const textureUuid = d.texture as string ?? '';
        if (textureUuid && typeof textureUuid === 'string') {
            const tw = d.tileWidth as number ?? 32;
            const th = d.tileHeight as number ?? 32;
            const cols = d.tilesetColumns as number ?? 1;
            const info = getTilesetForImage(textureUuid, tw, th, cols);
            if (info?.tilesetImage?.complete) { cachedImageResult_ = { image: info.tilesetImage, tilesetColumns: cols }; return cachedImageResult_; }
        }

        return null;
    }

    function readTileFromInfo(info: LayerInfo, tx: number, ty: number): number {
        if (info.infinite) {
            return readChunkTile(info.chunks, tx, ty);
        }
        if (tx < 0 || tx >= info.width || ty < 0 || ty >= info.height) return 0;
        return info.tiles[ty * info.width + tx] ?? 0;
    }

    function doBucketFill(gctx: GizmoContext, tx: number, ty: number): void {
        const info = getLayerInfo(gctx);
        if (!info) return;

        const fillTileId = applyFlipBits(
            gctx.store.tileBrushStamp.tiles[0] ?? 1,
            gctx.store.tileBrushFlipH, gctx.store.tileBrushFlipV,
        );
        const result = floodFill({
            infinite: info.infinite,
            width: info.width,
            height: info.height,
            tiles: info.tiles,
            chunks: info.chunks,
        }, tx, ty);

        if (result.positions.length === 0) return;

        const state = createDragState(info, false);
        for (const pos of result.positions) {
            paintTile(state, pos.x, pos.y, fillTileId);
        }
        commitChanges(state, gctx);
    }

    function doPicker(gctx: GizmoContext, tx: number, ty: number): void {
        const info = getLayerInfo(gctx);
        if (!info) return;

        const raw = readTileFromInfo(info, tx, ty);
        if (raw > 0) {
            const baseTile = raw & TILE_ID_MASK;
            gctx.store.tileBrushStamp = { width: 1, height: 1, tiles: [baseTile] };
            gctx.store.tileBrushFlipH = (raw & FLIP_H_BIT) !== 0;
            gctx.store.tileBrushFlipV = (raw & FLIP_V_BIT) !== 0;
            gctx.store.tileBrushTool = 'paint';
        }
    }

    function isErasing(gctx: GizmoContext, rightClickErase: boolean, event?: MouseEvent | null): boolean {
        return rightClickErase
            || gctx.store.tileBrushTool === 'eraser'
            || (event?.shiftKey ?? false);
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

        onKeyDown(key: string, gctx: GizmoContext): boolean {
            const toolMap: Record<string, 'paint' | 'rect-fill' | 'bucket-fill' | 'eraser' | 'picker'> = {
                u: 'rect-fill',
                g: 'bucket-fill',
                d: 'eraser',
                i: 'picker',
            };
            const tool = toolMap[key.toLowerCase()];
            if (tool) {
                gctx.store.tileBrushTool = tool;
                return true;
            }
            return false;
        },

        hitTest(worldX, worldY, gctx) {
            const info = getLayerInfo(gctx);
            if (!info) return { hit: false };

            const tile = worldToTile(worldX, worldY,
                info.originX, info.originY, info.tileWidth, info.tileHeight);

            if (info.infinite) {
                return { hit: true, data: tile };
            }

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
            const tool = store.tileBrushTool;
            const stamp = store.tileBrushStamp;

            const drawEraseCursor = tool === 'eraser' || (dragState?.rightClickErase ?? false);

            if (drawEraseCursor) {
                const screenX = info.originX + hoverTile.tx * info.tileWidth;
                const screenY = -info.originY + hoverTile.ty * info.tileHeight;
                ctx.save();
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
                ctx.restore();
                return;
            }

            if (rectDrag) {
                const minTx = Math.min(rectDrag.startTx, rectDrag.endTx);
                const minTy = Math.min(rectDrag.startTy, rectDrag.endTy);
                const maxTx = Math.max(rectDrag.startTx, rectDrag.endTx);
                const maxTy = Math.max(rectDrag.startTy, rectDrag.endTy);
                const sx = info.originX + minTx * info.tileWidth;
                const sy = -info.originY + minTy * info.tileHeight;
                const w = (maxTx - minTx + 1) * info.tileWidth;
                const h = (maxTy - minTy + 1) * info.tileHeight;
                ctx.save();
                ctx.fillStyle = 'rgba(100, 200, 255, 0.2)';
                ctx.fillRect(sx, sy, w, h);
                ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
                ctx.lineWidth = 2 / zoom;
                ctx.strokeRect(sx, sy, w, h);
                ctx.restore();
                return;
            }

            ctx.save();
            const screenX = info.originX + hoverTile.tx * info.tileWidth;
            const screenY = -info.originY + hoverTile.ty * info.tileHeight;
            const sw = stamp.width * info.tileWidth;
            const sh = stamp.height * info.tileHeight;

            const resolved = resolveLayerImage(gctx);
            if (resolved) {
                const flipH = store.tileBrushFlipH;
                const flipV = store.tileBrushFlipV;
                ctx.globalAlpha = 0.5;
                for (let sy = 0; sy < stamp.height; sy++) {
                    for (let sx = 0; sx < stamp.width; sx++) {
                        const tileId = stamp.tiles[sy * stamp.width + sx] ?? 0;
                        if (tileId <= 0) continue;
                        const tileIndex = tileId - 1;
                        const srcX = (tileIndex % resolved.tilesetColumns) * info.tileWidth;
                        const srcY = Math.floor(tileIndex / resolved.tilesetColumns) * info.tileHeight;
                        const dx = screenX + sx * info.tileWidth;
                        const dy = screenY + sy * info.tileHeight;
                        if (flipH || flipV) {
                            ctx.save();
                            ctx.translate(flipH ? dx + info.tileWidth : dx, flipV ? dy + info.tileHeight : dy);
                            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
                            ctx.drawImage(resolved.image, srcX, srcY, info.tileWidth, info.tileHeight, 0, 0, info.tileWidth, info.tileHeight);
                            ctx.restore();
                        } else {
                            ctx.drawImage(resolved.image, srcX, srcY, info.tileWidth, info.tileHeight, dx, dy, info.tileWidth, info.tileHeight);
                        }
                    }
                }
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = 'rgba(100, 200, 255, 0.3)';
                ctx.fillRect(screenX, screenY, sw, sh);
            }

            ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(screenX, screenY, sw, sh);
            ctx.restore();
        },

        onDragStart(worldX, worldY, _hitData, gctx, event) {
            gctx.setGizmoActive(true);
            const info = getLayerInfo(gctx);
            if (!info) return;

            const tile = worldToTile(worldX, worldY,
                info.originX, info.originY, info.tileWidth, info.tileHeight);

            const tool = gctx.store.tileBrushTool;
            const rightClick = event?.button === 2;

            if (!rightClick && tool === 'bucket-fill') {
                doBucketFill(gctx, tile.tx, tile.ty);
                gctx.setGizmoActive(false);
                gctx.requestRender();
                return;
            }

            if (!rightClick && tool === 'picker') {
                doPicker(gctx, tile.tx, tile.ty);
                gctx.setGizmoActive(false);
                gctx.requestRender();
                return;
            }

            if (!rightClick && tool === 'rect-fill') {
                rectDrag = {
                    entityId: info.entityId,
                    startTx: tile.tx,
                    startTy: tile.ty,
                    endTx: tile.tx,
                    endTy: tile.ty,
                };
                gctx.requestRender();
                return;
            }

            const erase = isErasing(gctx, rightClick);
            dragState = createDragState(info, rightClick);

            if (erase) {
                paintTile(dragState, tile.tx, tile.ty, 0);
            } else {
                paintStamp(dragState, tile.tx, tile.ty, gctx.store.tileBrushStamp,
                    gctx.store.tileBrushFlipH, gctx.store.tileBrushFlipV);
            }
            gctx.requestRender();
        },

        onDrag(worldX, worldY, _hitData, gctx, event) {
            if (rectDrag) {
                const info = getLayerInfo(gctx);
                if (!info) return;
                const tile = worldToTile(worldX, worldY,
                    info.originX, info.originY, info.tileWidth, info.tileHeight);
                rectDrag.endTx = tile.tx;
                rectDrag.endTy = tile.ty;
                hoverTile = tile;
                gctx.requestRender();
                return;
            }

            if (!dragState) return;

            const erase = isErasing(gctx, dragState.rightClickErase, event);

            const tile = worldToTile(worldX, worldY,
                dragState.originX, dragState.originY,
                dragState.tileWidth, dragState.tileHeight);

            if (erase) {
                paintTile(dragState, tile.tx, tile.ty, 0);
            } else {
                paintStamp(dragState, tile.tx, tile.ty, gctx.store.tileBrushStamp,
                    gctx.store.tileBrushFlipH, gctx.store.tileBrushFlipV);
            }

            hoverTile = tile;
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);

            if (rectDrag) {
                const info = getLayerInfo(gctx);
                if (info) {
                    const minTx = Math.min(rectDrag.startTx, rectDrag.endTx);
                    const minTy = Math.min(rectDrag.startTy, rectDrag.endTy);
                    const maxTx = Math.max(rectDrag.startTx, rectDrag.endTx);
                    const maxTy = Math.max(rectDrag.startTy, rectDrag.endTy);

                    const state = createDragState(info, false);
                    const stamp = gctx.store.tileBrushStamp;
                    const fH = gctx.store.tileBrushFlipH;
                    const fV = gctx.store.tileBrushFlipV;

                    for (let ty = minTy; ty <= maxTy; ty++) {
                        for (let tx = minTx; tx <= maxTx; tx++) {
                            const sx = (tx - minTx) % stamp.width;
                            const sy = (ty - minTy) % stamp.height;
                            const tileId = stamp.tiles[sy * stamp.width + sx] ?? 0;
                            if (tileId > 0) {
                                paintTile(state, tx, ty, applyFlipBits(tileId, fH, fV));
                            }
                        }
                    }
                    commitChanges(state, gctx);
                }
                rectDrag = null;
                gctx.requestRender();
                return;
            }

            if (!dragState || dragState.changes.size === 0) {
                dragState = null;
                return;
            }

            commitChanges(dragState, gctx);
            dragState = null;
            gctx.requestRender();
        },

        onHover(worldX, worldY, hitData, gctx) {
            let newTile: { tx: number; ty: number } | null = null;
            const info = getLayerInfo(gctx);
            if (info && (hitData || info.infinite)) {
                newTile = worldToTile(worldX, worldY,
                    info.originX, info.originY, info.tileWidth, info.tileHeight);
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
