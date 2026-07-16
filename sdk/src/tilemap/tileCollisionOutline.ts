// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileCollisionOutline.ts
 * @brief   Project a tilemap layer's per-tile collision into WORLD-space outlines —
 *          without spawning anything. The editor's viewport overlay renders these so a
 *          tile's collision (slopes / circles / one-way / sensors) is visible while
 *          authoring, not only after entering Play.
 *
 * This mirrors the runtime spawn EXACTLY: plain solid boxes greedy-merge through the
 * same {@link mergeCollisionTiles} the native collider path uses, and richer shapes go
 * through the same {@link tileColliderShape} + one-way normal reorientation that
 * {@link generateChunkTileShapes} spawns from — so the overlay is what you get out of
 * Play. Geometry is world PIXELS (`colliderShapeOutline` at ppu = 1); the caller
 * projects it to the screen. No physics units here — the overlay is a picture, not a body.
 */
import type { Vec2 } from '../types';
import type { DecodedChunk } from './chunkCodec';
import { CHUNK_SIZE } from './chunkCodec';
import { tileIdOf, tileFlagsOf } from './tileBits';
import { mergeCollisionTiles } from './collisionMerge';
import { tileColliderShape, oneWayNormalWorld } from './tiledLoader';
import { colliderShapeOutline, shapeCenter } from '../physics/ColliderShape';
import type { ColliderShape } from '../physics/ColliderShape';
import type { TilesetModel } from './tilesetResolve';

/**
 * One tile-collision outline in world pixels — the polylines/circles a backend strokes,
 * plus the flags the overlay styles by. `center` is the shape's world centre, carried so
 * the caller can cull off-screen pieces before projecting each point. `oneWay` is the
 * solid-side normal (world y-up, unit length), reoriented for the cell's flips.
 */
export interface TileCollisionPiece {
    center: Vec2;
    polylines: Vec2[][];
    circles: { c: Vec2; r: number }[];
    sensor: boolean;
    oneWay: { nx: number; ny: number } | null;
}

/** World outline of a pixel-space collider shape at `worldCenter` (no rotation — tiles
 *  carry flips, not continuous angles, and flips are already baked into the shape). */
function outlineAt(shape: ColliderShape, worldCenter: Vec2): { polylines: Vec2[][]; circles: { c: Vec2; r: number }[] } {
    const center = shapeCenter(shape, worldCenter, 0, 1);
    return colliderShapeOutline(shape, center, 0, 1);
}

/**
 * Build world-pixel collision outlines for every placed collidable cell of a layer, given
 * its decoded chunks + resolved {@link TilesetModel}. `tileW/tileH` are the layer cell
 * size; `originX/originY` the layer's world origin (its Transform position, world y-up) —
 * the same convention the native spawn uses, so an outline sits where its collider would.
 */
export function tileCollisionOutlines(
    chunks: DecodedChunk[],
    model: TilesetModel,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
): TileCollisionPiece[] {
    const pieces: TileCollisionPiece[] = [];
    const boxIds = new Set(model.collidableTileIds);
    const shapes = model.tileShapes;
    const hasBoxes = boxIds.size > 0;
    const hasShapes = shapes.size > 0;
    if (!hasBoxes && !hasShapes) return pieces;

    for (const chunk of chunks) {
        const baseX = chunk.x * CHUNK_SIZE;
        const baseY = chunk.y * CHUNK_SIZE;

        // Plain solid boxes: greedy-merge per chunk (matching generateChunkCollision), one
        // outline per merged rectangle — so a solid platform reads as a few big rects.
        if (hasBoxes) {
            for (const rect of mergeCollisionTiles(chunk.tiles, CHUNK_SIZE, CHUNK_SIZE, boxIds)) {
                const x0 = baseX + rect.col;
                const y0 = baseY + rect.row;
                const x1 = x0 + rect.width - 1;
                const y1 = y0 + rect.height - 1;
                const cx = originX + ((x0 + x1 + 1) / 2) * tileW;
                const cy = originY - ((y0 + y1 + 1) / 2) * tileH;
                const shape: ColliderShape = {
                    kind: 'box',
                    halfExtents: { x: rect.width * tileW * 0.5, y: rect.height * tileH * 0.5 },
                    offset: { x: 0, y: 0 },
                };
                const o = outlineAt(shape, { x: cx, y: cy });
                pieces.push({ center: { x: cx, y: cy }, polylines: o.polylines, circles: o.circles, sensor: false, oneWay: null });
            }
        }

        // Rich shapes: one outline per placed cell (polygon / circle / a box carrying a
        // one-way, sensor, or material modifier), flip-applied like the spawned collider.
        if (hasShapes) {
            for (let i = 0; i < chunk.tiles.length; i++) {
                const raw = chunk.tiles[i];
                const rc = shapes.get(tileIdOf(raw));
                if (!rc) continue;
                const gx = baseX + (i % CHUNK_SIZE);
                const gy = baseY + Math.floor(i / CHUNK_SIZE);
                const cellCenter = { x: originX + (gx + 0.5) * tileW, y: originY - (gy + 0.5) * tileH };
                const f = tileFlagsOf(raw);
                const shape = tileColliderShape(rc, tileW, tileH, f.flipH, f.flipV, f.flipD);
                const o = outlineAt(shape, cellCenter);
                let oneWay: { nx: number; ny: number } | null = null;
                if (rc.oneWay) {
                    const n = oneWayNormalWorld(rc.oneWay.nx, rc.oneWay.ny, f.flipH, f.flipV, f.flipD);
                    const len = Math.hypot(n.x, n.y);
                    if (len > 1e-4) oneWay = { nx: n.x / len, ny: n.y / len };
                }
                pieces.push({
                    center: shapeCenter(shape, cellCenter, 0, 1),
                    polylines: o.polylines,
                    circles: o.circles,
                    sensor: !!rc.sensor,
                    oneWay,
                });
            }
        }
    }
    return pieces;
}
